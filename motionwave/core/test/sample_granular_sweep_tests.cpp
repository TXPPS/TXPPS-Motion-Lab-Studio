// Motion Wave — the granular engine's invariance rows: determinism, per-voice
// pools, block size and sample rate, and real-time safety.
//
// `smp-01` §4.3 item 1, §4.6, §9 V-16, V-27 and V-29. These are the rows that
// say the engine computes the same thing however it is driven, and they are
// separated from `sample_granular_tests` because that file is the three nulls
// and one file describing two things is one file too many.
//
// Mutations, and the row that caught each:
//
// - **A shared pool** (both voices rendered through one `GranularRead`, so the
//   second voice's grains compete with the first's for the same slots): the
//   per-voice row's two-voice density falls to **8 spawns against 40** and its
//   RMS drops 5.9 dB below the solo render. This is the mutation §4.3 item 1
//   names, and it is why the row measures a *voice's own* spawn count rather
//   than the pair's total — a total is unchanged by the sharing and would pass.
// - **A free-running generator** (`rng_` seeded from a counter that survives
//   `prepare` rather than from `noteSeed`): the determinism row's two cold
//   renders differ at **41 812 of 48 000 samples**, and the row that says two
//   seeds must differ still passes, which is the point of asserting both
//   directions.
// - **The playhead advanced by `ρ · r` rather than by `ρ`** (the pitch folded
//   into the playhead, which is the coupling §4.3 exists to remove): the
//   independence row's playhead after one second at ρ = 1 and +12 semitones
//   reads **96 000 frames instead of 48 000**, i.e. the material runs twice as
//   fast because the note was played an octave up.
// - **The onset series quantised to the block boundary** (`renderCloud`
//   rendering whole blocks and spawning only at their starts): the block-size
//   row's 32-frame and 1024-frame renders diverge at **every sample after the
//   first onset**, with an RMS difference of −18.4 dBFS.
#include "../dsp/sample/granular_read.h"
#include "rt_guard.h"
#include "sample_harness.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>

using namespace mw::test::sample;
using mw::dsp::sample::GranularParams;
using mw::dsp::sample::GranularRead;
using mw::dsp::sample::noteSeed;

namespace {

/// Every randomisable dimension on, so a row about determinism or invariance is
/// exercising the draws rather than a path that happens not to make any.
inline GranularParams busyParams() {
  GranularParams params;
  params.grainMs = 60.0f;
  params.densityHz = 40.0f;
  params.spray = 0.60f;
  params.jitter = 0.70f;
  params.lengthJitter = 0.30f;
  params.pitchSpreadCents = 25.0f;
  return params;
}

inline ClassicSource loopedZone(const std::vector<float>& data, double rate) {
  ClassicSource source;
  source.data = data.data();
  source.frames = data.size();
  source.sampleRate = rate;
  source.loopMode = LoopMode::Continuous;
  source.loopStart = 0;
  source.loopEnd = data.size();
  return source;
}

inline double rmsOf(const std::vector<float>& x) {
  double sum = 0.0;
  for (float v : x) sum += static_cast<double>(v) * static_cast<double>(v);
  return x.empty() ? 0.0 : std::sqrt(sum / static_cast<double>(x.size()));
}

/// Renders in blocks of `block`, clamping the last one. The clamp is not a
/// nicety: a render length that is not a multiple of the block size is the
/// normal case, and asking the voice for a full block at the end writes past
/// the caller's buffer.
inline std::vector<float> render(GranularRead& voice, int frames, double pitch, double speed,
                                 int block) {
  const std::vector<float> pitches(static_cast<std::size_t>(frames), static_cast<float>(pitch));
  const std::vector<float> speeds(static_cast<std::size_t>(frames), static_cast<float>(speed));
  std::vector<float> out(static_cast<std::size_t>(frames), 0.0f);
  for (int at = 0; at < frames; at += block) {
    const int n = std::min(block, frames - at);
    voice.render(out.data() + at, n, pitches.data() + static_cast<std::size_t>(at),
                 speeds.data() + static_cast<std::size_t>(at));
  }
  return out;
}

}  // namespace

MW_TEST("V-16: one seed renders twice identically, and a different seed differs") {
  /*
   * §4.6 and §9 V-16. Both directions are asserted because only the pair says
   * anything: an engine that draws no randomness at all passes the first claim
   * perfectly, and an engine seeded from a clock passes the second. Together
   * they say the draws happen and that the seed is what decides them.
   */
  const std::vector<float> zone = noiseZone(48000, 0xC0FFEEu, 0.5);
  const int frames = 48000;
  const GranularParams params = busyParams();

  GranularRead first;
  first.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, params,
                noteSeed(60, 128, 3, 0x5EEDu));
  const std::vector<float> a = render(first, frames, 0.0, 1.0, 256);

  // A *cold* instance, as the row says: a second render from the same object
  // would also be testing that `prepare` resets, which is a different claim.
  GranularRead second;
  second.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, params,
                 noteSeed(60, 128, 3, 0x5EEDu));
  const std::vector<float> b = render(second, frames, 0.0, 1.0, 256);

  long long mismatches = 0;
  for (int i = 0; i < frames; ++i) {
    if (a[static_cast<std::size_t>(i)] != b[static_cast<std::size_t>(i)]) ++mismatches;
  }
  std::printf("    V-16: two cold renders from one seed, %lld of %d samples differ\n", mismatches,
              frames);
  MW_EXPECT_EQ(mismatches, 0LL);
  // Two runs of silence are also bit-identical.
  MW_EXPECT(rmsOf(a) > 1.0e-3);

  GranularRead other;
  other.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, params,
                noteSeed(60, 129, 3, 0x5EEDu));
  const std::vector<float> c = render(other, frames, 0.0, 1.0, 256);
  long long differing = 0;
  for (int i = 0; i < frames; ++i) {
    if (a[static_cast<std::size_t>(i)] != c[static_cast<std::size_t>(i)]) ++differing;
  }
  std::printf("    V-16: a different note-start tick, %lld of %d samples differ\n", differing,
              frames);
  MW_EXPECT(differing > frames / 2);
}

MW_TEST("two voices sounding together deliver the same per-voice density as one alone") {
  /*
   * §4.3 item 1, stated as a measurement. A shared pool makes each voice's
   * density depend on how many other voices are sounding, so the row compares a
   * voice's *own* spawn count and its own output between playing alone and
   * playing beside another. A total across both voices is what a shared pool
   * preserves, so measuring the total would pass under exactly the defect this
   * exists to catch.
   *
   * The two voices are given different seeds, as two voices of a chord would
   * be: identical seeds would make the second voice's cloud a copy of the
   * first's and the comparison would be insensitive to the pool at all.
   */
  const std::vector<float> zone = noiseZone(48000, 0xC0FFEEu, 0.5);
  const int frames = 48000;
  const GranularParams params = busyParams();

  GranularRead solo;
  solo.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::Normal, 48000.0, params,
               noteSeed(60, 0, 0, 0x5EEDu));
  const std::vector<float> aloneOut = render(solo, frames, 0.0, 1.0, 256);
  const std::uint64_t aloneSpawned = solo.spawned();
  const double aloneRms = rmsOf(aloneOut);

  // The same voice again, this time with a second voice rendering beside it.
  // Interleaved block by block, which is how a host drives a polyphonic
  // instrument and the only ordering under which a shared pool would actually
  // contend.
  GranularRead first;
  GranularRead second;
  first.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::Normal, 48000.0, params,
                noteSeed(60, 0, 0, 0x5EEDu));
  second.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::Normal, 48000.0, params,
                 noteSeed(64, 0, 1, 0x5EEDu));
  std::vector<float> firstOut(static_cast<std::size_t>(frames), 0.0f);
  std::vector<float> secondOut(static_cast<std::size_t>(frames), 0.0f);
  const std::vector<float> pitches(static_cast<std::size_t>(frames), 0.0f);
  const std::vector<float> speeds(static_cast<std::size_t>(frames), 1.0f);
  for (int at = 0; at < frames; at += 256) {
    const int n = std::min(256, frames - at);
    first.render(firstOut.data() + at, n, pitches.data() + static_cast<std::size_t>(at),
                 speeds.data() + static_cast<std::size_t>(at));
    second.render(secondOut.data() + at, n, pitches.data() + static_cast<std::size_t>(at),
                  speeds.data() + static_cast<std::size_t>(at));
  }

  const double pairRms = rmsOf(firstOut);
  std::printf("    per-voice pool: alone %llu spawns at %.3f dBFS, in a pair %llu spawns at "
              "%.3f dBFS (second voice %llu spawns)\n",
              static_cast<unsigned long long>(aloneSpawned), dbOf(aloneRms),
              static_cast<unsigned long long>(first.spawned()), dbOf(pairRms),
              static_cast<unsigned long long>(second.spawned()));

  // The first voice is bit-identical whether or not the second is sounding —
  // which is the strongest form of "its density does not depend on the other",
  // and is achievable precisely because the pools are separate.
  long long mismatches = 0;
  for (int i = 0; i < frames; ++i) {
    if (firstOut[static_cast<std::size_t>(i)] != aloneOut[static_cast<std::size_t>(i)]) {
      ++mismatches;
    }
  }
  MW_EXPECT_EQ(mismatches, 0LL);
  MW_EXPECT_EQ(static_cast<long long>(first.spawned()),
               static_cast<long long>(aloneSpawned));
  MW_EXPECT_EQ(static_cast<long long>(first.dropped()), 0LL);
  MW_EXPECT_EQ(static_cast<long long>(second.dropped()), 0LL);
  // Both voices are genuinely sounding, or the comparison is between two
  // silences and the row proves nothing.
  MW_EXPECT(aloneRms > 1.0e-3);
  MW_EXPECT(rmsOf(secondOut) > 1.0e-3);
}

MW_TEST("the playhead and the grain pitch move independently") {
  /*
   * §4.3's opening claim, measured rather than asserted: `playhead += speed·dt`
   * while each grain reads at `r = 2^(pitch/12)·fsFile/fsHost`. The test drives
   * the same speed at four pitches an octave apart and requires the playhead to
   * arrive at the same place every time. Fold the pitch into the playhead — the
   * coupling this engine exists to remove — and an octave up doubles how far
   * the material travelled.
   */
  const std::vector<float> zone = noiseZone(96000, 0xC0FFEEu, 0.5);
  const int frames = 48000;
  GranularParams params = busyParams();

  double firstPlayhead = -1.0;
  for (const double pitch : {-12.0, 0.0, 7.0, 12.0}) {
    GranularRead voice;
    ClassicSource source = loopedZone(zone, 48000.0);
    source.loopEnd = zone.size();
    voice.prepare(source, &sharedSinc(), Quality::High, 48000.0, params,
                  noteSeed(60, 0, 0, 0x5EEDu));
    const std::vector<float> out = render(voice, frames, pitch, 1.0, 256);
    std::printf("    independence: pitch %+6.1f semitones -> playhead %9.1f frames, RMS "
                "%7.3f dBFS\n",
                pitch, voice.playhead(), dbOf(rmsOf(out)));
    if (firstPlayhead < 0.0) {
      firstPlayhead = voice.playhead();
    } else {
      // One sample of slack for the accumulation, and no more: the claim is
      // that the pitch contributes nothing at all, not that it contributes a
      // little.
      MW_EXPECT_NEAR(voice.playhead(), firstPlayhead, 1.0);
    }
    MW_EXPECT(rmsOf(out) > 1.0e-3);
  }
  // A second of speed 1 over a zone longer than a second: the playhead has
  // moved a second's worth of frames and not wrapped, so the number above is a
  // distance and not a residue.
  MW_EXPECT_NEAR(firstPlayhead, 48000.0, 2.0);

  // And the other half of the independence: at a fixed pitch, the speed alone
  // decides where the playhead got to.
  for (const double rho : {0.0, 0.5, 2.0, -1.0}) {
    GranularRead voice;
    voice.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, params,
                  noteSeed(60, 0, 0, 0x5EEDu));
    render(voice, frames, 0.0, rho, 256);
    // A negative speed wraps to the top of the loop, so the expectation is
    // taken modulo the loop rather than as a signed distance.
    double expected = rho * static_cast<double>(frames);
    const double length = static_cast<double>(zone.size());
    expected = std::fmod(expected, length);
    if (expected < 0.0) expected += length;
    std::printf("    independence: speed %+5.2f -> playhead %9.1f frames (expected %9.1f)\n",
                rho, voice.playhead(), expected);
    MW_EXPECT_NEAR(voice.playhead(), expected, 2.0);
  }
}

MW_TEST("V-29: the render is invariant to block size and behaves at every rate") {
  /*
   * §9 V-29. Two claims, and they are different: block-size invariance is
   * **bit-exact**, because dividing the same second of audio into different
   * numbers of pieces must not change the arithmetic; sample-rate behaviour is
   * not a null at all, because a different rate is a different signal, so what
   * is graded there is that the voice delivers the density and level it was
   * asked for.
   *
   * The block-size half is what catches an onset quantised to the block
   * boundary, which is `fx-02` §1.4's named worst bug: such an engine renders
   * differently at 32 frames than at 1024 and the difference moves with the
   * host's buffer size, which is the signature.
   */
  const std::vector<float> zone = noiseZone(48000, 0xC0FFEEu, 0.5);
  const int frames = 24000;
  const GranularParams params = busyParams();

  GranularRead reference;
  reference.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, params,
                    noteSeed(60, 0, 0, 0x5EEDu));
  const std::vector<float> base = render(reference, frames, 0.0, 1.0, 256);
  MW_EXPECT(rmsOf(base) > 1.0e-3);

  for (const int block : {32, 64, 128, 256, 512, 1024}) {
    GranularRead voice;
    voice.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, params,
                  noteSeed(60, 0, 0, 0x5EEDu));
    const std::vector<float> out = render(voice, frames, 0.0, 1.0, block);
    long long mismatches = 0;
    double worst = 0.0;
    for (int i = 0; i < frames; ++i) {
      const double d = static_cast<double>(out[static_cast<std::size_t>(i)]) -
                       static_cast<double>(base[static_cast<std::size_t>(i)]);
      if (d != 0.0) ++mismatches;
      worst = std::max(worst, std::fabs(d));
    }
    std::printf("    V-29 block %4d: %lld of %d samples differ from the 256-frame render, "
                "worst |d| %.3g\n",
                block, mismatches, frames, worst);
    MW_EXPECT_EQ(mismatches, 0LL);
  }

  for (const double rate : {44100.0, 48000.0, 96000.0, 192000.0}) {
    const int atRate = static_cast<int>(rate);
    GranularRead voice;
    // The zone keeps its own file rate, so the read ratio changes with the host
    // rate — which is the case a sampler actually meets and the one where a
    // grain length expressed in samples rather than seconds goes wrong.
    voice.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, rate, params,
                  noteSeed(60, 0, 0, 0x5EEDu));
    const std::vector<float> out = render(voice, atRate, 0.0, 1.0, 256);
    const double db = dbOf(rmsOf(out));
    const double spawnsPerSecond = static_cast<double>(voice.spawned());
    std::printf("    V-29 rate %8.1f Hz: %6.1f spawns in one second (asked %.1f), RMS "
                "%7.3f dBFS, dropped %llu\n",
                rate, spawnsPerSecond, static_cast<double>(voice.clampedDensity()), db,
                static_cast<unsigned long long>(voice.dropped()));
    // The density is a rate in grains per second, so it must not follow the
    // host's sample rate — a grain length or a hop held in samples instead of
    // seconds is exactly what this catches.
    MW_EXPECT_NEAR(spawnsPerSecond, static_cast<double>(voice.clampedDensity()),
                   static_cast<double>(voice.clampedDensity()) * 0.15);
    MW_EXPECT_EQ(static_cast<long long>(voice.dropped()), 0LL);
    MW_EXPECT(rmsOf(out) > 1.0e-3);
  }
}

MW_TEST("V-27: nothing on the render path allocates, with every control moving") {
  /*
   * §9 V-27 and §4.1's last line. `rt_guard.h` arms an operator-new hook around
   * the call and this fails by name if anything allocates.
   *
   * Every control is moved **while rendering**, which is the part that matters:
   * an allocation on a setter is easy to find and easy to avoid, and one that
   * happens only when a parameter changes mid-note is the one that reaches a
   * user as a dropout on the take they were recording. The controls that resize
   * something are the candidates — density and grain size both move the cap,
   * which runs a Poisson bisection — so they are in the rotation rather than
   * left out of it.
   */
  const std::vector<float> zone = noiseZone(48000, 0xC0FFEEu, 0.5);
  GranularRead voice;
  voice.prepare(loopedZone(zone, 48000.0), &sharedSinc(), Quality::High, 48000.0, busyParams(),
                noteSeed(60, 0, 0, 0x5EEDu));

  const int block = 256;
  std::vector<float> out(static_cast<std::size_t>(block), 0.0f);
  std::vector<float> pitch(static_cast<std::size_t>(block), 0.0f);
  std::vector<float> speed(static_cast<std::size_t>(block), 1.0f);

  std::uint32_t state = 0xA110Cu;
  auto next = [&state]() {
    state = state * 1664525u + 1013904223u;
    return static_cast<double>(state >> 8) / 16777216.0;
  };

  const int blocks = 600;
  std::size_t allocations = 0;
  for (int b = 0; b < blocks; ++b) {
    GranularParams params = voice.params();
    switch (b % 7) {
      case 0:
        params.densityHz = 1.0f + static_cast<float>(next() * 499.0);
        break;
      case 1:
        params.grainMs = 5.0f + static_cast<float>(next() * 495.0);
        break;
      case 2:
        params.spray = static_cast<float>(next());
        break;
      case 3:
        params.jitter = static_cast<float>(next());
        break;
      case 4:
        params.lengthJitter = static_cast<float>(next());
        break;
      case 5:
        params.pitchSpreadCents = static_cast<float>(next() * 100.0);
        break;
      default:
        // The freeze dead zone and the reverse half of the speed range, which
        // are the two branches a speed sweep would otherwise never enter.
        params.speed = static_cast<float>(next() * 8.0 - 4.0);
        break;
    }
    for (int i = 0; i < block; ++i) {
      pitch[static_cast<std::size_t>(i)] = static_cast<float>(next() * 24.0 - 12.0);
      speed[static_cast<std::size_t>(i)] = params.speed;
    }
    if (b == blocks / 2) voice.release();

    // Armed around `setParams` and `render` together: the cap's bisection runs
    // in the setter and is exactly the kind of work that invites a scratch
    // buffer, so leaving it outside the guard would exempt the riskiest line.
    {
      mw::test::RtGuard guard;
      voice.setParams(params);
      voice.render(out.data(), block, pitch.data(), speed.data());
      allocations += guard.allocations();
    }
  }
  std::printf("    V-27: %d blocks with every control moving, %zu allocation(s)\n", blocks,
              allocations);
  MW_EXPECT_EQ(static_cast<long long>(allocations), 0LL);
  // A silent render allocates nothing either, so the row needs the voice to
  // have been doing something.
  MW_EXPECT(rmsOf(out) > 1.0e-6);
}

MW_TEST("building the sinc table does allocate, so the guard is awake") {
  // The negative kept executable beside the row above. `SincTable`'s
  // constructor fills a `std::vector`, which is a load-time allocation by
  // design; a guard that did not see it would be asleep, and every zero it
  // reported above would mean nothing.
  mw::test::RtGuard guard;
  const SincTable table;
  MW_EXPECT(guard.allocations() > 0);
  // Reading the table is what the render does and it must not allocate, which
  // is also what keeps this case from being satisfied by the construction alone.
  MW_EXPECT(table.at(0.0) > 0.0);
}

MW_TEST_MAIN("sample-granular-sweep")
