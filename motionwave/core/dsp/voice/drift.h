// Motion Wave — the deviations that make one instance of an instrument one unit of it.
//
// `lib-voice-substrate.md` §4 and §5.4. Six deviations, one scalar. On the
// hardware they are correlated — a loose unit is loose in every respect at
// once — so `vintage` scales all of them together, and **its default is zero**:
// one consumer's pitch is divider-derived and exact, its own sheet calls adding
// drift there a category error, and a substrate that drifted by default would
// silently wrong that instrument. VS-17 holds it to an exact null.
//
// **The pitch walk is a function of song position, not a recursion.** The
// design writes it as an Ornstein–Uhlenbeck step, (5), advanced on song time.
// A step is a recursion, and a recursion's state at bar 33 is the history of
// bars 1–32 — so a render that *starts* at bar 33 cannot reproduce the tail of
// one that ran from bar 1, which is exactly what VS-16's song-position case
// requires to the bit. Replaying the history at a locate would cost time
// proportional to the distance from the last tune, on the audio thread. So the
// walk is synthesised instead: a sum of cosines whose frequencies are drawn
// from a Lorentzian of width 1/τ — the transform of that line shape is
// e^(−t/τ), so the process has the OU's stationary variance σ² *and* its
// autocorrelation, and it is a pure function of (seed, oscillator, t). Any
// position, any block size and any grid stride evaluate the same arithmetic on
// the same numbers, which is what the design's exact discretisation was for.
// The frequencies are stratified quantiles of the Lorentzian so that every
// oscillator's own correlation time lands near τ rather than only the average.
//
// It is evaluated on an absolute grid of `kGridFrames` samples and interpolated
// between grid points from the absolute frame, the same treatment `mod_grid.h`
// gives every other modulator; the process moves by hundredths of a cent per
// grid cell, so a straight line between cells is not a compromise.
//
// **Every magnitude below is ours.** The one sheet that tabulates a deviation
// set marks the whole table [I] — an emulator author's design decision — and
// `CLAUDE.md` quarantines those. Each default is either derived from a
// non-quarantined figure or chosen with the reason beside it; none is copied.
//
// Real-time safe: `prepare` sizes four vectors once, and everything else is
// arithmetic over them. `drift_tests.cpp` arms `RtGuard` around it.
#pragma once

#include <cmath>
#include <cstdint>
#include <vector>

namespace mw::dsp::voice {

struct DriftConfig {
  /// One scalar scaling every deviation at once, 0..1. Zero by default — see
  /// the header; the divider-derived consumer must be exact.
  float vintage = 0.0f;
  /// Correlation time of the pitch walk, seconds. **Chosen**, 300 s: the
  /// sheet's own accumulation test reads the spread at 0, 60 and 600 s after a
  /// tune and requires it to grow through all three, and a walk that is 98 %
  /// settled by 60 s — which a 30 s constant is — makes its 60 s → 600 s
  /// comparison a coin toss. Five minutes is a walk still growing at the first
  /// reading and settled by the last, and it is the thermal scale of a
  /// populated board in a case, which is the drift a tune button visibly fixes.
  float walkSeconds = 300.0f;
  /// Stationary standard deviation of the walk at vintage 1, cents.
  /// **Derived** from the sheet's unison-width criterion: after drift, two
  /// oscillators on one key must differ by more than 4 cents, and the RMS
  /// difference of two independent walks is σ√2, so σ ≥ 2.83 — rounded up.
  float pitchWalkCents = 3.0f;
  /// The calibration table's error in the range it measures, cents, as the
  /// half-width of a uniform draw per oscillator. **Chosen** so that with the
  /// residual below it the post-tune RMS in the measured range stays under the
  /// 0.4 cents VS-19 allows: √((0.37² + 0.4²)/3) = 0.31.
  float pitchOffsetCents = 0.4f;
  /// The same error one octave below the measured range, where it is
  /// extrapolated. **Chosen** at six times the measured-range figure; the
  /// sheet's own shape claim is only that it is larger and grows monotonically.
  float pitchOffsetCentsBelowC3 = 2.4f;
  /// Fixed per-voice spreads at vintage 1. All three **chosen** from component
  /// tolerance grades rather than from the quarantined table: a 5 % part sets a
  /// 5 % cutoff, an RC time set by two 5 % parts is 7 % (root-sum-square), and a
  /// 5 % gain-setting part is 0.4 dB, rounded to the nearest half.
  float cutoffPercent = 5.0f;
  float envelopeTimePercent = 7.0f;
  float vcaGainDb = 0.5f;
  /// Per-oscillator pulse-width spread, percent of period. **Chosen**: a
  /// comparator threshold error of one percent of the ramp it compares against.
  float pulseWidthPercent = 1.0f;
  /// The floor left immediately after a tune, cents. **Derived**: the routine
  /// writes a 14-bit word, and if that word spans ten octaves one step is
  /// 12000/16384 = 0.73 cents, so the residual is uniform within half a step —
  /// 0.37 cents. The span is not published; ten octaves is our assumption.
  float tuneResidualCents = 0.37f;
  /// How many oscillators each voice carries a pitch and pulse-width deviation for.
  int oscillatorsPerVoice = 2;
  std::uint64_t seed = 0x2545F4914F6CDD1Dull;
};

/// The lowest note the reference calibration measures, as a MIDI number. C3 in
/// scientific pitch notation, where middle C is C4 = 60. Below it the routine
/// extrapolates, and the error grows an octave at a time — (6) in the design.
inline constexpr float kCalibrationFloorNote = 48.0f;

/// The walk is evaluated once per this many samples and interpolated between.
inline constexpr std::int64_t kGridFrames = 4096;

class DriftModel {
 public:
  void prepare(double sampleRate, int voices, const DriftConfig& config) noexcept {
    sampleRate_ = sampleRate > 0.0 ? sampleRate : 48000.0;
    voices_ = voices > 0 ? voices : 1;
    oscillators_ = config.oscillatorsPerVoice > 0 ? config.oscillatorsPerVoice : 1;
    const auto n = static_cast<std::size_t>(voices_ * oscillators_);
    walk_.assign(n, Walk{});
    lines_.assign(n * kLines, Line{});
    pulseWidth_.assign(n, 0.0f);
    perVoice_.assign(static_cast<std::size_t>(voices_), PerVoice{});
    config_ = config;
    derive();
    reset();
  }

  /// Takes effect immediately. A new seed redraws every table and re-anchors
  /// the walk, so the same seed always means the same unit.
  void setConfig(const DriftConfig& config) noexcept {
    config_ = config;
    derive();
    drawTables();
    anchor();
    cell_ = -1;
    refresh();
  }

  /// Back to song position zero with the tables of the first tune. A transport
  /// jump calls this and gets the same unit it had, which is what keeps a
  /// bounce and its playback identical.
  void reset() noexcept {
    tuneIndex_ = 0;
    nowFrame_ = 0;
    tuneFrame_ = 0;
    cell_ = -1;
    drawTables();
    anchor();
    refresh();
  }

  /// Resets the accumulated walk to the post-tune residual and draws a fresh
  /// calibration table. Drift then resumes and grows again — the routine is a
  /// reset, not a servo, and nothing holds the oscillators in tune between
  /// presses. A control that visibly fixes an audible problem is reproduced as
  /// a feature rather than hidden.
  void tune() noexcept {
    ++tuneIndex_;
    tuneFrame_ = nowFrame_;
    drawTables();
    anchor();
    refresh();
  }

  /// Advance by **song time**. `songSeconds` is the song position at the first
  /// frame of the step — `ProcessContext::songSeconds` plus the run's offset —
  /// and the values read afterwards are those at the *end* of the step, as
  /// every other generator in the substrate reports. Rounded to a frame, so
  /// two hosts that compute the same position with a last-bit difference
  /// evaluate the same frame.
  void advance(double songSeconds, int frames) noexcept {
    const double f = std::floor(songSeconds * sampleRate_ + 0.5);
    const std::int64_t start = f > 0.0 ? static_cast<std::int64_t>(f) : 0;
    nowFrame_ = start + static_cast<std::int64_t>(frames > 0 ? frames : 0);
    refresh();
  }

  /// Walk plus calibration error, cents, for a note. The table's error is
  /// structured, not uniform: a model that applied uniform detune would be
  /// wrong on bass parts specifically, which is where it is audible.
  float pitchCents(int voice, int oscillator, float midiNote) const noexcept {
    const Walk& w = walk_[index(voice, oscillator)];
    return config_.vintage * (w.value + w.offset * shape(midiNote));
  }

  /// The walk alone — what a face showing "how far out of tune" draws.
  float walkCents(int voice, int oscillator) const noexcept {
    return config_.vintage * walk_[index(voice, oscillator)].value;
  }

  float cutoffFactor(int voice) const noexcept {
    return 1.0f + config_.vintage * perVoice_[clampVoice(voice)].cutoff;
  }
  float envelopeTimeFactor(int voice) const noexcept {
    return 1.0f + config_.vintage * perVoice_[clampVoice(voice)].envelopeTime;
  }
  float vcaGainDb(int voice) const noexcept {
    return config_.vintage * perVoice_[clampVoice(voice)].vcaGainDb;
  }
  float pulseWidthFactor(int voice, int oscillator) const noexcept {
    return 1.0f + config_.vintage * pulseWidth_[index(voice, oscillator)];
  }

  const DriftConfig& config() const noexcept { return config_; }
  int voices() const noexcept { return voices_; }
  int oscillators() const noexcept { return oscillators_; }
  int tuneCount() const noexcept { return tuneIndex_; }

 private:
  /// Cosines per oscillator. Enough that the sum is Gaussian to the ear and
  /// each oscillator's own correlation time lands near τ; few enough that a
  /// grid cell costs thirty-two cosines per oscillator every 85 ms.
  static constexpr std::size_t kLines = 32;
  /// The Lorentzian is sampled over this much of its mass. The tail beyond it
  /// is faster than the grid can carry and holds two percent of the power.
  static constexpr double kLineMass = 0.98;
  static constexpr double kPi = 3.14159265358979323846;

  struct Line {
    double omega = 0.0;
    double phase = 0.0;
  };

  struct Walk {
    float value = 0.0f;     ///< residual plus innovation at `nowFrame_`, cents at vintage 1
    float residual = 0.0f;  ///< the post-tune floor, redrawn per tune
    float offset = 0.0f;    ///< the table's measured-range error, redrawn per tune
    double anchor = 0.0;    ///< the process at the tune frame
    double gridA = 0.0;     ///< the process at the start of cell `cell_`
    double gridB = 0.0;     ///< and at the end of it
  };

  struct PerVoice {
    float cutoff = 0.0f;
    float envelopeTime = 0.0f;
    float vcaGainDb = 0.0f;
  };

  /// The same mix `lfo.h` uses, so an addressed draw is the same function
  /// everywhere in the substrate.
  static std::uint64_t mix(std::uint64_t seed, std::uint64_t index) noexcept {
    std::uint64_t z = seed + (index + 1) * 0x9E3779B97F4A7C15ull;
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
  }
  static double unit(std::uint64_t h) noexcept {
    return static_cast<double>(h >> 11) * (1.0 / 9007199254740992.0);
  }
  static float bipolar(std::uint64_t h) noexcept {
    return static_cast<float>(h >> 40) * (2.0f / 16777216.0f) - 1.0f;
  }

  std::size_t index(int voice, int oscillator) const noexcept {
    const int v = clampInt(voice, 0, voices_ - 1);
    const int o = clampInt(oscillator, 0, oscillators_ - 1);
    return static_cast<std::size_t>(v * oscillators_ + o);
  }
  std::size_t clampVoice(int voice) const noexcept {
    return static_cast<std::size_t>(clampInt(voice, 0, voices_ - 1));
  }
  static int clampInt(int v, int lo, int hi) noexcept { return v < lo ? lo : (v > hi ? hi : v); }

  /// (6): unity in the measured range, growing linearly by octave below it.
  float shape(float midiNote) const noexcept {
    if (midiNote >= kCalibrationFloorNote) return 1.0f;
    return 1.0f + (kCalibrationFloorNote - midiNote) * (1.0f / 12.0f) * growth_;
  }

  void derive() noexcept {
    tau_ = config_.walkSeconds > 1.0f ? static_cast<double>(config_.walkSeconds) : 1.0;
    sigma_ = static_cast<double>(config_.pitchWalkCents > 0.0f ? config_.pitchWalkCents : 0.0f);
    const float a = config_.pitchOffsetCents;
    growth_ = a > 0.0f ? config_.pitchOffsetCentsBelowC3 / a - 1.0f : 0.0f;
    if (growth_ < 0.0f) growth_ = 0.0f;
    const std::uint64_t seed = config_.seed;
    for (int v = 0; v < voices_; ++v) {
      const auto sv = static_cast<std::uint64_t>(v);
      PerVoice& p = perVoice_[static_cast<std::size_t>(v)];
      p.cutoff = config_.cutoffPercent * 0.01f * bipolar(mix(seed ^ 0x11ull, sv));
      p.envelopeTime = config_.envelopeTimePercent * 0.01f * bipolar(mix(seed ^ 0x22ull, sv));
      p.vcaGainDb = config_.vcaGainDb * bipolar(mix(seed ^ 0x33ull, sv));
      for (int o = 0; o < oscillators_; ++o) {
        const std::size_t i = index(v, o);
        const auto si = static_cast<std::uint64_t>(i);
        pulseWidth_[i] = config_.pulseWidthPercent * 0.01f * bipolar(mix(seed ^ 0x44ull, si));
        // Stratified: line k's frequency is the Lorentzian's quantile at a
        // random point inside stratum k, so every oscillator's spectrum covers
        // the line shape evenly while no two oscillators share a frequency.
        for (std::size_t k = 0; k < kLines; ++k) {
          const auto sk = static_cast<std::uint64_t>(k);
          Line& line = lines_[i * kLines + k];
          const double u = unit(mix(seed ^ 0x55ull, si * 1024 + sk));
          const double quantile = (static_cast<double>(k) + u) / static_cast<double>(kLines);
          line.omega = std::tan(0.5 * kPi * kLineMass * quantile) / tau_;
          line.phase = 2.0 * kPi * unit(mix(seed ^ 0x66ull, si * 1024 + sk));
        }
      }
    }
  }

  /// The stationary process for one oscillator at a song time, cents at
  /// vintage 1. Thirty-two cosines, in double, so the sum is the same bits for
  /// the same `t` however the render reached it.
  double process(std::size_t osc, double t) const noexcept {
    double sum = 0.0;
    const Line* line = &lines_[osc * kLines];
    for (std::size_t k = 0; k < kLines; ++k) sum += std::cos(line[k].omega * t + line[k].phase);
    return sigma_ * std::sqrt(2.0 / static_cast<double>(kLines)) * sum;
  }

  /// The process at an arbitrary frame, through the grid, so the anchor and
  /// the running value are the same function of the same frame.
  double sampleAt(std::size_t osc, std::int64_t frame) const noexcept {
    const std::int64_t cell = frame / kGridFrames;
    const double cellSeconds = static_cast<double>(kGridFrames) / sampleRate_;
    const double a = process(osc, static_cast<double>(cell) * cellSeconds);
    const double b = process(osc, static_cast<double>(cell + 1) * cellSeconds);
    const double frac = static_cast<double>(frame - cell * kGridFrames) / static_cast<double>(kGridFrames);
    return a + (b - a) * frac;
  }

  /// Fresh residual and table for every oscillator, addressed by the tune
  /// count so the third tune of a session is the same third tune on replay.
  void drawTables() noexcept {
    const auto tune = static_cast<std::uint64_t>(tuneIndex_);
    for (std::size_t i = 0; i < walk_.size(); ++i) {
      const auto si = static_cast<std::uint64_t>(i);
      walk_[i].residual = config_.tuneResidualCents * bipolar(mix(config_.seed ^ 0x77ull, si * 65536 + tune));
      walk_[i].offset = config_.pitchOffsetCents * bipolar(mix(config_.seed ^ 0x88ull, si * 65536 + tune));
    }
  }

  void anchor() noexcept {
    for (std::size_t i = 0; i < walk_.size(); ++i) walk_[i].anchor = sampleAt(i, tuneFrame_);
  }

  /// The walk at `nowFrame_`: the process, less what the tune anchored, decaying
  /// at the walk's own rate — the OU process conditioned on its value at the
  /// tune, which is zero there and grows to σ² with the same time constant.
  void refresh() noexcept {
    const std::int64_t cell = nowFrame_ / kGridFrames;
    const double cellSeconds = static_cast<double>(kGridFrames) / sampleRate_;
    if (cell != cell_) {
      // Only a real previous cell can be reused: the cache starts at −1, and
      // cell 0 would otherwise inherit a zero that was never computed.
      const bool next = cell_ >= 0 && cell == cell_ + 1;
      for (std::size_t i = 0; i < walk_.size(); ++i) {
        Walk& w = walk_[i];
        // A step into the next cell reuses the value already computed for its
        // start; it is the same function of the same time and costs nothing.
        w.gridA = next ? w.gridB : process(i, static_cast<double>(cell) * cellSeconds);
        w.gridB = process(i, static_cast<double>(cell + 1) * cellSeconds);
      }
      cell_ = cell;
    }
    const double frac = static_cast<double>(nowFrame_ - cell * kGridFrames) / static_cast<double>(kGridFrames);
    const double since = static_cast<double>(nowFrame_ - tuneFrame_) / sampleRate_;
    const double decay = since > 0.0 ? std::exp(-since / tau_) : 1.0;
    for (Walk& w : walk_) {
      const double x = w.gridA + (w.gridB - w.gridA) * frac;
      w.value = static_cast<float>(static_cast<double>(w.residual) + (x - w.anchor * decay));
    }
  }

  DriftConfig config_{};
  double sampleRate_ = 48000.0;
  double tau_ = 300.0;
  double sigma_ = 3.0;
  float growth_ = 0.0f;
  int voices_ = 1;
  int oscillators_ = 2;
  int tuneIndex_ = 0;
  std::int64_t nowFrame_ = 0;
  std::int64_t tuneFrame_ = 0;
  std::int64_t cell_ = -1;
  std::vector<Walk> walk_;
  std::vector<Line> lines_;
  std::vector<float> pulseWidth_;
  std::vector<PerVoice> perVoice_;
};

}  // namespace mw::dsp::voice
