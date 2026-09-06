// Motion Wave — the vocoder's transient detector. `smp-01` §4.4, reusing §3.3.
//
// The sheet says to reuse the importer's spectral flux as the detector,
// evaluated on the analysis frames. It cannot be *called*: `onset.h`'s
// `spectralFlux` transforms a whole file into a `std::vector` it allocates,
// which is right for an importer that runs once at load and impossible on a
// path `render` reaches. So the detection function is the same one — the
// half-wave-rectified sum of the per-bin magnitude increase — computed one
// frame at a time over storage the voice already owns.
//
// Half-wave rectification is not a refinement and is the reason `onset.h` keeps
// a release case that goes red without it: unrectified, a *decrease* in energy
// counts as evidence and every note release produces an onset. The threshold
// rides on a running mean rather than an absolute number for §3.3's other
// reason, that an absolute number does not survive a change of source level.
//
// **What this file does NOT reproduce, and why that is a choice rather than an
// omission.** `onset.h`'s peak picker has three more conditions — a local
// maximum over +/-w frames, an asymmetric mean window, and a 30 ms refractory —
// and every one of them needs frames the detector has not seen yet. An importer
// has the whole file; a voice has only the past. The rise condition is the one
// that survives causally and it is the one kept, because a rectified flux from
// a decaying sound falls monotonically while an onset is a step, which is a
// structural difference rather than a fitted threshold.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <vector>

namespace mw::dsp::sample {

class TransientDetector {
 public:
  /// Load/prepare time. Sizes everything the detector will ever touch, so
  /// `detect` allocates nothing.
  void prepare(std::size_t bins) {
    prevMag_.assign(bins, 0.0);
    history_.assign(kHistory, 0.0);
    count_ = 0;
    seeded_ = false;
  }

  /// Called once per analysis frame whether or not detection is enabled: the
  /// previous frame's magnitudes have to keep advancing, or turning the
  /// control on mid-note would compare against a frame from before it was off.
  bool detect(const std::vector<double>& mag, std::size_t bins, bool enabled,
              double sensitivityPercent) noexcept {
    double sum = 0.0;
    for (std::size_t k = 0; k < bins && k < prevMag_.size(); ++k) {
      const double d = mag[k] - prevMag_[k];
      sum += 0.5 * (d + std::fabs(d));
      prevMag_[k] = mag[k];
    }
    if (!enabled) return false;
    if (!seeded_) {
      seeded_ = true;
      history_[0] = sum;
      count_ = 1;
      return false;
    }
    double mean = 0.0;
    const std::size_t have = std::min(count_, kHistory);
    for (std::size_t i = 0; i < have; ++i) mean += history_[i];
    mean /= static_cast<double>(have);
    history_[count_ % kHistory] = sum;
    ++count_;
    // The control is linear in percent (§7.3), so the threshold is linear in
    // the ratio it sets: 0 never fires and 100 fires at 1.2x the running mean.
    // A percentage that behaved logarithmically would be a different control
    // from the one the sheet's table specifies.
    const double s = sensitivityPercent * 0.01;
    if (s <= 0.0) return false;
    const double ratio = 8.0 - 6.8 * s;
    // Four frames before the mean means anything: with fewer, the mean is
    // dominated by the frame that is being compared against it and a note's
    // own onset would trip the detector on the frame after it every time.
    return have >= 4 && mean > 0.0 && sum > ratio * mean;
  }

 private:
  /// Sixteen frames, which at N = 2048 and a 4x stretch is about 43 ms of
  /// source — long enough that a hit's own decay is inside the window it is
  /// compared against, and short enough that a passage's overall level does
  /// not set the bar for a quiet passage inside it.
  static constexpr std::size_t kHistory = 16;

  std::vector<double> prevMag_;
  std::vector<double> history_;
  std::size_t count_ = 0;
  bool seeded_ = false;
};

}  // namespace mw::dsp::sample
