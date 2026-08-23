// Motion Wave — FET Limiter, harmonics and aliasing. `dyn-03` §9 rows 9, 10,
// 11, 14, 15 and 16.
//
// Every row here reads a spectrum, so every probe frequency is snapped to an
// FFT bin and the bin width is printed with the result: an incoherent probe
// spreads the fundamental across neighbouring bins and the leakage lands on
// exactly the harmonics being measured, which reads as distortion the unit does
// not have.
//
// The sample rate is per row rather than shared, and that is not incidental.
// Row 15 measures distortion at 15 kHz, which has no harmonics below Nyquist at
// 48 kHz — the row would pass by measuring nothing. Row 16 measures aliasing at
// 12 kHz, which at 48 kHz is exactly a quarter of the sample rate, so every
// alias folds onto the probe's own bin or onto DC and the band comes out
// spuriously clean. Each row states the rate it needs and why.
#include "../dsp/fft.h"
#include "../units/fet_limiter.h"
#include "harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw;
using namespace mw::units;

namespace {

constexpr double kPi = 3.14159265358979323846;
/// Amortises the per-block cost without hiding a unit whose fastest attack is
/// twenty microseconds: the loop inside runs one sample at a time regardless.
constexpr std::size_t kBlock = 128;

struct Probe {
  double rate;
  std::size_t n;
  double binHz() const { return rate / static_cast<double>(n); }
  /// The probe frequency snapped to a bin, which is the one the FFT can read.
  double snap(double hz) const { return std::floor(hz / binHz() + 0.5) * binHz(); }
  std::size_t bin(double hz) const { return static_cast<std::size_t>(std::floor(hz / binHz() + 0.5)); }
};

/// The rate rows 9 to 14 run at: high enough for five harmonics of 1 kHz, and
/// the rate the unit is actually used at.
const Probe kAudio{48000.0, 32768};

struct Harmonics {
  double h[6] = {0, 0, 0, 0, 0, 0};
  double ratio(int n) const { return h[0] > 0.0 ? h[n - 1] / h[0] : 0.0; }
  double thd() const {
    double sum = 0.0;
    for (int n = 2; n <= 6; ++n) sum += ratio(n) * ratio(n);
    return std::sqrt(sum);
  }
};

struct Rendered {
  std::vector<float> samples;
  double reduction = 0.0;
};

struct Setting {
  FetRatio ratio = FetRatio::R8;
  double attack = 4.0;
  double release = 4.0;
  double inputGain = 1.0;
  double outputGain = 1.0;
  bool noise = false;
};

void configure(FetLimiter& unit, const Setting& s, const Probe& p) {
  unit.prepare(p.rate, kBlock);
  if (!s.noise) unit.setNoise(0.0);
  unit.setRatio(s.ratio);
  unit.setAttack(s.attack);
  unit.setRelease(s.release);
  unit.setInputGain(s.inputGain);
  unit.setOutputGain(s.outputGain);
  unit.setLimiting(true);
  unit.setTier(FetLimiter::Tier::X8);
  unit.reset();
}

/**
 * Render a coherent tone, ramped in and measured only from the settled region.
 *
 * Ramped because an abrupt onset is a step as well as a tone, and this unit's
 * detector is fast enough to catch the step; measured from the settled region
 * because a harmonic reading taken while the gain is still moving measures the
 * movement rather than the amplifier.
 */
Rendered render(FetLimiter& unit, const Probe& p, double hz, double amplitude) {
  const double step = 2.0 * kPi * p.snap(hz) / p.rate;
  std::vector<float> left(kBlock, 0.0f);
  std::vector<float> right(kBlock, 0.0f);
  std::vector<float> outLeft(kBlock, 0.0f);
  std::vector<float> outRight(kBlock, 0.0f);
  float* channels[2] = {left.data(), right.data()};
  float* outChannels[2] = {outLeft.data(), outRight.data()};
  Rendered out;
  out.samples.assign(p.n, 0.0f);

  const std::size_t ramp = static_cast<std::size_t>(p.rate * 0.05);
  const std::size_t settle = static_cast<std::size_t>(p.rate * 0.5);
  const std::size_t total = ramp + settle + p.n;
  for (std::size_t base = 0; base < total; base += kBlock) {
    const std::size_t frames = std::min(kBlock, total - base);
    for (std::size_t j = 0; j < frames; ++j) {
      const std::size_t i = base + j;
      double shape = 1.0;
      if (i < ramp) shape = 0.5 - 0.5 * std::cos(kPi * static_cast<double>(i) / static_cast<double>(ramp));
      left[j] = static_cast<float>(amplitude * shape * std::sin(step * static_cast<double>(i)));
      right[j] = left[j];
    }
    AudioBuffer in(channels, 2, static_cast<int>(frames));
    AudioBuffer outBuf(outChannels, 2, static_cast<int>(frames));
    ProcessContext ctx;
    ctx.inputs = &in;
    ctx.inputCount = 1;
    ctx.outputs = &outBuf;
    ctx.outputCount = 1;
    ctx.frames = static_cast<int>(frames);
    ctx.sampleRate = p.rate;
    ctx.playing = true;
    unit.process(ctx);
    for (std::size_t j = 0; j < frames; ++j) {
      const std::size_t i = base + j;
      if (i >= ramp + settle) out.samples[i - ramp - settle] = outLeft[j];
    }
  }
  out.reduction = unit.gainReductionDb();
  return out;
}

void spectrum(const std::vector<float>& samples, std::vector<double>& re, std::vector<double>& im) {
  re.assign(samples.size(), 0.0);
  im.assign(samples.size(), 0.0);
  for (std::size_t i = 0; i < samples.size(); ++i) re[i] = static_cast<double>(samples[i]);
  dsp::fft(re, im);
}

Harmonics analyse(const std::vector<float>& samples, const Probe& p, double hz) {
  std::vector<double> re;
  std::vector<double> im;
  spectrum(samples, re, im);
  const std::size_t bin = p.bin(hz);
  Harmonics h;
  for (int n = 1; n <= 6; ++n) {
    const std::size_t k = bin * static_cast<std::size_t>(n);
    if (k >= p.n / 2) break;
    h.h[n - 1] = std::sqrt(re[k] * re[k] + im[k] * im[k]);
  }
  return h;
}

double db(double v) { return 20.0 * std::log10(v > 1.0e-15 ? v : 1.0e-15); }

/// The source amplitude that settles at `targetDb` of reduction. Bisected on a
/// full render because the settled depth is a property of the loop, not of a
/// static curve that could be inverted.
double driveFor(const Setting& s, const Probe& p, double targetDb, double hz) {
  double lo = 1.0e-4;
  double hi = 1.0;
  for (int i = 0; i < 14; ++i) {
    const double mid = std::sqrt(lo * hi);
    FetLimiter unit;
    configure(unit, s, p);
    if (render(unit, p, hz, mid).reduction < targetDb) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return std::sqrt(lo * hi);
}

/// Render at a drive found for this setting, and report both.
Rendered at(const Setting& s, const Probe& p, double targetDb, double hz, Harmonics& out) {
  const double drive = driveFor(s, p, targetDb, hz);
  FetLimiter unit;
  configure(unit, s, p);
  const Rendered r = render(unit, p, hz, drive);
  out = analyse(r.samples, p, hz);
  return r;
}

}  // namespace

MW_TEST("dyn-03 test 10: the FET's asymmetry, and that it grows with reduction") {
  Setting s;
  Harmonics deepH;
  Harmonics shallowH;
  const Rendered deep = at(s, kAudio, 10.0, 1000.0, deepH);
  const Rendered shallow = at(s, kAudio, 2.0, 1000.0, shallowH);

  std::printf("    test 10 bins %.4f Hz: at %.2f dB, THD %.4f %%, H2 %.1f dBc, H3 %.1f dBc\n",
              kAudio.binHz(), deep.reduction, deepH.thd() * 100.0, db(deepH.ratio(2)),
              db(deepH.ratio(3)));
  std::printf("    test 10: at %.2f dB, THD %.4f %% — %.1f dB lower\n", shallow.reduction,
              shallowH.thd() * 100.0, db(deepH.thd()) - db(shallowH.thd()));
  // §6.2's mechanism is an asymmetry, so the unit is second-harmonic led.
  MW_EXPECT_EXCEEDS_BY(db(deepH.ratio(2)), db(deepH.ratio(3)), 6.0, 1.0e-9);
  // And it rises with depth, because deeper reduction moves the element further
  // along its curve.
  MW_EXPECT_EXCEEDS_BY(db(deepH.thd()), db(shallowH.thd()), 8.0, 1.0e-9);
}

MW_TEST("dyn-03 test 9: the four-button state is dirtier at the same reduction") {
  Setting twenty;
  twenty.ratio = FetRatio::R20;
  Setting allIn;
  allIn.ratio = FetRatio::AllIn;
  Harmonics twentyH;
  Harmonics allH;
  const Rendered a = at(twenty, kAudio, 10.0, 1000.0, twentyH);
  const Rendered b = at(allIn, kAudio, 10.0, 1000.0, allH);

  std::printf("    test 9: at %.2f/%.2f dB — 20:1 THD %.4f %%, four-button %.4f %%"
              " (%.1f dB higher)\n",
              a.reduction, b.reduction, twentyH.thd() * 100.0, allH.thd() * 100.0,
              db(allH.thd()) - db(twentyH.thd()));
  MW_EXPECT_EXCEEDS_BY(db(allH.thd()), db(twentyH.thd()), 6.0, 1.0e-9);
}

MW_TEST("dyn-03 test 11: at low frequency the detector is the distortion") {
  // §4: at the fastest attack the detector tracks *within* the cycle of a bass
  // note, so the gain is modulated by the signal and the result is distortion
  // generated by the detector rather than by any amplifier stage.
  //
  // Total THD cannot see it. The element's own distortion is second-harmonic
  // led (test 10) and swamps the detector's contribution at every frequency —
  // 6.9 % against 6.4 % between 40 Hz and 1 kHz, which is the element twice.
  // The two mechanisms separate in the spectrum: the detector rectifies, so its
  // ripple is at twice the signal frequency, and a gain modulated at 2f
  // multiplying a signal at f lands on the THIRD harmonic. H3 is therefore the
  // detector's signature and H2 is the element's, and reading H3 measures the
  // one this row is about.
  Setting fast;
  fast.attack = 7.0;
  fast.release = 7.0;
  Harmonics low;
  Harmonics high;
  const Rendered lowRun = at(fast, kAudio, 10.0, 40.0, low);
  at(fast, kAudio, 10.0, 1000.0, high);

  Setting held = fast;
  held.release = 1.0;
  Harmonics smoothed;
  at(held, kAudio, 10.0, 40.0, smoothed);

  std::printf("    test 11: 40 Hz at %.1f dB — THD %.3f %%, H3 %.1f dBc;"
              " 1 kHz H3 %.1f dBc (%.1f dB lower)\n",
              lowRun.reduction, low.thd() * 100.0, db(low.ratio(3)), db(high.ratio(3)),
              db(low.ratio(3)) - db(high.ratio(3)));
  std::printf("    test 11: slowest release at 40 Hz — H3 %.1f dBc (%.1f dB lower)\n",
              db(smoothed.ratio(3)), db(low.ratio(3)) - db(smoothed.ratio(3)));
  // The sheet's first clause, unchanged.
  MW_EXPECT(low.thd() * 100.0 > 1.0);
  // §4: "the effect grows as frequency falls".
  MW_EXPECT_EXCEEDS_BY(db(low.ratio(3)), db(high.ratio(3)), 6.0, 1.0e-9);
  // And the timing network is what sets it. This is the sheet's own
  // discriminator — "if the two are the same, the detector is smoothing where
  // the hardware does not" — applied to the control that physically holds the
  // gain up between peaks. See PROGRESS.md for why it cannot be ATTACK: both
  // published attack endpoints are under a thousandth of a 40 Hz period, so
  // both track the cycle completely and neither can separate from the other.
  MW_EXPECT_EXCEEDS_BY(db(low.ratio(3)), db(smoothed.ratio(3)), 6.0, 1.0e-9);
}

MW_TEST("dyn-03 test 14: where the drive is split changes what it sounds like") {
  // Two settings reaching the same reduction and the same output level with
  // INPUT ten decibels apart. The element sees the same signal in both, so
  // everything it does is identical; what differs is how hard the source drives
  // the input transformer, which sits *ahead* of the INPUT attenuator. That is
  // the whole content of the row, and it is why the control order in the unit
  // is load-bearing rather than cosmetic.
  //
  // **Fifty hertz, and the row is empty at 1 kHz.** The flux in a transformer
  // is the integral of the voltage, so it falls as 1/f: at 1 kHz the core is
  // thirty-three times below the flux its saturation is specified at and is
  // linear at any level the unit will ever see, which is why §6.1 calls this
  // transformer a low-frequency source and not any other kind. Measured at
  // 1 kHz the two settings differed by 0.0 dB and would have gone on doing so
  // however the transformer was configured — the probe was asking the core a
  // question at a frequency where it has no answer.
  //
  // **And a hot source with INPUT backed off, which is the other half.** The
  // control is an attenuator: it has no gain, so the only way to work the
  // transformer is to send it more. A pair chosen around the level the element
  // happens to need puts both settings far below the core's knee and measures
  // the element twice.
  const double gain = std::pow(10.0, 10.0 / 20.0);
  const double hz = 50.0;
  Setting reference;
  const double element = driveFor(reference, kAudio, 10.0, hz);
  // Full scale, and ten decibels below it. INPUT attenuates each to the same
  // element drive, so the reduction matches and only the core differs.
  const double hotSource = 1.0;
  const double quietSource = hotSource / gain;

  Setting quiet;
  quiet.inputGain = element / quietSource;
  Setting hot;
  hot.inputGain = element / hotSource;

  FetLimiter a;
  configure(a, quiet, kAudio);
  const Rendered ra = render(a, kAudio, hz, quietSource);
  const Harmonics quietH = analyse(ra.samples, kAudio, hz);

  FetLimiter b;
  configure(b, hot, kAudio);
  const Rendered rb = render(b, kAudio, hz, hotSource);
  const Harmonics hotH = analyse(rb.samples, kAudio, hz);

  std::printf("    test 14: INPUT %.4f against %.4f — %.2f/%.2f dB of reduction,"
              " THD %.4f %% against %.4f %% (%.1f dB apart)\n",
              quiet.inputGain, hot.inputGain, ra.reduction, rb.reduction, quietH.thd() * 100.0,
              hotH.thd() * 100.0, std::fabs(db(quietH.thd()) - db(hotH.thd())));
  MW_EXPECT_NEAR(ra.reduction, rb.reduction, 1.0);
  MW_EXPECT(std::fabs(db(quietH.thd()) - db(hotH.thd())) >= 3.0);
  // The core is third-harmonic dominant (§6.1), so the difference has to arrive
  // there and not on the element's own second harmonic — otherwise the row is
  // reading a reduction mismatch rather than the transformer.
  MW_EXPECT_EXCEEDS_BY(db(hotH.ratio(3)), db(quietH.ratio(3)), 3.0, 1.0e-9);
}

MW_TEST("dyn-03 test 15: the baseline specifications") {
  // Ninety-six kilohertz, because the row measures distortion at 15 kHz and at
  // 48 kHz that tone has no harmonic below Nyquist at all: the row would report
  // a perfect result having measured nothing.
  const Probe fine{96000.0, 65536};
  Setting s;
  s.noise = true;
  for (const double hz : {50.0, 1000.0, 15000.0}) {
    Harmonics h;
    const Rendered r = at(s, fine, 1.0, hz, h);
    std::printf("    test 15: %6.0f Hz at %.2f dB of reduction — THD %.4f %%\n", fine.snap(hz),
                r.reduction, h.thd() * 100.0);
    // 0.5 % with the published +0.2 percentage point tolerance.
    MW_EXPECT(h.thd() * 100.0 < 0.7);
  }

  // Signal-to-noise at the threshold of limiting. The signal is the tone that
  // just reaches limiting; the reference is the same unit with no input, so the
  // figure is the unit's own floor rather than the difference between two
  // arbitrary levels.
  const double drive = driveFor(s, fine, 1.0, 1000.0);
  FetLimiter unit;
  configure(unit, s, fine);
  const Rendered tone = render(unit, fine, 1000.0, drive);
  FetLimiter idle;
  configure(idle, s, fine);
  const Rendered silence = render(idle, fine, 1000.0, 0.0);

  double signalSq = 0.0;
  double noiseSq = 0.0;
  for (std::size_t i = 0; i < fine.n; ++i) {
    signalSq += static_cast<double>(tone.samples[i]) * static_cast<double>(tone.samples[i]);
    noiseSq += static_cast<double>(silence.samples[i]) * static_cast<double>(silence.samples[i]);
  }
  const double snr = db(std::sqrt(signalSq / static_cast<double>(fine.n))) -
                     db(std::sqrt(noiseSq / static_cast<double>(fine.n)));
  std::printf("    test 15: signal-to-noise at the threshold of limiting, %.1f dB\n", snr);
  // 81 dB with the published -3 dB tolerance.
  MW_EXPECT(snr > 78.0);
}

MW_TEST("dyn-03 test 16: nothing folds back into the band") {
  // Forty-four-one, and the choice matters more than the row looks. The sheet
  // specifies a 12 kHz probe; at 48 kHz that is exactly a quarter of the sample
  // rate, so every alias of it folds onto its own bin or onto DC and the band
  // below the probe comes out at the numerical floor whatever the unit does.
  // This model measured -139 dBFS that way — a perfect result that proved
  // nothing. At 44.1 kHz the same tone folds to 8.1 kHz and 3.9 kHz, inside the
  // band, which is the measurement the row is asking for. It is also the rate
  // where a 20 µs attack has the least room.
  const Probe wire{44100.0, 32768};
  const double hz = wire.snap(12000.0);
  Setting s;
  s.attack = 7.0;
  const double drive = driveFor(s, wire, 15.0, hz);
  FetLimiter unit;
  configure(unit, s, wire);
  const Rendered r = render(unit, wire, hz, drive);

  std::vector<double> re;
  std::vector<double> im;
  spectrum(r.samples, re, im);
  const std::size_t probeBin = wire.bin(hz);
  const double fundamental = std::sqrt(re[probeBin] * re[probeBin] + im[probeBin] * im[probeBin]);
  // Below the probe there is no legitimate harmonic — the second is already
  // above Nyquist — so every line in this band arrived by folding.
  double worst = 0.0;
  double worstHz = 0.0;
  for (std::size_t k = 2; k < probeBin; ++k) {
    const double magnitude = std::sqrt(re[k] * re[k] + im[k] * im[k]);
    if (magnitude > worst) {
      worst = magnitude;
      worstHz = static_cast<double>(k) * wire.binHz();
    }
  }
  std::printf("    test 16 bins %.4f Hz, probe %.1f Hz at %.1f dB of reduction:"
              " worst alias %.1f dBc at %.0f Hz\n",
              wire.binHz(), hz, r.reduction, db(worst / fundamental), worstHz);
  MW_EXPECT(db(worst / fundamental) <= -60.0);
}

MW_TEST_MAIN("fet-limiter-amp")
