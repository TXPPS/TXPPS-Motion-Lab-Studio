// Motion Wave — the substrate's parameters. `lib-voice-substrate.md` §3's last
// file, held to ADR-0004: one static table, every control reaching the config
// it names, and nothing allocated after the set is built.
//
// The wiring sweep is the case that matters. `CLAUDE.md` classes a control
// that does nothing with a wrong number, and a binder that quietly reads the
// wrong index — or none — is exactly that: the face draws the knob, the set
// carries the value, and the substrate never hears it. So every parameter is
// posted away from its default and the bound config is required to change in
// the field the parameter names, which is the same shape `schemaWired` takes
// in the web product.
//
// Mutation-tested, each edit restored before the next, and recorded as
// observed rather than as predicted:
//   `kGlideLaw` renumbered onto `kGlideTime`'s offset → red: the layout case
//     (an unwritten slot and a duplicate id), the taper case (the law's spec
//     overwrote the time's) and the glide wiring sweep; nothing else.
//   the glide time's taper declared Linear → red: the taper case only.
//   `glideConfigFrom` no longer reading κ → red: the glide wiring sweep only.
//   `kGlideShapeChoices` shortened to two entries with `steps` left at three
//     → red: the choice-order case only.
//   `tuneRequested` reporting a level rather than an edge → red: the tune
//     case only.
//   `adsrShapeFrom` writing the sustain level into the decay's target only →
//     red: the LFO/envelope/voice wiring sweep only (the hold segment no
//     longer moves, and the sustain bit requires both segments to).
#include "../dsp/voice/specs.h"
#include "harness.h"
#include "rt_guard.h"

#include <cmath>
#include <cstddef>

using namespace mw;
using namespace mw::dsp::voice;
using namespace mw::dsp::voice::param;

namespace {

/// The one static table a unit would declare, at a base that is not zero so
/// an offset used as an id would show.
constexpr ParamId kBase = 100;
ParamSpec gSpecs[kSubstrateParamCount];
bool gWritten = false;

const ParamSpec* specs() {
  if (!gWritten) {
    writeSubstrateSpecs(kBase, gSpecs);
    gWritten = true;
  }
  return gSpecs;
}

/// A set is built in place — its ring holds atomics, so it cannot be moved —
/// and settled at its defaults before a case reads it.
void settle(ParamSet& set) {
  set.prepare(48000.0f, 128);
  set.beginBlock();
}

/// Posts a value as far from the default as the range allows and settles it.
void moveAway(ParamSet& set, std::size_t index) {
  const ParamSpec& spec = set.spec(index);
  const float def = spec.defaultNormalised();
  set.post(spec.id, def < 0.5f ? 1.0f : 0.0f);
  for (int i = 0; i < 400; ++i) set.beginBlock();
}

int glideDiff(const GlideConfig& a, const GlideConfig& b) {
  int bits = 0;
  bits |= a.trigger != b.trigger ? 1 << 0 : 0;
  bits |= a.shape != b.shape ? 1 << 1 : 0;
  bits |= a.timeSeconds != b.timeSeconds ? 1 << 2 : 0;
  bits |= a.kappa != b.kappa ? 1 << 3 : 0;
  bits |= a.stagger != b.stagger ? 1 << 4 : 0;
  bits |= a.staggerMode != b.staggerMode ? 1 << 5 : 0;
  bits |= a.staggerOrder != b.staggerOrder ? 1 << 6 : 0;
  return bits;
}

int lfoDiff(const LfoConfig& a, const LfoConfig& b) {
  int bits = 0;
  bits |= a.wave != b.wave ? 1 << 0 : 0;
  bits |= a.rateHz != b.rateHz ? 1 << 1 : 0;
  bits |= a.delaySeconds != b.delaySeconds ? 1 << 2 : 0;
  bits |= a.fadeSeconds != b.fadeSeconds ? 1 << 3 : 0;
  bits |= a.amplitude != b.amplitude ? 1 << 4 : 0;
  bits |= a.retrigger != b.retrigger ? 1 << 5 : 0;
  return bits;
}

int envelopeDiff(const EnvelopeShape& a, const EnvelopeShape& b) {
  int bits = 0;
  bits |= a.segments[0].parameter != b.segments[0].parameter ? 1 << 0 : 0;
  bits |= a.segments[1].parameter != b.segments[1].parameter ? 1 << 1 : 0;
  // Sustain is one control over two segments — the decay's target and the
  // hold — and it has to move both, or the envelope decays to one level and
  // holds at another.
  bits |= (a.segments[1].target != b.segments[1].target && a.segments[2].target != b.segments[2].target)
              ? 1 << 2
              : 0;
  bits |= a.segments[3].parameter != b.segments[3].parameter ? 1 << 3 : 0;
  return bits;
}

int voiceDiff(const VoiceSetConfig& a, const VoiceSetConfig& b) {
  int bits = 0;
  bits |= a.capacity != b.capacity ? 1 << 0 : 0;
  bits |= a.unison != b.unison ? 1 << 1 : 0;
  bits |= a.allocation != b.allocation ? 1 << 2 : 0;
  return bits;
}

}  // namespace

// ───────────────────────────────────────────────────────── the table

MW_TEST("every writer numbers its block from the base, and the combined layout has no duplicate id") {
  const ParamSpec* table = specs();
  int wrong = 0;
  int duplicates = 0;
  for (std::size_t i = 0; i < kSubstrateParamCount; ++i) {
    wrong += table[i].id != kBase + static_cast<ParamId>(i) ? 1 : 0;
    for (std::size_t j = 0; j < i; ++j) duplicates += table[i].id == table[j].id ? 1 : 0;
    MW_EXPECT(table[i].name != nullptr && table[i].name[0] != '\0');
  }
  MW_EXPECT_EQ(wrong, 0);
  MW_EXPECT_EQ(duplicates, 0);
  MW_EXPECT_EQ(static_cast<int>(kSubstrateParamCount), 22);
  // Each block's own writer agrees with the combined one, so a unit that
  // declares only a glide gets the same glide.
  ParamSpec glide[kGlideParamCount];
  writeGlideSpecs(kBase, glide);
  for (std::size_t i = 0; i < kGlideParamCount; ++i) {
    MW_EXPECT_EQ(static_cast<int>(glide[i].id), static_cast<int>(table[kGlideFirst + i].id));
    MW_EXPECT_NEAR(glide[i].def, table[kGlideFirst + i].def, 0.0f);
  }
}

MW_TEST("every spec round-trips through its own taper, so a face and the substrate cannot disagree") {
  const ParamSpec* table = specs();
  for (std::size_t i = 0; i < kSubstrateParamCount; ++i) {
    const ParamSpec& spec = table[i];
    for (int step = 0; step <= 20; ++step) {
      const float n = static_cast<float>(step) / 20.0f;
      const float back = spec.toNormalised(spec.toReal(n));
      // A stepped control round-trips to its nearest step, so its bound is
      // half a step — 0.5 for a two-way switch, a sixty-second for the cap.
      const bool quantised = spec.taper == Taper::Stepped || spec.isChoice();
      const float tolerance =
          quantised ? 0.5f / static_cast<float>(spec.steps > 1 ? spec.steps - 1 : 1) + 1e-3f : 1e-4f;
      MW_EXPECT_NEAR(back, n, tolerance);
    }
    // A default outside its own range would be a knob that starts somewhere
    // it cannot be set to.
    MW_EXPECT(spec.def >= spec.min && spec.def <= spec.max);
  }
}

MW_TEST("the glide time is a millisecond at the bottom, thirty seconds at the top and 173 ms half way") {
  const ParamSpec& time = specs()[kGlideFirst + kGlideTime];
  MW_EXPECT_NEAR(time.toReal(0.0f), kGlideMinSeconds, 1e-6);
  MW_EXPECT_NEAR(time.toReal(1.0f), kGlideMaxSeconds, 1e-3);
  // The geometric middle of the clamps, which is what makes a millisecond
  // and a second equally reachable.
  MW_EXPECT_NEAR(time.toReal(0.5f), std::sqrt(kGlideMinSeconds * kGlideMaxSeconds), 1e-4);
  MW_EXPECT_NEAR(time.toReal(time.defaultNormalised()), 0.4f, 1e-4);
}

MW_TEST("each choice list is in its enum's order, and its length is what the spec declares") {
  const ParamSpec* table = specs();
  MW_EXPECT_EQ(static_cast<int>(sizeof(kGlideTriggerChoices) / sizeof(kGlideTriggerChoices[0])),
               table[kGlideFirst + kGlideTrigger].steps);
  MW_EXPECT_EQ(static_cast<int>(sizeof(kGlideShapeChoices) / sizeof(kGlideShapeChoices[0])),
               table[kGlideFirst + kGlideShape].steps);
  MW_EXPECT_EQ(static_cast<int>(sizeof(kStaggerOrderChoices) / sizeof(kStaggerOrderChoices[0])),
               table[kGlideFirst + kGlideStaggerOrder].steps);
  MW_EXPECT_EQ(static_cast<int>(sizeof(kLfoWaveChoices) / sizeof(kLfoWaveChoices[0])),
               table[kLfoFirst + kLfoWave].steps);
  MW_EXPECT_EQ(static_cast<int>(sizeof(kLfoRetriggerChoices) / sizeof(kLfoRetriggerChoices[0])),
               table[kLfoFirst + kLfoRetrigger].steps);
  MW_EXPECT_EQ(static_cast<int>(sizeof(kAllocationChoices) / sizeof(kAllocationChoices[0])),
               table[kVoiceFirst + kAllocation].steps);
  // The last entry of each list is the enum's last member, so the top of the
  // control reaches the last choice and no further.
  ParamSet set(specs(), kSubstrateParamCount);
  settle(set);
  set.post(table[kGlideFirst + kGlideTrigger].id, 1.0f);
  set.post(table[kGlideFirst + kGlideShape].id, 1.0f);
  set.post(table[kGlideFirst + kGlideStaggerOrder].id, 1.0f);
  set.post(table[kLfoFirst + kLfoWave].id, 1.0f);
  set.post(table[kLfoFirst + kLfoRetrigger].id, 1.0f);
  set.beginBlock();
  const GlideConfig glide = glideConfigFrom(set, kGlideFirst, GlideConfig{});
  const LfoConfig lfo = lfoConfigFrom(set, kLfoFirst, LfoConfig{});
  MW_EXPECT(glide.trigger == GlideTrigger::Legato);
  MW_EXPECT(glide.shape == GlideShape::SCurve);
  MW_EXPECT(glide.staggerOrder == StaggerOrder::PlayOrder);
  MW_EXPECT(lfo.wave == LfoWave::SampleInput);
  MW_EXPECT(lfo.retrigger == LfoRetrigger::External);
}

// ───────────────────────────────────────────────────────── the wiring

MW_TEST("every glide parameter reaches the field of the glide configuration it names") {
  ParamSet base(specs(), kSubstrateParamCount);
  settle(base);
  const GlideConfig rest = glideConfigFrom(base, kGlideFirst, GlideConfig{});
  for (std::size_t p = 0; p < kGlideParamCount; ++p) {
    ParamSet set(specs(), kSubstrateParamCount);
    settle(set);
    moveAway(set, kGlideFirst + p);
    const int changed = glideDiff(glideConfigFrom(set, kGlideFirst, GlideConfig{}), rest);
    MW_EXPECT_EQ(changed, 1 << p);
  }
  // Defaults land as the design states them, in the units the config reads.
  MW_EXPECT(rest.trigger == GlideTrigger::Off);
  MW_EXPECT(rest.shape == GlideShape::Rc);
  MW_EXPECT_NEAR(rest.timeSeconds, 0.4f, 1e-4);
  MW_EXPECT_NEAR(rest.kappa, 0.5f, 1e-6);
}

MW_TEST("every LFO, envelope and voice parameter reaches its field") {
  ParamSet base(specs(), kSubstrateParamCount);
  settle(base);
  const LfoConfig lfoRest = lfoConfigFrom(base, kLfoFirst, LfoConfig{});
  for (std::size_t p = 0; p < kLfoParamCount; ++p) {
    ParamSet set(specs(), kSubstrateParamCount);
    settle(set);
    moveAway(set, kLfoFirst + p);
    MW_EXPECT_EQ(lfoDiff(lfoConfigFrom(set, kLfoFirst, LfoConfig{}), lfoRest), 1 << p);
  }
  EnvelopeShape shape;
  shape.floorValue = 0.0f;
  const EnvelopeShape envRest = adsrShapeFrom(base, kEnvelopeFirst, shape);
  for (std::size_t p = 0; p < kEnvelopeParamCount; ++p) {
    ParamSet set(specs(), kSubstrateParamCount);
    settle(set);
    moveAway(set, kEnvelopeFirst + p);
    MW_EXPECT_EQ(envelopeDiff(adsrShapeFrom(set, kEnvelopeFirst, shape), envRest), 1 << p);
  }
  // The stages land where an ADSR has them, and the release ends on the floor.
  MW_EXPECT_NEAR(envRest.segments[0].target, 1.0f, 0.0f);
  MW_EXPECT_NEAR(envRest.segments[1].target, envRest.segments[2].target, 0.0f);
  MW_EXPECT_NEAR(envRest.segments[3].target, shape.floorValue, 0.0f);
  MW_EXPECT_NEAR(envRest.segments[0].parameter, 0.01f, 1e-4);

  const VoiceSetConfig voiceRest = voiceSetConfigFrom(base, kVoiceFirst, VoiceSetConfig{});
  for (std::size_t p = 0; p < kVoiceParamCount; ++p) {
    ParamSet set(specs(), kSubstrateParamCount);
    settle(set);
    moveAway(set, kVoiceFirst + p);
    MW_EXPECT_EQ(voiceDiff(voiceSetConfigFrom(set, kVoiceFirst, VoiceSetConfig{}), voiceRest), 1 << p);
  }
  MW_EXPECT_EQ(voiceRest.capacity, 16);
  MW_EXPECT_EQ(voiceRest.unison, 1);
}

MW_TEST("vintage reaches the drift configuration and leaves the unit's deviation set alone") {
  DriftConfig mine;
  mine.pitchWalkCents = 9.0f;
  ParamSet set(specs(), kSubstrateParamCount);
  settle(set);
  MW_EXPECT_NEAR(driftConfigFrom(set, kDriftFirst, mine).vintage, 0.0f, 0.0f);
  moveAway(set, kDriftFirst + kVintage);
  const DriftConfig bound = driftConfigFrom(set, kDriftFirst, mine);
  MW_EXPECT_NEAR(bound.vintage, 1.0f, 1e-6);
  MW_EXPECT_NEAR(bound.pitchWalkCents, 9.0f, 0.0f);
}

MW_TEST("a tune press is an edge: once per flip, never per block") {
  ParamSet set(specs(), kSubstrateParamCount);
  settle(set);
  int last = 0;
  MW_EXPECT(!tuneRequested(set, kDriftFirst, last));
  set.post(specs()[kDriftFirst + kTune].id, 1.0f);
  set.beginBlock();
  MW_EXPECT(tuneRequested(set, kDriftFirst, last));
  for (int i = 0; i < 10; ++i) {
    set.beginBlock();
    MW_EXPECT(!tuneRequested(set, kDriftFirst, last));
  }
  set.post(specs()[kDriftFirst + kTune].id, 0.0f);
  set.beginBlock();
  MW_EXPECT(tuneRequested(set, kDriftFirst, last));
}

// ─────────────────────────────────────────────────── real-time safety

MW_TEST("binding every block allocates nothing once the set is built") {
  ParamSet set(specs(), kSubstrateParamCount);
  settle(set);
  GlideConfig glide;
  DriftConfig drift;
  LfoConfig lfo;
  EnvelopeShape shape;
  VoiceSetConfig voices;
  int last = 0;
  mw::test::RtGuard guard;
  for (int block = 0; block < 200; ++block) {
    if ((block % 7) == 0) set.post(specs()[kGlideFirst + kGlideTime].id, 0.3f);
    set.beginBlock();
    glide = glideConfigFrom(set, kGlideFirst, glide);
    drift = driftConfigFrom(set, kDriftFirst, drift);
    lfo = lfoConfigFrom(set, kLfoFirst, lfo);
    shape = adsrShapeFrom(set, kEnvelopeFirst, shape);
    voices = voiceSetConfigFrom(set, kVoiceFirst, voices);
    tuneRequested(set, kDriftFirst, last);
  }
  MW_EXPECT_EQ(static_cast<int>(guard.allocations()), 0);
  MW_EXPECT(glide.timeSeconds > 0.0f);
}

MW_TEST("the RtGuard is watching rather than asleep") {
  mw::test::RtGuard guard;
  ParamSet set(specs(), kSubstrateParamCount);  // building the set is the one allocation
  MW_EXPECT(guard.allocations() > 0);
  MW_EXPECT_EQ(static_cast<int>(set.size()), 22);
}

MW_TEST_MAIN("specs")
