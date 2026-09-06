// Motion Wave — the classic read head against `smp-01` §9: V-1, V-2, V-3.
//
// Run order per §9: V-1 first. It is the null that isolates the whole engine,
// and nothing else here is trusted until it passes.
//
// Mutations, and the row that caught each:
//
// - **The exact path removed** (`readAt` runs the tier's interpolator at
//   `r = 1`): V-1 stays green on every tier, at a residual below −300 dBFS.
//   The sheet's premise — "a non-zero residual means the interpolator runs
//   unconditionally" — is false for these kernels: linear and Catmull-Rom are
//   algebraic identities at zero fraction, and the sinc's zero-phase row is
//   the identity because its cutoff is exactly Nyquist. The exact path is
//   therefore a statement of what the read is, not what V-1 measures.
// - **The sinc's phase grid offset by half a step** (the common
//   `(i + 0.5) / P` centring): V-1 High reads −48.7 dBFS. **This** is what
//   V-1 guards — a table that is not the identity at zero phase — and the
//   exact path would hide it, which is why V-1 is measured with the exact
//   path *present*: the sinc suite's identity row is what refuses the table.
// - **The read position one sample early** (`i - 1`): V-1 reads −4.2 dBFS on
//   every tier.
// - **`fsFile / fsHost` dropped from the increment**: the 44.1 kHz file plays
//   at 1088.4 Hz on the 48 kHz host, 147 cents sharp, against a 0.5 cent row.
// - **The Normal tier's pyramid never selected** (`levelFor` returning 0): the
//   20 kHz row's fold reads −10.0 dBFS instead of −148.8. V-3 as the sheet
//   states it does **not** catch this — its 1 kHz tone reads −94.3 dBc without
//   the pyramid against −75.6 with it, which is *better*, because the pyramid
//   halves the distance to the first image and pays for it in rejection. That
//   is why the 20 kHz row exists beside V-3 rather than inside it.
#include "sample_harness.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::test::sample;
using mw::dsp::sample::semitoneRatio;

namespace {

constexpr double kRate = 48000.0;
const Quality kTiers[3] = {Quality::Eco, Quality::Normal, Quality::High};

}  // namespace

MW_TEST("V-1: at r = 1 the render is the file, on every tier, to below -140 dBFS") {
  /*
   * §9 V-1: Classic, High, root = played key, fsFile == fsHost, no loop; the
   * residual against the decoded file must be at or below −140 dBFS with no
   * tolerance. Full-band noise rather than a tone, so a kernel that was almost
   * an identity could not hide behind a signal too smooth to show it. Speed is
   * passed as an explicit array of ones so the product `1 × 1 × 1` is the one
   * the contract actually computes.
   */
  const std::size_t frames = 48000;
  const std::vector<float> zone = noiseZone(frames, 0x1234567u, 0.9);
  ClassicSource source;
  source.data = zone.data();
  source.frames = frames;
  source.sampleRate = kRate;
  for (Quality tier : kTiers) {
    ClassicRead head;
    head.prepare(source, &sharedSinc(), tier, kRate);
    const int rendered = static_cast<int>(frames) + 1024;
    const std::vector<float> pitch(static_cast<std::size_t>(rendered), 0.0f);
    const std::vector<float> speed(static_cast<std::size_t>(rendered), 1.0f);
    const std::vector<float> out = renderBlocks(head, rendered, pitch, speed, 256);
    double worst = 0.0;
    double peak = 0.0;
    for (std::size_t i = 0; i < static_cast<std::size_t>(rendered); ++i) {
      const double expected = i < frames ? static_cast<double>(zone[i]) : 0.0;
      peak = std::max(peak, std::fabs(expected));
      worst = std::max(worst, std::fabs(static_cast<double>(out[i]) - expected));
    }
    std::printf("    V-1 %s: worst residual %.1f dBFS against a %.3f peak; active after the end: %s\n",
                tierName(tier), dbOf(worst), peak, head.active() ? "yes" : "no");
    MW_EXPECT(dbOf(worst) <= -140.0);
    MW_EXPECT(peak > 0.5);
    MW_EXPECT(!head.active());
  }
}

MW_TEST("V-2: every key plays 1000 * 2^((k - 60) / 12) Hz within 0.5 cent, on every tier") {
  /*
   * §9 V-2 on a 1 kHz zone rooted at 60. The loop is ten periods exactly, so
   * the join is seamless and a repeated or dropped sample per pass — the
   * off-by-one a loop wrap most easily acquires — would read as a pitch error
   * of a few cents against this row's half a cent. Keys whose output would
   * sit above 0.45 fs are counted and skipped: above Nyquist the tone is
   * either removed by the High tier's kernel or folded by the others, and
   * neither is a frequency this row could call.
   */
  const std::vector<float> zone = sineZone(1000.0, kRate, 480, 0.5);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  ClassicSource source = toneSource(zone, kRate, LoopMode::Continuous);
  source.mip = &mip;
  const int frames = 19200;
  for (Quality tier : kTiers) {
    double worstCents = 0.0;
    int worstKey = -1;
    int measured = 0;
    int skipped = 0;
    for (int key = 0; key < 128; ++key) {
      const double expected = 1000.0 * semitoneRatio(static_cast<double>(key - 60));
      if (expected > 0.45 * kRate) {
        ++skipped;
        continue;
      }
      ClassicRead head;
      head.prepare(source, &sharedSinc(), tier, kRate);
      const std::vector<float> out = renderSteady(head, frames, static_cast<double>(key - 60));
      const double hz = measureHz(out, kRate, 256);
      MW_EXPECT(hz > 0.0);
      if (hz <= 0.0) continue;
      const double cents = centsBetween(hz, expected);
      if (std::fabs(cents) > std::fabs(worstCents)) {
        worstCents = cents;
        worstKey = key;
      }
      ++measured;
      MW_EXPECT(std::fabs(cents) <= 0.5);
    }
    std::printf("    V-2 %s: %d keys measured, %d above 0.45 fs; worst %+.4f cent at key %d\n",
                tierName(tier), measured, skipped, worstCents, worstKey);
    MW_EXPECT_EQ(measured + skipped, 128);
    MW_EXPECT(measured >= 100);
  }
}

MW_TEST("V-3: alias floor at +7, +12, +19 and +24 semitones, on every tier") {
  /*
   * §9 V-3: a 1 kHz sine at −6 dBFS, transposed up, worst non-harmonic
   * component relative to the carrier. Eco ≤ −40, Normal ≤ −70, High ≤ −100
   * dBc, +3 dB. The instrument is calibrated first on a pure tone at the +7
   * output frequency: whatever it reads there is its own floor, and a tier
   * figure within a few dB of that floor is the instrument, not the tier.
   *
   * At +12 and +24 the ratio is a whole number, the fractional phase is
   * constant, and every tier is an LTI filter followed by decimation of a
   * tone with nothing above the fold — so those columns read the float noise
   * floor. They are kept because a normalisation that varied with the phase
   * would show there and nowhere else; +7 and +19 are where the kernels are
   * graded.
   */
  const std::size_t length = 65536;
  const int offset = 1024;
  const std::size_t frames = (length + static_cast<std::size_t>(offset)) * 4 + 4096;
  const std::vector<float> zone = sineZone(1000.0, kRate, frames, 0.5);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  ClassicSource source;
  source.data = zone.data();
  source.frames = frames;
  source.sampleRate = kRate;
  source.mip = &mip;

  const double calibrationHz = 1000.0 * semitoneRatio(7.0);
  const std::vector<float> pure =
      sineZone(calibrationHz, kRate, length + static_cast<std::size_t>(offset), 0.5);
  const double floor = aliasDbc(pure, kRate, calibrationHz, offset, length);
  std::printf("    V-3 instrument floor on a pure %.1f Hz tone: %.1f dBc\n", calibrationHz, floor);
  MW_EXPECT(floor <= -130.0);

  const double semis[4] = {7.0, 12.0, 19.0, 24.0};
  for (Quality tier : kTiers) {
    std::printf("    V-3 %s:", tierName(tier));
    for (double s : semis) {
      ClassicRead head;
      head.prepare(source, &sharedSinc(), tier, kRate);
      const std::vector<float> out =
          renderSteady(head, static_cast<int>(length) + offset, s);
      const double carrier = 1000.0 * semitoneRatio(s);
      const double dbc = aliasDbc(out, kRate, carrier, offset, length);
      std::printf("  +%2.0f: %7.1f dBc", s, dbc);
      MW_EXPECT(dbc <= aliasTargetDbc(tier) + 3.0);
    }
    std::printf("   (target %.0f dBc, +3)\n", aliasTargetDbc(tier));
  }
}

MW_TEST("the pyramid removes what plain Hermite would fold, and V-3's tone cannot tell") {
  /*
   * A 20 kHz tone at +19 semitones lands at 60 kHz and folds to 12 kHz. Plain
   * Hermite at r = 3 has no anti-alias filter, so the fold arrives at nearly
   * the tone's own level; level 1 of the pyramid was built without anything
   * above 12 kHz, so the fold is the half-band filter's stopband. The same
   * render with `mip` null is the mutation, evaluated beside the row.
   *
   * V-3's stimulus does not see this: a 1 kHz tone has nothing above the fold
   * corner, and plain Hermite at +19 reads it at about −94 dBc against the
   * pyramid path's −75 — the pyramid halves the image distance and pays for it
   * in image rejection. Only content near the corner shows what it buys.
   */
  const std::size_t frames = 400000;
  const std::vector<float> zone = sineZone(20000.0, kRate, frames, 0.5);
  MipMap mip;
  mip.build(zone.data(), zone.size());
  ClassicSource withPyramid;
  withPyramid.data = zone.data();
  withPyramid.frames = frames;
  withPyramid.sampleRate = kRate;
  withPyramid.mip = &mip;
  ClassicSource without = withPyramid;
  without.mip = nullptr;
  const double r = semitoneRatio(19.0);
  const double folded = std::fabs(kRate - 20000.0 * r);
  const std::size_t length = 65536;
  ClassicRead a;
  a.prepare(withPyramid, &sharedSinc(), Quality::Normal, kRate);
  const std::vector<float> yes = renderSteady(a, static_cast<int>(length) + 1024, 19.0);
  ClassicRead b;
  b.prepare(without, &sharedSinc(), Quality::Normal, kRate);
  const std::vector<float> no = renderSteady(b, static_cast<int>(length) + 1024, 19.0);
  const double withDb = mw::test::bandPeakDb(yes, kRate, length, folded, 20.0, 1024);
  const double withoutDb = mw::test::bandPeakDb(no, kRate, length, folded, 20.0, 1024);
  std::printf("    +19 on a 20 kHz tone: the fold at %.0f Hz reads %.1f dBFS with the pyramid,"
              " %.1f dBFS without (mutation)\n",
              folded, withDb, withoutDb);
  // Relative to the -6 dBFS tone, the Normal target with its tolerance.
  MW_EXPECT(withDb <= -6.0 - 70.0 + 3.0);
  MW_EXPECT(withoutDb > -20.0);
}

MW_TEST("the increment carries fsFile / fsHost: a 44.1 kHz file plays in tune on a 48 kHz host") {
  /*
   * §3.1 keeps a file at its native rate and puts the ratio in the increment,
   * where it costs nothing. A head that forgot it would play this file 147
   * cents sharp — 1088.4 Hz — which is the number the mutation reads.
   */
  const double fileRate = 44100.0;
  const std::vector<float> zone = sineZone(1000.0, fileRate, 441, 0.5);
  const ClassicSource source = toneSource(zone, fileRate, LoopMode::Continuous);
  for (Quality tier : kTiers) {
    ClassicRead head;
    head.prepare(source, &sharedSinc(), tier, kRate);
    const std::vector<float> root = renderSteady(head, 19200, 0.0);
    const double atRoot = measureHz(root, kRate, 256);
    ClassicRead octave;
    octave.prepare(source, &sharedSinc(), tier, kRate);
    const std::vector<float> up = renderSteady(octave, 19200, 12.0);
    const double atOctave = measureHz(up, kRate, 256);
    std::printf("    %s: root %.3f Hz (%+.4f cent), +12 %.3f Hz (%+.4f cent); without the ratio it"
                " would read %.1f Hz\n",
                tierName(tier), atRoot, centsBetween(atRoot, 1000.0), atOctave,
                centsBetween(atOctave, 2000.0), 1000.0 * kRate / fileRate);
    MW_EXPECT(std::fabs(centsBetween(atRoot, 1000.0)) <= 0.5);
    MW_EXPECT(std::fabs(centsBetween(atOctave, 2000.0)) <= 0.5);
  }
}

MW_TEST("semitoneRatio is exact at zero and at whole octaves, and within a millicent elsewhere") {
  MW_EXPECT(semitoneRatio(0.0) == 1.0);
  MW_EXPECT(semitoneRatio(12.0) == 2.0);
  MW_EXPECT(semitoneRatio(-12.0) == 0.5);
  MW_EXPECT(semitoneRatio(24.0) == 4.0);
  MW_EXPECT(semitoneRatio(-36.0) == 0.125);
  double worst = 0.0;
  for (int i = -1200; i <= 1200; ++i) {
    const double s = static_cast<double>(i) * 0.1;
    const double cents = centsBetween(semitoneRatio(s), std::exp2(s / 12.0));
    worst = std::max(worst, std::fabs(cents));
  }
  std::printf("    semitoneRatio: worst %.2e cent against exp2 over -120..+120 semitones\n", worst);
  MW_EXPECT(worst <= 1.0e-3);
}

MW_TEST_MAIN("sample-classic")
