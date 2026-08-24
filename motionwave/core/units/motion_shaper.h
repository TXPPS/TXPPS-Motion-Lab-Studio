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

#include "../dsp/crossover.h"
#include "../dsp/decimate.h"
#include "../dsp/curve.h"
#include "../dsp/lfo_phase.h"
#include "../dsp/smoother.h"
#include "../dsp/visual_state.h"
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
  /**
   * Read-back, for the generated parameter dispatch and nothing else.
   *
   * The unit's own API groups what belongs together — both crossover corners
   * go in at once because they are one filter network, and a band's settings
   * arrive as a struct because enabling one is a topology change and changing
   * its depth is not. A parameter, though, is one control moving one value, so
   * the generated dispatch has to set a field without disturbing its
   * neighbours. It reads the current settings back rather than keeping its own
   * copy, because a second copy of the parameter state is precisely the drift
   * the manifest exists to make impossible.
   */
  double lowMidHz() const noexcept { return lowMid_; }
  double midHighHz() const noexcept { return midHigh_; }
  BandSettings band(int index) const noexcept {
    return (index >= 0 && index < kMaxBands) ? bands_[index] : BandSettings{};
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

  /**
   * **An unshaped band is open, not shut.**
   *
   * `Curve::valueAt` returns zero for an empty curve, which is right for a
   * curve and wrong for a *default*: a freshly constructed Motion Shaper
   * modulated every band to silence, so inserting one on a track produced no
   * sound at all until a shape was drawn. All twenty-four of this unit's Ledger
   * cells passed while that was true, because every one of them sets a curve
   * before measuring anything — the defect was visible only to someone who
   * inserted the device and expected to hear their track, which is exactly the
   * gap Ledger cell 25 exists to close.
   *
   * Flat at one is the neutral shape: an undrawn Motion Shaper is a wire, and
   * the depth control then has something to modulate away from.
   *
   * In the constructor rather than in `prepare`, because `prepare` runs *after*
   * a host has set its curves — putting it there overwrote them, which turned
   * eight of this unit's own D1 rows red the moment it was tried.
   */
  MotionShaper() {
    for (int band = 0; band < kMaxBands; ++band) curves_[band].setFlat(1.0);
  }

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
    // Prepared here and never in `rebuild`. `rebuild` runs on every topology
    // change, and re-preparing a filter clears its state — which puts a
    // discontinuity into the signal at exactly the moment the crossfade exists
    // to prevent one. Measured: 405 flagged samples on V9 with the reset in
    // place, against zero without it.
    for (int b = 0; b < kMaxBands; ++b) decimators_[b].prepare(sampleRate_, cutoffFraction_);
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
      // Still publishes. A bypassed unit is not an idle one — signal is passing
      // through it — and a face that froze on the last modulated frame would
      // show a playhead moving through a shape that is doing nothing, which is
      // worse than showing nothing. What it publishes is the truth: real level,
      // unity gain, no modulation.
      for (int c = 0; c < channels; ++c) {
        const float* src = in.channel(c);
        for (int i = 0; i < ctx.frames; ++i) {
          const float a = src[i] < 0.0f ? -src[i] : src[i];
          if (a > blockInputPeak_) blockInputPeak_ = a;
        }
      }
      blockOutputPeak_ = blockInputPeak_;
      for (int b = 0; b < kMaxBands; ++b) frameGain_[b] = 1.0f;
      publishFrame();
      return;
    }

    // Song position advances per sample, because the modulator is read per
    // sample. Deriving it here rather than once per block is what makes a
    // 200 Hz modulator land on the right sample instead of the right block.
    const double quartersPerSample = ctx.playing ? tempoQuartersPerSample(ctx) : 0.0;
    const double startQuarters = ctx.songSeconds * (bpm_ / 60.0);

    for (int i = 0; i < ctx.frames; ++i) {
      const double quarters = startQuarters + static_cast<double>(i) * quartersPerSample;

      // One phase read per frame, shared by every band and both channels. Two
      // bands reading the phase separately would be two chances for them to
      // disagree about where the bar is.
      // The modulator runs at `kOversampleFactor` times the audio rate and is
      // filtered before being decimated. That is what puts its own
      // discontinuities' images above the band instead of folded into it — see
      // `decimate.h` for why this rather than band-limiting each discontinuity
      // in place.
      //
      // Every sub-sample is pushed through the filter and the last one is kept.
      // Filtering only the kept sample would not be filtering: the energy that
      // would alias is in the ones being discarded.
      double gain[kMaxBands];
      for (int b = 0; b < kMaxBands; ++b) gain[b] = 1.0;
      const int subs = oversampling_ ? dsp::kOversampleFactor : 1;
      for (int sub = 0; sub < subs; ++sub) {
        const double subQuarters =
            quarters + quartersPerSample * static_cast<double>(sub) / static_cast<double>(subs);
        const double rate = oversampling_ ? oversampledRate_ : sampleRate_;
        const double subPhi = phase_.next(subQuarters, rate);
        lastPhase_ = subPhi;
        for (int b = 0; b < kMaxBands; ++b) {
          const double raw = bands_[b].enabled ? curves_[b].valueAt(subPhi) : 1.0;
          const double sm = smoothers_[b].process(raw);
          gain[b] = oversampling_ ? decimators_[b].push(sm) : sm;
        }
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

      // Tracked for the face. The peak of what actually went in and came out
      // this block, not an estimate from the controls — cell 20's whole point.
      // The *applied* factor, not the curve value — `blend` is exactly what the
      // sample below is multiplied by. Publishing the raw curve was wrong in
      // the way this codebase's house rule names: a face fed from it drew a
      // full-depth swing while the audio was doing nothing at all, because
      // Depth, Range and Mix all live between the curve and the gain. X24
      // caught it; no native test could, because at the default Depth 1,
      // Range −60 dB and Mix 1 the two are within 0.001 of each other.
      for (int b = 0; b < kMaxBands; ++b) frameGain_[b] = static_cast<float>(blend(b, gain[b]));

      for (int c = 0; c < channels; ++c) {
        const double x = static_cast<double>(in.channel(c)[i]);
        const float ax = static_cast<float>(x < 0.0 ? -x : x);
        if (ax > blockInputPeak_) blockInputPeak_ = ax;
        double y = pathOutput(live_, c, x, gain) * gainIn;
        // The outgoing path keeps running with its own state and its own
        // configuration for the whole fade. Stopping it and fading its last
        // sample would be a fade of silence, not a fade between two signals.
        if (fading) y += pathOutput(1 - live_, c, x, gain) * gainOut;
        const float ay = static_cast<float>(y < 0.0 ? -y : y);
        if (ay > blockOutputPeak_) blockOutputPeak_ = ay;
        out.channel(c)[i] = static_cast<float>(y);
      }
    }

    publishFrame();
  }

  /**
   * Hand the face one frame of what just happened.
   *
   * Once per block rather than per sample: a face redraws at 60 Hz and a block
   * is well under that, so per-sample publishing would be writing hundreds of
   * frames nobody reads. What the face needs from the *inside* of a block — the
   * playhead's exact position — is the phase at the block's end, which is what
   * it would have interpolated to anyway.
   *
   * Peaks are reset here rather than at the top of `process`, so a bypassed
   * block publishes zeros instead of holding the last audible values on screen
   * and looking like the unit is still working.
   */
  void publishFrame() noexcept {
    dsp::VisualFrame frame;
    frame.phase = static_cast<float>(lastPhase_);
    for (int b = 0; b < kMaxBands; ++b) {
      frame.bandGain[b] = frameGain_[b];
      frame.bandPeak[b] = bandPeak_[b];
      bandPeak_[b] = 0.0f;
    }
    frame.inputPeak = blockInputPeak_;
    frame.outputPeak = blockOutputPeak_;
    frame.crossfading = fadeRemaining_ > 0 ? 1u : 0u;
    blockInputPeak_ = 0.0f;
    blockOutputPeak_ = 0.0f;
    visual_.publish(frame);
  }

  /// The most recent frame of engine state, for the face. Lock-free.
  const dsp::VisualPublisher& visual() const noexcept { return visual_; }

  /// Tempo the unit resolves its length against. Set by the host per block.
  void setBpm(double bpm) noexcept { bpm_ = bpm > 1.0 ? bpm : 1.0; }

  /// Switch modulator oversampling, for measuring what it is worth.
  void setOversampling(bool on) noexcept { oversampling_ = on; }

  /// Modulator band limit, as a fraction of Nyquist. For measurement.
  void setModulatorBandwidth(double fraction) noexcept { cutoffFraction_ = fraction; }

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
    // The level each band actually carries, which is what the spectrum shading
    // draws. Taken here rather than estimated from the crossover's response,
    // because a band's content depends on the material and not on the filter.
    trackBandPeak(0, low);
    trackBandPeak(1, cfg.bandCount == 2 ? mid + high : mid);
    if (cfg.bandCount >= 3) trackBandPeak(2, high);
    const double g1 = cfg.enabled[1] ? blend(1, gain[1]) : 1.0;
    if (cfg.bandCount == 2) return low * g0 + (mid + high) * g1;
    const double g2 = cfg.enabled[2] ? blend(2, gain[2]) : 1.0;
    return low * g0 + mid * g1 + high * g2;
  }

  void trackBandPeak(int band, double value) noexcept {
    const float a = static_cast<float>(value < 0.0 ? -value : value);
    if (a > bandPeak_[band]) bandPeak_[band] = a;
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
    oversampledRate_ = sampleRate_ * static_cast<double>(dsp::kOversampleFactor);
    snapshot(config_[live_]);
    for (int c = 0; c < kMaxChannels; ++c) {
      split_[live_][c].prepare(sampleRate_, lowMid_, midHigh_, slope_);
    }
    for (int b = 0; b < kMaxBands; ++b) {
      // At the oversampled rate, so the time constant means the same number of
      // *seconds* whatever the oversampling factor is. Setting it against the
      // audio rate would make the smoother eight times too fast and quietly
      // undo the anti-click floor.
      smoothers_[b].setTimeConstant(dsp::smoothingSecondsFor(smooth_), oversampledRate_);
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
  dsp::Smoother smoothers_[kMaxBands];
  dsp::Decimator decimators_[kMaxBands];
  dsp::LfoPhase phase_;
  dsp::VisualPublisher visual_;
  float frameGain_[kMaxBands] = {1.0f, 1.0f, 1.0f};
  float bandPeak_[kMaxBands] = {0.0f, 0.0f, 0.0f};
  float blockInputPeak_ = 0.0f;
  float blockOutputPeak_ = 0.0f;
  double lastPhase_ = 0.0;
  BandSettings bands_[kMaxBands];

  double sampleRate_ = 48000.0;
  double lowMid_ = 220.0;
  double midHigh_ = 3200.0;
  double smooth_ = 0.0;
  double mix_ = 1.0;
  double bpm_ = 120.0;
  double oversampledRate_ = 384000.0;
  dsp::Slope slope_ = dsp::Slope::Db24;
  int bandCount_ = 3;
  int live_ = 0;
  int fadeSamples_ = 192;
  int fadeRemaining_ = 0;
  bool bypass_ = false;
  bool dirty_ = true;
  bool prepared_ = false;
  /// Whether the modulator runs oversampled. Switchable so its effect can be
  /// measured against its absence rather than asserted.
  bool oversampling_ = true;
  double cutoffFraction_ = dsp::kDecimationCutoff;
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
};

}  // namespace mw::units
