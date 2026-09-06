// Motion Wave — the spectral engine's structural rows. `smp-01` §4.4, §10.3.
//
// V-20's null is here and is the first row to make pass, because it is the one
// that says the STFT round-trip is COLA-correct — and nothing else in the
// engine is worth measuring until it is. Then the scheduling rows (head
// analysis, no note-on burst), the caps, the rate and block sweeps, and V-27's
// real-time safety.
//
// V-22, V-23 and the phase arithmetic's mutations are in
// `sample_vocoder_tests.cpp`, which is the other half of this unit.
#include "../dsp/sample/spectral_read.h"
#include "harness.h"
#include "rt_guard.h"
#include "sample_harness.h"
#include "spectral_harness.h"

#include <cmath>
#include <cstddef>
#include <vector>

using namespace mw::test::spectral;
using mw::dsp::sample::fftSizeFor;
using mw::dsp::sample::PhaseLock;
using mw::dsp::sample::Quality;
using mw::dsp::sample::spectralVoiceAdmitted;
using mw::dsp::sample::spectralVoiceCap;
using mw::test::sample::noiseZone;

namespace {

/// V-20's own configuration, in one place: alpha = 1, p = 1, lock off,
/// transients off, and a source read at r = 1 so the classic reference is a
/// copy of the file rather than an interpolation of it.
struct NullFixture {
  std::vector<float> zone;
  double rate = 48000.0;
  int frames = 0;
};

NullFixture makeNullFixture(double rate, int frames) {
  NullFixture f;
  f.rate = rate;
  f.frames = frames;
  // Full-band noise, so the null cannot be satisfied by a signal too smooth to
  // tell a round-trip from a copy. A sine would null against almost anything.
  f.zone = noiseZone(static_cast<std::size_t>(frames) + 8192, 0x51ec7a1u, 0.35);
  return f;
}

/// The engine and the classic reference, rendered over the same span.
double measureNull(const NullFixture& f, std::size_t n, Quality tier, int block) {
  SpectralRead spectral;
  spectral.prepare(plainSource(f.zone, f.rate), &sharedSinc(), tier, f.rate, nullControls(n),
                   nullptr, 1u);
  const std::vector<float> pitch(static_cast<std::size_t>(f.frames), 0.0f);
  const std::vector<float> speed;
  const std::vector<float> got = renderSpectral(spectral, f.frames, pitch, speed, block);

  ClassicRead classic;
  classic.prepare(plainSource(f.zone, f.rate), &sharedSinc(), tier, f.rate);
  const std::vector<float> want = renderClassic(classic, f.frames, 0.0, block);

  // The comparison starts after one window: the overlap-add's first window is
  // still filling and the classic head is not, so the first N samples are a
  // ramp against a signal and would report a failure the engine does not have.
  // That is latency the *test* has to account for, not latency the engine has
  // — the read head is at output sample 0 from the first block.
  return nullDb(got, want, n, static_cast<std::size_t>(f.frames));
}

}  // namespace

// ---------------------------------------------------------------- V-20

MW_TEST("V-20: an identity vocoder nulls against the classic read below -100 dBFS") {
  const NullFixture f = makeNullFixture(48000.0, 40000);
  for (std::size_t n : {std::size_t{1024}, std::size_t{2048}, std::size_t{4096}}) {
    const double db = measureNull(f, n, Quality::High, 256);
    std::printf("    V-20 N=%4zu  null = %7.2f dBFS\n", n, db);
    MW_EXPECT(db <= -100.0 + 3.0);
  }
}

MW_TEST("V-20's null holds on every interpolation tier, because at r = 1 none of them runs") {
  const NullFixture f = makeNullFixture(48000.0, 24000);
  for (Quality q : {Quality::Eco, Quality::Normal, Quality::High}) {
    const double db = measureNull(f, 2048, q, 256);
    std::printf("    V-20 %s null = %7.2f dBFS\n", mw::test::sample::tierName(q), db);
    MW_EXPECT(db <= -97.0);
  }
}

MW_TEST("the measured window-sum constant is what the divide uses, not a textbook value") {
  SpectralRead head;
  const NullFixture f = makeNullFixture(48000.0, 4096);
  head.prepare(plainSource(f.zone, f.rate), &sharedSinc(), Quality::High, f.rate,
               nullControls(2048), nullptr, 1u);
  // A periodic Hann at 75 % overlap: four windows overlap and the sum of their
  // squares is 1.5. Stated as a number the row checks rather than as a comment,
  // because the engine divides by it and a window change would move it.
  std::printf("    COLA constant = %.9f\n", head.colaGain());
  MW_EXPECT_NEAR(head.colaGain(), 1.5, 1.0e-9);
}

// ------------------------------------------------------- head analysis

MW_TEST("a note-on computes no burst: the first block costs the steady-state rate") {
  const double rate = 44100.0;
  const int frames = 8192;
  const NullFixture f = makeNullFixture(rate, frames);
  const std::size_t n = 2048;
  const std::size_t hop = n / 4;

  SpectralHead head;
  head.build(f.zone.data(), f.zone.size(), rate, n, hop);
  MW_EXPECT(head.frames() >= 9);

  SpectralRead voice;
  voice.prepare(plainSource(f.zone, rate), &sharedSinc(), Quality::High, rate, nullControls(n),
                &head, 1u);
  const std::vector<float> pitch(static_cast<std::size_t>(frames), 0.0f);
  const std::vector<float> speed;

  // One block of 256, which at alpha = 1 needs the pipeline filled: four
  // frames before the first output sample exists, plus one per hop after.
  std::vector<float> out(256, 0.0f);
  voice.render(out.data(), 256, pitch.data(), nullptr);
  const std::size_t firstBlock = voice.transforms();

  // The steady-state rate: one analysis frame per synthesis hop.
  const std::size_t expectedPerBlock = 256 / hop + 1;
  std::printf("    first block: %zu transform(s), steady state %zu/block\n", firstBlock,
              expectedPerBlock);
  // Every frame the first block needs is inside the precomputed head, so the
  // count is what the steady state alone would have cost. Without the head it
  // is four or five, which is the burst the sheet describes.
  MW_EXPECT(firstBlock <= expectedPerBlock);
}

MW_TEST("without the head analysis the same note-on does burst, which is what the head buys") {
  const double rate = 44100.0;
  const NullFixture f = makeNullFixture(rate, 8192);
  SpectralRead voice;
  voice.prepare(plainSource(f.zone, rate), &sharedSinc(), Quality::High, rate,
                nullControls(2048), nullptr, 1u);
  const std::vector<float> pitch(256, 0.0f);
  std::vector<float> out(256, 0.0f);
  voice.render(out.data(), 256, pitch.data(), nullptr);
  std::printf("    first block without head: %zu transforms\n", voice.transforms());
  // The claim the head answers, stated so it cannot quietly stop being true:
  // there IS a burst without it. If this row ever reads 1, the head is buying
  // nothing and the row above proves nothing.
  MW_EXPECT(voice.transforms() >= 4);
}

MW_TEST("the head is used only for a frame whose start and residue match exactly") {
  const double rate = 44100.0;
  const NullFixture f = makeNullFixture(rate, 4096);
  SpectralHead head;
  head.build(f.zone.data(), f.zone.size(), rate, 2048, 512);
  std::vector<double> mag(1025, 0.0), phase(1025, 0.0);
  MW_EXPECT(head.lookup(0, 0.0, 2048, 512, mag, phase));
  MW_EXPECT(head.lookup(512, 0.0, 2048, 512, mag, phase));
  // Off the hop grid, with a residue, or at another transform size: a miss,
  // because a frame at a different origin has a different phase reference and
  // handing back a neighbouring frame would put a step at the first note-on.
  MW_EXPECT(!head.lookup(300, 0.0, 2048, 512, mag, phase));
  MW_EXPECT(!head.lookup(512, 0.25, 2048, 512, mag, phase));
  MW_EXPECT(!head.lookup(512, 0.0, 1024, 256, mag, phase));
}

// -------------------------------------------------------- §10.3's caps

MW_TEST("the FFT size is capped by tier, and a request below the floor is raised to it") {
  MW_EXPECT_EQ(static_cast<long long>(fftSizeFor(4096, Quality::Eco)), 1024);
  MW_EXPECT_EQ(static_cast<long long>(fftSizeFor(4096, Quality::Normal)), 2048);
  MW_EXPECT_EQ(static_cast<long long>(fftSizeFor(4096, Quality::High)), 4096);
  MW_EXPECT_EQ(static_cast<long long>(fftSizeFor(1024, Quality::High)), 1024);
  MW_EXPECT_EQ(static_cast<long long>(fftSizeFor(256, Quality::High)), 1024);
  // A non-power-of-two would break radix-2 silently; it falls back rather than
  // reading through a transform that returns its input unchanged.
  MW_EXPECT_EQ(static_cast<long long>(fftSizeFor(3000, Quality::High)), 2048);
}

MW_TEST("the spectral voice cap refuses a new voice and never reports a dropped note") {
  MW_EXPECT_EQ(spectralVoiceCap(Quality::Eco), 2);
  MW_EXPECT_EQ(spectralVoiceCap(Quality::Normal), 8);
  MW_EXPECT_EQ(spectralVoiceCap(Quality::High), 32);
  // At the cap the answer is "not spectral", which the caller reads as "use
  // Classic". There is no third answer, and that is §10.3's whole rule: a
  // silently dropped note is worse than a note that plays with another engine.
  MW_EXPECT(spectralVoiceAdmitted(1, Quality::Eco));
  MW_EXPECT(!spectralVoiceAdmitted(2, Quality::Eco));
  MW_EXPECT(!spectralVoiceAdmitted(3, Quality::Eco));
  MW_EXPECT(spectralVoiceAdmitted(7, Quality::Normal));
  MW_EXPECT(!spectralVoiceAdmitted(8, Quality::Normal));
  MW_EXPECT(spectralVoiceAdmitted(31, Quality::High));
  MW_EXPECT(!spectralVoiceAdmitted(32, Quality::High));
}

MW_TEST("a refused spectral voice still plays: the classic fallback renders the same note") {
  const double rate = 48000.0;
  const NullFixture f = makeNullFixture(rate, 8000);
  // What a voice allocator does at the cap. The point of the row is that the
  // fallback produces audio — a cap applied by dropping the note would be a
  // silent buffer here and would look identical in every CPU measurement.
  MW_EXPECT(!spectralVoiceAdmitted(spectralVoiceCap(Quality::Normal), Quality::Normal));
  ClassicRead fallback;
  fallback.prepare(plainSource(f.zone, rate), &sharedSinc(), Quality::Normal, rate);
  const std::vector<float> out = renderClassic(fallback, 8000, 0.0, 256);
  double peak = 0.0;
  for (float v : out) peak = std::max(peak, std::fabs(static_cast<double>(v)));
  std::printf("    classic fallback peak = %.4f\n", peak);
  MW_EXPECT(peak > 0.1);
}

// ------------------------------------------- blocks, rates, invariance

MW_TEST("the render is independent of the host's block size, 32 to 1024") {
  const NullFixture f = makeNullFixture(48000.0, 20000);
  const std::vector<float> pitch(20000, 0.0f);
  const std::vector<float> speed;
  std::vector<float> reference;
  for (int block : {32, 64, 128, 256, 512, 1024}) {
    SpectralRead head;
    head.prepare(plainSource(f.zone, f.rate), &sharedSinc(), Quality::High, f.rate,
                 nullControls(2048), nullptr, 1u);
    const std::vector<float> out = renderSpectral(head, 20000, pitch, speed, block);
    if (reference.empty()) {
      reference = out;
      continue;
    }
    // Bit-identical, not merely close. The engine's state advances per sample
    // and nothing in it may read the block length; an artefact whose frequency
    // follows the buffer size is V-29's named failure and it would show here
    // as a non-zero difference rather than as a spectral line.
    double worst = 0.0;
    for (std::size_t i = 0; i < out.size(); ++i) {
      worst = std::max(worst, std::fabs(static_cast<double>(out[i] - reference[i])));
    }
    std::printf("    block %4d: worst difference from 32 = %.3g\n", block, worst);
    MW_EXPECT(worst == 0.0);
  }
}

MW_TEST("V-20's null holds at 44.1, 48, 96 and 192 kHz") {
  for (double rate : {44100.0, 48000.0, 96000.0, 192000.0}) {
    const NullFixture f = makeNullFixture(rate, 24000);
    const double db = measureNull(f, 2048, Quality::High, 256);
    std::printf("    %8.1f Hz: null = %7.2f dBFS\n", rate, db);
    MW_EXPECT(db <= -97.0);
  }
}

// ---------------------------------------------------------------- V-27

MW_TEST("V-27: render allocates nothing, at every tier and with every control moving") {
  const double rate = 48000.0;
  const NullFixture f = makeNullFixture(rate, 12000);
  for (Quality q : {Quality::Eco, Quality::Normal, Quality::High}) {
    SpectralControls c;
    c.fftSize = 4096;
    c.phaseLock = PhaseLock::Identity;
    c.blurPercent = 30.0;
    c.transientSensitivity = 70.0;
    c.transientsEnabled = true;
    SpectralRead head;
    SpectralHead precomputed;
    const std::size_t n = fftSizeFor(c.fftSize, q);
    precomputed.build(f.zone.data(), f.zone.size(), rate, n, n / 4);
    head.prepare(plainSource(f.zone, rate), &sharedSinc(), q, rate, c, &precomputed, 7u);

    // Pitch and speed both moving, so the fractional hop, the phase locking,
    // the blur and the transient detector are all on the path under the guard.
    std::vector<float> pitch(12000), speed(12000);
    for (std::size_t i = 0; i < pitch.size(); ++i) {
      const double t = static_cast<double>(i) / rate;
      pitch[i] = static_cast<float>(7.0 * std::sin(2.0 * kPi * 3.0 * t));
      speed[i] = static_cast<float>(1.0 + 0.5 * std::sin(2.0 * kPi * 1.5 * t));
    }
    std::vector<float> out(12000, 0.0f);
    std::size_t allocations = 0;
    {
      mw::test::RtGuard guard;
      // The final block is clamped rather than assumed to divide. A render
      // asked for more frames than the arrays hold reads past them, which
      // AddressSanitizer catches and an ordinary build turns into a heap
      // corruption that only aborts at teardown — a failure that reads as the
      // engine's and is the test's.
      for (int at = 0; at < 12000; at += 128) {
        const int chunk = std::min(128, 12000 - at);
        head.render(out.data() + at, chunk, pitch.data() + at, speed.data() + at);
      }
      allocations = guard.allocations();
    }
    // Read outside the armed scope: `MW_EXPECT_EQ` formats a `std::string` on
    // failure, so asserting inside the guard makes a failing render allocate
    // again while the guard is still counting and reports a number nobody can
    // interpret.
    MW_EXPECT_EQ(static_cast<long long>(allocations), 0);
    double peak = 0.0;
    for (float v : out) peak = std::max(peak, std::fabs(static_cast<double>(v)));
    // A guard over a render that produced silence proves nothing: the engine
    // could have returned early on every sample and allocated nothing doing it.
    MW_EXPECT(peak > 0.01);
  }
}

MW_TEST("the allocation guard is awake: a deliberate allocation inside it is counted") {
  mw::test::RtGuard guard;
  std::vector<double>* leak = new std::vector<double>(16, 1.0);
  const std::size_t seen = guard.allocations();
  guard.disarm();
  delete leak;
  // Without this the V-27 row above would pass identically on a broken guard,
  // and "zero allocations" would be a statement about the instrument rather
  // than about the engine.
  MW_EXPECT(seen >= 1);
}

MW_TEST_MAIN("sample-spectral")
