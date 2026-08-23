// Motion Wave — Motion Shaper.
//
// A multiband rhythmic modulation processor: split the signal into bands, and
// drive a gain on each from a shape the user drew against the transport.
//
// This is the first of the fourteen units, and it is first because it proves
// the framework rather than because it is the easiest. It exercises every part
// the others need — a band split whose sum must be the input, a modulator that
// must be sample-accurate against the tempo map, a gain path that must not
// click, and a wet/dry blend that must not comb — so anything the substrate got
// wrong shows up here rather than in unit nine.
//
// What it is *not* is a wrapper around a stack of existing pieces. The pieces
// are in `core/dsp/` deliberately: the crossover is used again by every
// multiband unit, the curve and phase by anything with a drawn modulator, and
// the smoother by every gain that moves. A unit that owned private copies would
// be the beginning of thirteen slightly different band splits.
#pragma once

#include <cmath>
#include <cstddef>

#include "../dsp/blep.h"
#include "../dsp/crossover.h"
#include "../dsp/curve.h"
#include "../dsp/lfo_phase.h"
#include "../dsp/smoother.h"
#include "../graph/node.h"

namespace mw::units {

/// Bands the unit can run. One is the whole signal, unsplit.
inline constexpr int kMaxBands = 3;
/// Channels one instance handles.
inline constexpr int kMaxChannels = 2;

/**
 * The crossfade a topology change takes, in seconds.
 *
 * 4 ms, from `fx-01` §4.6. Long enough that a step in the signal path is
 * spread below what reads as a click, short enough that a user changing the
 * band count does not hear a swell.
 */
inline constexpr double kCrossfadeSeconds = 0.004;

/// What distinguishes one signal path from another, for the crossfade.
struct PathConfig {
  int bandCount = 3;
  dsp::Slope slope = dsp::Slope::Db24;
  bool enabled[3] = {true, true, true};
};

/// Everything one band's modulator is set from.
struct BandSettings {
  /// 0 … 1. How far the curve is allowed to move the gain.
  double depth = 1.0;
  /// Curve value 1.0 means unity gain and 0.0 means this much attenuation.
  double rangeDb = -60.0;
  bool enabled = true;
};

/**
 * The unit.
 *
 * Stereo, three bands, one modulation slot — which is the configuration `fx-01`
 * §7.1 costs and the one the CPU budget is stated against. More slots are more
 * of the same loop and are deliberately not built until a second unit needs the
 * generalisation, because a slot list that nothing uses is a guess about what
 * the second use will want.
 */
class MotionShaper : public Node {
 public:
  // ---- configuration, off the audio thread ----

  void setBandCount(int count) noexcept {
    const int wanted = count < 1 ? 1 : (count > kMaxBands ? kMaxBands : count);
    if (wanted != bandCount_) beginTopologyChange();
    bandCount_ = wanted;
  }

  /**
   * Crossover frequency, which deliberately does **not** crossfade.
   *
   * `fx-01` §4.6 names this as the exception and gives the reason: recomputing
   * biquad coefficients for a moving corner is fine because the filter's state
   * remains meaningful — the same signal history is still the right history for
   * a slightly different filter. What is not fine is switching *topology* under
   * a filter that has state, which is what the crossfade below exists for.
   */
  void setCrossovers(double lowMid, double midHigh) noexcept {
    lowMid_ = lowMid;
    midHigh_ = midHigh;
    dirty_ = true;
  }

  void setSlope(dsp::Slope slope) noexcept {
    if (slope != slope_) beginTopologyChange();
    slope_ = slope;
    dirty_ = true;
  }
  void setBand(int band, const BandSettings& s) noexcept {
    if (band < 0 || band >= kMaxBands) return;
    // Enabling or disabling a slot changes which path the signal takes, so it
    // is a topology change. Depth and range are not — they move a gain, and a
    // gain is already smoothed.
    if (s.enabled != bands_[band].enabled) beginTopologyChange();
    bands_[band] = s;
  }
  void setCurve(int band, const dsp::Breakpoint* points, std::size_t count) noexcept {
    if (band >= 0 && band < kMaxBands) curves_[band].set(points, count);
  }
  /// Smooth control, 0 … 1. The floor is applied inside the smoother.
  void setSmooth(double control) noexcept {
    smooth_ = control;
    dirty_ = true;
  }
  dsp::LfoPhase& phase() noexcept { return phase_; }

  /**
   * Wet/dry, 0 … 1. Applied **per band, before the sum**, and that is the whole
   * design rather than an implementation detail.
   *
   * The obvious version — blend the summed bands against the raw input — is a
   * comb, and V6 caught it at −8.2 dB. The reason is that a Linkwitz-Riley
   * split's bands sum to an *all-pass* of the input, not to the input: flat in
   * magnitude, rotating in phase. So the wet leg is phase-rotated and a raw dry
   * leg is not, and mixing them cancels and reinforces across the spectrum.
   * That is the same class of defect as MotionLab's saturator comb, arrived at
   * by a completely different route — there it was a delayed wet leg, here a
   * phase-rotated one — which is why the framework rule is "never blend two
   * paths that took different routes" rather than "remember to compensate
   * latency".
   *
   * Blending inside each band keeps both legs on the same path: every sample
   * that reaches the output has been through the same filters, and only its
   * gain differs. The consequence, stated plainly because it is a real
   * behaviour and not a bug: at Mix 0 the output is the all-pass of the input,
   * which is magnitude-flat to within V2's ±0.05 dB but is not sample-identical
   * to dry. Bypass is what gives back the input exactly, and it is a separate
   * control for that reason.
   */
  void setMix(double mix) noexcept { mix_ = mix < 0.0 ? 0.0 : (mix > 1.0 ? 1.0 : mix); }

  /// Bypass passes the input through untouched, which V1 measures as an exact null.
  void setBypass(bool bypass) noexcept { bypass_ = bypass; }

  // ---- Node ----

  void prepare(double sampleRate, int) override {
    sampleRate_ = sampleRate;
    fadeSamples_ = static_cast<int>(kCrossfadeSeconds * sampleRate + 0.5);
    fadeRemaining_ = 0;
    live_ = 0;
    snapshot(config_[0]);
    snapshot(config_[1]);
    rebuild();
    for (int p = 0; p < 2; ++p) {
      for (int c = 0; c < kMaxChannels; ++c) split_[p][c].prepare(sampleRate_, lowMid_, midHigh_, slope_);
    }
    for (int b = 0; b < kMaxBands; ++b) {
      // Snapped rather than ramped from zero: a unit that faded in over its
      // smoothing time at the start of every render would put a different
      // envelope on the first 200 ms of a bounce than on the same bars played
      // back, and the two are supposed to be the same audio.
      smoothers_[b].snapTo(curves_[b].valueAt(0.0));
    }
  }

  void reset() override {
    for (int p = 0; p < 2; ++p) {
      for (int c = 0; c < kMaxChannels; ++c) split_[p][c].reset();
    }
    // A seek ends any crossfade rather than carrying it across: the material
    // either side of a locate is unrelated, so there is nothing to fade
    // between and holding the fade would blend two different parts of the song.
    fadeRemaining_ = 0;
    phase_.reset();
  }

  int latencySamples() const override { return 0; }
  const char* name() const override { return "motion-shaper"; }

  void process(const ProcessContext& ctx) override {
    if (dirty_) rebuild();

    const AudioBuffer& in = ctx.inputs[0];
    AudioBuffer& out = ctx.outputs[0];
    const int channels = out.channelCount() < kMaxChannels ? out.channelCount() : kMaxChannels;

    if (bypass_) {
      out.copyFrom(in);
      return;
    }

    // Song position advances per sample, because the modulator is read per
    // sample. Deriving it here rather than once per block is what makes a
    // 200 Hz modulator land on the right sample instead of the right block.
    const double quartersPerSample = ctx.playing ? tempoQuartersPerSample(ctx) : 0.0;
    const double startQuarters = ctx.songSeconds * (bpm_ / 60.0);

    for (int i = 0; i < ctx.frames; ++i) {
      const double quarters = startQuarters + static_cast<double>(i) * quartersPerSample;
      const double phi = phase_.next(quarters, ctx.sampleRate);
      // How far the phase moved this sample, which is the width the correction
      // has to span. Derived from the observed phase rather than from the rate
      // control, so swing and tempo changes are already in it.
      double advance = phi - lastPhi_;
      if (advance < 0.0) advance += 1.0;
      phaseIncrement_ = advance;
      lastPhi_ = phi;

      // One phase read per frame, shared by every band and both channels. Two
      // bands reading the phase separately would be two chances for them to
      // disagree about where the bar is.
      double gain[kMaxBands];
      for (int b = 0; b < kMaxBands; ++b) {
        double raw = bands_[b].enabled ? curves_[b].valueAt(phi) : 1.0;
        if (bands_[b].enabled && blepEnabled_) raw += blepCorrection(b, phi);
        lastRaw_[b] = raw;
        gain[b] = smoothers_[b].process(raw);
      }

      // Equal-power rather than linear. A linear crossfade between two paths
      // carrying the same programme dips about 3 dB in the middle, which is
      // audible as a hole — and a topology change is exactly when nobody
      // expects the level to move.
      double gainIn = 1.0;
      double gainOut = 0.0;
      const bool fading = fadeRemaining_ > 0;
      if (fading) {
        const double t = 1.0 - static_cast<double>(fadeRemaining_) / static_cast<double>(fadeSamples_);
        gainIn = std::sin(t * 1.5707963267948966);
        gainOut = std::cos(t * 1.5707963267948966);
        --fadeRemaining_;
      }

      for (int c = 0; c < channels; ++c) {
        const double x = static_cast<double>(in.channel(c)[i]);
        double y = pathOutput(live_, c, x, gain) * gainIn;
        // The outgoing path keeps running with its own state and its own
        // configuration for the whole fade. Stopping it and fading its last
        // sample would be a fade of silence, not a fade between two signals.
        if (fading) y += pathOutput(1 - live_, c, x, gain) * gainOut;
        out.channel(c)[i] = static_cast<float>(y);
      }
    }
  }

  /// Tempo the unit resolves its length against. Set by the host per block.
  void setBpm(double bpm) noexcept { bpm_ = bpm > 1.0 ? bpm : 1.0; }

  /// Switch the band-limiting correction, so its effect can be measured
  /// against its absence rather than asserted.
  void setBlep(bool on) noexcept { blepEnabled_ = on; }

  /// True while a topology change is being faded. Test and diagnostic probe.
  bool crossfading() const noexcept { return fadeRemaining_ > 0; }

  /// What the modulator is doing now, for the face to draw. Read-only.
  double lastGain(int band) const noexcept {
    return band >= 0 && band < kMaxBands ? smoothers_[band].value() : 1.0;
  }

 private:
  double tempoQuartersPerSample(const ProcessContext& ctx) const noexcept {
    return bpm_ / 60.0 / ctx.sampleRate;
  }

  /**
   * Render one configured path for one sample.
   *
   * Each path carries its own band count, slope and per-band enable, because
   * during a crossfade the two differ — that is what is being faded between.
   * Reading the live members here instead would make the outgoing path adopt
   * the new topology instantly, which is the pop the crossfade exists to
   * prevent, dressed up as a fade.
   */
  double pathOutput(int path, int channel, double x, const double* gain) noexcept {
    const PathConfig& cfg = config_[path];
    const double g0 = cfg.enabled[0] ? blend(0, gain[0]) : 1.0;
    if (cfg.bandCount == 1) return x * g0;

    double low = 0.0;
    double mid = 0.0;
    double high = 0.0;
    split_[path][channel].process(x, low, mid, high);
    const double g1 = cfg.enabled[1] ? blend(1, gain[1]) : 1.0;
    if (cfg.bandCount == 2) return low * g0 + (mid + high) * g1;
    const double g2 = cfg.enabled[2] ? blend(2, gain[2]) : 1.0;
    return low * g0 + mid * g1 + high * g2;
  }

  /**
   * Band-limit every discontinuity the curve is near, not just one it crossed.
   *
   * The first version of this fired only on the sample where the segment index
   * changed, which applies *half* the correction — polyBLEP spans the sample
   * before a step and the sample after it, and one of those two is always in
   * the previous segment. Measured, that version moved the alias floor by
   * 0.2 dB, from −53.5 to −53.3 dBFS. It was not a small improvement; it was
   * no improvement, with a shape that also left a residual step the click
   * detector saw.
   *
   * So this asks the question the correction actually needs answered: is *this
   * sample* within one phase increment of a discontinuity, on either side. The
   * scan is over the curve's own breakpoints, which is where a discontinuity
   * can be, and is bounded by how many the user drew.
   */
  double blepCorrection(int band, double phi) noexcept {
    const dsp::Curve& curve = curves_[band];
    const double dt = phaseIncrement_;
    if (dt <= 0.0) return 0.0;
    // Below the gate the smoother dominates and the branch costs more than it
    // buys. Skipped rather than scaled: a partially applied BLEP is a different
    // filter, not a gentler one.
    if (dt * sampleRate_ < dsp::kBlepMinRateHz) return 0.0;

    const std::size_t count = curve.count();
    if (count < 2) return 0.0;
    const double x = phi - std::floor(phi);

    double correction = 0.0;
    for (std::size_t i = 0; i < count; ++i) {
      // A `step` segment holds its start value and then jumps at its *end*, so
      // that end is where the discontinuity is. Every other shape arrives at
      // the next breakpoint continuously.
      if (!curve.isStepBoundary(i)) continue;
      const std::size_t j = (i + 1) % count;
      const double boundary = (j == 0) ? 1.0 : curve.point(j).x;
      const double height = curve.point(j).y - curve.point(i).y;
      if (height == 0.0) continue;

      // Distance from the boundary, wrapped so a step at the loop point is
      // reachable from both ends of the cycle.
      double d = x - boundary;
      if (d > 0.5) d -= 1.0;
      if (d < -0.5) d += 1.0;

      if (d >= 0.0 && d < dt) {
        const double t = d / dt;
        correction -= height * (t + t - t * t - 1.0);
      } else if (d < 0.0 && d > -dt) {
        const double t = d / dt;
        correction -= height * (t * t + t + t + 1.0);
      }
    }
    return correction;
  }

  /// Copy the live settings into a path's own record of them.
  void snapshot(PathConfig& cfg) const noexcept {
    cfg.bandCount = bandCount_;
    cfg.slope = slope_;
    for (int b = 0; b < kMaxBands; ++b) cfg.enabled[b] = bands_[b].enabled;
  }

  /**
   * Hand the current path over to the outgoing slot and start a fade into a
   * fresh one.
   *
   * A change arriving *during* a fade snaps the fade to its end first. The
   * alternative is a third path, and three-way fades compound: each one is
   * quieter than either signal, so a user dragging the band count back and
   * forth would hear the level sag. Snapping loses at most 4 ms of a fade
   * nobody has heard the end of yet.
   */
  void beginTopologyChange() noexcept {
    if (!prepared_) return;  // Before `prepare` there is nothing to fade from.
    snapshot(config_[live_]);
    live_ = 1 - live_;
    fadeRemaining_ = fadeSamples_;
    dirty_ = true;
  }

  /// One band's gain with the wet/dry blend already folded in.
  ///
  /// Folded rather than applied afterwards because the blend has to happen on
  /// this band's own signal — see `setMix`. `1` is the dry contribution and
  /// `gainFor` the wet one, so at Mix 0 every band passes at unity and the sum
  /// is the split's own all-pass.
  double blend(int band, double curveValue) const noexcept {
    return 1.0 + (gainFor(band, curveValue) - 1.0) * mix_;
  }

  /// Curve value 0…1 mapped onto the band's gain range, scaled by Depth.
  double gainFor(int band, double curveValue) const noexcept {
    const BandSettings& s = bands_[band];
    // Depth 0 must be exactly unity, not nearly — V1 nulls against dry.
    if (s.depth <= 0.0) return 1.0;
    const double db = (1.0 - curveValue) * s.rangeDb * s.depth;
    return std::exp(db * 0.11512925464970229);  // 10^(db/20)
  }

  /// Rebuild only the live path, so a fade's outgoing side keeps its state.
  void rebuild() noexcept {
    snapshot(config_[live_]);
    for (int c = 0; c < kMaxChannels; ++c) {
      split_[live_][c].prepare(sampleRate_, lowMid_, midHigh_, slope_);
    }
    for (int b = 0; b < kMaxBands; ++b) {
      smoothers_[b].setTimeConstant(dsp::smoothingSecondsFor(smooth_), sampleRate_);
    }
    prepared_ = true;
    dirty_ = false;
  }

  /**
   * Both signal paths, so a topology change can fade between them.
   *
   * `fx-01` §4.6: switching filter coefficients in place while the filter has
   * state is the standard source of a pop and is not acceptable at any setting.
   * Two sets of state is what "both running for the crossfade duration" costs,
   * and it is cheap — a split is a handful of biquads, and only one of the two
   * is active outside the 4 ms.
   */
  dsp::ThreeBandSplit split_[2][kMaxChannels];
  PathConfig config_[2];
  dsp::Curve curves_[kMaxBands];
  std::size_t prevSegment_[kMaxBands] = {0, 0, 0};
  double lastRaw_[kMaxBands] = {1.0, 1.0, 1.0};
  /// Phase advanced per sample, which is what sets the correction's width.
  double phaseIncrement_ = 0.0;
  dsp::Smoother smoothers_[kMaxBands];
  dsp::LfoPhase phase_;
  BandSettings bands_[kMaxBands];

  double sampleRate_ = 48000.0;
  double lowMid_ = 220.0;
  double midHigh_ = 3200.0;
  double smooth_ = 0.0;
  double mix_ = 1.0;
  double bpm_ = 120.0;
  double lastPhi_ = 0.0;
  dsp::Slope slope_ = dsp::Slope::Db24;
  int bandCount_ = 3;
  int live_ = 0;
  int fadeSamples_ = 192;
  int fadeRemaining_ = 0;
  bool bypass_ = false;
  bool dirty_ = true;
  bool prepared_ = false;
  /**
   * **Off by default, and that is a deliberate refusal rather than an oversight.**
   *
   * `fx-01` §4.5 requires band-limiting and this implements the published
   * polyBLEP form, but turning it on makes V3 fail with 476 flagged samples
   * across the 0.1–200 Hz sweep. V3 is a detector I trust — it caught an
   * earlier one-sided version of this same correction — so that is not a
   * measurement artefact: at high modulation rates the residual this adds is
   * itself a step.
   *
   * Shipping DSP that a trustworthy test says is harmful, on the grounds that a
   * specification asks for it, would be the wrong way round. So it stays behind
   * the switch until the correction is right, V5 is unmet, and the Ledger
   * records D5 as FAIL — this unit's gap, not the host's.
   */
  bool blepEnabled_ = false;
};

}  // namespace mw::units
