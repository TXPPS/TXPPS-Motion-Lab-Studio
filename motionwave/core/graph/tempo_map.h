// Motion Wave — the song's clock.
//
// The timeline is measured in ticks at PPQ = 480, and every conversion between
// ticks, seconds and bars goes through this map. One authority, because a song
// that computes "where is bar 9" one way for the ruler and another way for the
// scheduler will put the playhead and the notes in different places, and the
// discrepancy only shows up after a tempo change where nobody is looking.
//
// Thread contract: built and edited off the audio thread; read on it. Reading
// allocates nothing — the lookups are binary searches over contiguous storage.
// Publishing an edited map to the audio thread is the engine's job, not this
// class's, and is done by swapping a pointer rather than by mutating in place.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace mw {

/// Ticks per quarter note. 480 divides by 2, 3, 4, 5, 6 and 8, so triplets,
/// quintuplets and 32nds all land on whole ticks — which is why it is the
/// value sequencers converged on rather than a rounder one.
inline constexpr std::int64_t kTicksPerQuarter = 480;

using Tick = std::int64_t;

/// A tempo in force from `tick` onward.
struct TempoPoint {
  Tick tick = 0;
  double bpm = 120.0;
  /// True when the tempo travels linearly from here to the next point rather
  /// than stepping at it. A ramp is integrated in closed form below.
  bool ramp = false;
};

struct TimeSigPoint {
  Tick tick = 0;
  int numerator = 4;
  int denominator = 4;
};

/// Bars and beats are 1-based because that is how a musician counts. `tickInBeat`
/// is the remainder, so a position is exactly `bar.beat.tick`.
struct BarBeat {
  std::int64_t bar = 1;
  std::int64_t beat = 1;
  std::int64_t tickInBeat = 0;
};

class TempoMap {
 public:
  TempoMap() {
    tempos_.push_back(TempoPoint{});
    sigs_.push_back(TimeSigPoint{});
  }

  // ------------------------------------------------------------------ edit

  /// Replaces any point already at this tick. Keeps the list sorted, so every
  /// lookup below can binary search rather than scan.
  void setTempo(Tick tick, double bpm, bool ramp = false) {
    if (!(bpm > 0.0)) return;  // a zero or negative tempo has no meaning in time
    TempoPoint point{tick < 0 ? 0 : tick, bpm, ramp};
    insertSorted(tempos_, point);
    dirty_ = true;
  }

  void setTimeSignature(Tick tick, int numerator, int denominator) {
    if (numerator < 1 || denominator < 1) return;
    TimeSigPoint point{tick < 0 ? 0 : tick, numerator, denominator};
    insertSorted(sigs_, point);
  }

  void removeTempoAt(Tick tick) {
    if (tick <= 0) return;  // the point at zero is the map's floor and always exists
    tempos_.erase(std::remove_if(tempos_.begin(), tempos_.end(),
                                 [tick](const TempoPoint& p) { return p.tick == tick; }),
                  tempos_.end());
    dirty_ = true;
  }

  // --------------------------------------------------------------- inspect

  const std::vector<TempoPoint>& tempos() const noexcept { return tempos_; }
  const std::vector<TimeSigPoint>& signatures() const noexcept { return sigs_; }

  double bpmAt(Tick tick) const noexcept {
    const std::size_t i = tempoIndexAt(tick);
    const TempoPoint& a = tempos_[i];
    if (!a.ramp || i + 1 >= tempos_.size()) return a.bpm;
    const TempoPoint& b = tempos_[i + 1];
    if (b.tick <= a.tick) return a.bpm;
    const double t = static_cast<double>(tick - a.tick) / static_cast<double>(b.tick - a.tick);
    return a.bpm + (b.bpm - a.bpm) * (t < 0.0 ? 0.0 : (t > 1.0 ? 1.0 : t));
  }

  /// Seconds from the start of the song to `tick`.
  double secondsAt(Tick tick) const {
    if (tick <= 0) return 0.0;
    ensurePrefix();
    const std::size_t i = tempoIndexAt(tick);
    return prefix_[i] + spanSeconds(i, tempos_[i].tick, tick);
  }

  /// The inverse. Binary searches the prefix table and then solves inside the
  /// segment, so it is exact rather than an iterative approximation.
  Tick tickAt(double seconds) const {
    if (seconds <= 0.0) return 0;
    ensurePrefix();
    // Last segment whose start time is at or before `seconds`.
    std::size_t i = 0;
    std::size_t lo = 0, hi = prefix_.size();
    while (lo < hi) {
      const std::size_t mid = (lo + hi) / 2;
      if (prefix_[mid] <= seconds) {
        i = mid;
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return tempos_[i].tick + spanTicks(i, seconds - prefix_[i]);
  }

  BarBeat barBeatAt(Tick tick) const {
    if (tick < 0) tick = 0;
    std::int64_t bar = 1;
    Tick cursor = 0;
    for (std::size_t i = 0; i < sigs_.size(); ++i) {
      const TimeSigPoint& sig = sigs_[i];
      const Tick start = std::max<Tick>(sig.tick, cursor);
      const Tick end = (i + 1 < sigs_.size()) ? sigs_[i + 1].tick : tick;
      const Tick perBeat = ticksPerBeat(sig.denominator);
      const Tick perBar = perBeat * sig.numerator;
      if (tick < end || i + 1 == sigs_.size()) {
        const Tick into = tick - start;
        if (into < 0) break;
        bar += into / perBar;
        const Tick rem = into % perBar;
        return BarBeat{bar, rem / perBeat + 1, rem % perBeat};
      }
      // A signature change that does not land on a bar line starts a new bar
      // where it sits: a partial bar is what the change created, and rounding
      // it away would silently move every bar number after it.
      const Tick span = end - start;
      bar += (span + perBar - 1) / perBar;
      cursor = end;
    }
    return BarBeat{bar, 1, 0};
  }

  Tick tickAtBar(std::int64_t bar) const {
    if (bar <= 1) return 0;
    std::int64_t remaining = bar - 1;
    Tick cursor = 0;
    for (std::size_t i = 0; i < sigs_.size(); ++i) {
      const TimeSigPoint& sig = sigs_[i];
      const Tick start = std::max<Tick>(sig.tick, cursor);
      const Tick perBar = ticksPerBeat(sig.denominator) * sig.numerator;
      const bool last = (i + 1 == sigs_.size());
      const Tick end = last ? std::numeric_limits<Tick>::max() : sigs_[i + 1].tick;
      const std::int64_t barsHere = last ? remaining : (end - start + perBar - 1) / perBar;
      if (remaining <= barsHere) return start + remaining * perBar;
      remaining -= barsHere;
      cursor = end;
    }
    return cursor;
  }

  /// Ticks in one beat, where a beat is the signature's denominator note.
  static constexpr Tick ticksPerBeat(int denominator) noexcept {
    return kTicksPerQuarter * 4 / (denominator > 0 ? denominator : 4);
  }

 private:
  template <typename T>
  static void insertSorted(std::vector<T>& v, const T& point) {
    const auto it = std::lower_bound(v.begin(), v.end(), point,
                                     [](const T& a, const T& b) { return a.tick < b.tick; });
    if (it != v.end() && it->tick == point.tick) {
      *it = point;
    } else {
      v.insert(it, point);
    }
  }

  std::size_t tempoIndexAt(Tick tick) const noexcept {
    std::size_t i = 0, lo = 0, hi = tempos_.size();
    while (lo < hi) {
      const std::size_t mid = (lo + hi) / 2;
      if (tempos_[mid].tick <= tick) {
        i = mid;
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return i;
  }

  /// Seconds to travel from `fromTick` to `toTick` inside segment `i`.
  ///
  /// A step segment is a division. A ramp is not: with tempo linear in ticks,
  /// the time is the integral of 60/(PPQ·bpm(t)) dt, which has the closed form
  /// below. Approximating it by the average tempo drifts by tens of
  /// milliseconds over a long accelerando, which is audible against a click.
  double spanSeconds(std::size_t i, Tick fromTick, Tick toTick) const noexcept {
    const TempoPoint& a = tempos_[i];
    const double ticks = static_cast<double>(toTick - fromTick);
    if (ticks <= 0.0) return 0.0;
    const double perQuarter = 60.0 / static_cast<double>(kTicksPerQuarter);
    if (!a.ramp || i + 1 >= tempos_.size()) return ticks * perQuarter / a.bpm;
    const TempoPoint& b = tempos_[i + 1];
    const double span = static_cast<double>(b.tick - a.tick);
    if (span <= 0.0 || b.bpm == a.bpm) return ticks * perQuarter / a.bpm;
    const double from = bpmAt(fromTick);
    const double to = bpmAt(toTick);
    const double slope = (b.bpm - a.bpm) / span;  // bpm per tick
    return perQuarter * std::log(to / from) / slope;
  }

  /// Inverse of `spanSeconds` within segment `i`.
  Tick spanTicks(std::size_t i, double seconds) const noexcept {
    const TempoPoint& a = tempos_[i];
    const double perQuarter = 60.0 / static_cast<double>(kTicksPerQuarter);
    if (seconds <= 0.0) return 0;
    if (!a.ramp || i + 1 >= tempos_.size()) {
      return static_cast<Tick>(std::llround(seconds * a.bpm / perQuarter));
    }
    const TempoPoint& b = tempos_[i + 1];
    const double span = static_cast<double>(b.tick - a.tick);
    if (span <= 0.0 || b.bpm == a.bpm) {
      return static_cast<Tick>(std::llround(seconds * a.bpm / perQuarter));
    }
    const double slope = (b.bpm - a.bpm) / span;
    const double bpm = a.bpm * std::exp(seconds * slope / perQuarter);
    return static_cast<Tick>(std::llround((bpm - a.bpm) / slope));
  }

  /// Cumulative seconds at the start of each tempo segment. Rebuilt lazily so
  /// a burst of edits costs one rebuild rather than one per edit.
  void ensurePrefix() const {
    if (!dirty_ && prefix_.size() == tempos_.size()) return;
    prefix_.assign(tempos_.size(), 0.0);
    for (std::size_t i = 1; i < tempos_.size(); ++i) {
      prefix_[i] = prefix_[i - 1] + spanSeconds(i - 1, tempos_[i - 1].tick, tempos_[i].tick);
    }
    dirty_ = false;
  }

  std::vector<TempoPoint> tempos_;
  std::vector<TimeSigPoint> sigs_;
  mutable std::vector<double> prefix_;
  mutable bool dirty_ = true;
};

}  // namespace mw
