# Design — the voice substrate

**Status:** design only. No implementation exists and none may be written against
this document until the audio substrate it compiles against
(`motionwave/core/render/`, `motionwave/core/dsp/`) lands. Every signature below
is a declaration.

**Home:** `motionwave/core/dsp/voice/`
**Namespace:** `mw::dsp::voice`
**Consumers:** DCO Poly, Phase Distortion, Analog Five, Six-Op FM, Matrix Twelve
(Phase 9) and the Slipstream Sampler (Phase 8).
**Sources:** `docs/reference/syn-01` … `syn-05`, `docs/reference/std-01-mpe-midi2.md`,
`PROGRESS.md` §"Directive 03 §1" and §3 (PA-003), ADR-0004, ADR-0006.
No reference product name appears here; the sheets hold those.

---

## 1. Purpose

Six instruments need the same six things — a way to hand a note a voice, a way to
take one back, envelopes, modulators, per-instance variation, and an expressive
input path — and they need them in six mutually incompatible shapes. The DCO
polysynth has one envelope and one instrument-wide LFO; the matrix synth has five
envelopes, five LFOs, four ramps, three tracking generators and a lag processor
_per voice_. One integrates its envelope in decibels; another integrates in
pitch. One must not drift at all; another's entire identity is that it drifts.

This library exists because the alternative has already been measured. MotionLab
Studio shipped **three** defects in exactly this area — two stuck-note bugs and a
voice-cap bug — and `PROGRESS.md` records their root causes. All three are
structural: a note-off computed from the wrong state, a note-off dispatched from
a surface that could not receive it, and a steal loop that did not remove what it
took. Six instruments each writing their own allocator is six chances to write
each of those again.

So the substrate's design goal is stated as a negative and everything else
follows from it: **the three defects that shipped must be unconstructible against
this interface, not merely tested for.** §4 states the invariants and names which
defect each one closes.

---

## 2. The three defects, and the invariants that close them

### 2.1 BUG-004 / BUG-005 — stuck keys and stuck notes were one bug

The diagnostic settled it before any fix: note-off fired on a press and release
over the same key and on nothing else. Lifting a finger away, a cancelled
pointer, a window blur, a hidden tab, an unmount while held — every one of those
left the note sounding. The key dispatched note-off from its own pointer-up
event, and the key is exactly the element that never receives it, because pointer
capture is released on pointer-down on purpose so a finger can glide across the
keyboard.

A second, independent instance was in the computer keyboard: **note-on took the
pitch from the octave at press time and note-off recomputed it at release time**,
so pressing a key, shifting the octave, and letting go sent note-off for a pitch
nobody was playing. Its blur handler also called an all-notes-off that silenced
notes it had never started.

Two invariants close both, and they are the two that matter most in this whole
document:

> **I-A. A release names what the press started.** A note-off carries the
> identity the note-on minted. It never carries a description from which an
> identity could be recomputed.
>
> **I-B. There is exactly one place a press becomes an identity.** Every surface
> that can play a note — a piano roll, an on-screen keyboard, a MIDI port, an
> arpeggiator, a recorded clip — goes through one registry. There is one place
> that can fail to end a note, so there is one place to fix.

I-A is enforced by the type system rather than by discipline: `release` takes a
`NoteId` and there is no overload taking a key. The mapping from `(channel, key)`
to `NoteId` exists in `NoteRegistry` and nowhere else, it is written on press and
read on release, and it is never recomputed from current state.

### 2.2 PA-003 — sixty notes, sixty oscillators, one voice cut

Sixty simultaneous note-ons against a ceiling of twenty-four produced **sixty
oscillators and one steal**. The sampler did the same: eighty live against a cap
of forty-eight. The recorded fix is one sentence — _"stealing loops and removes
each voice as it takes it"_ — and the result is 24 live with 36 steals.

The failure shape is a victim chosen against a set that the choosing did not
update. Whether the original computed a victim list up front or forgot to
un-register the voice it took, both are the same mistake, and both are prevented
by the same rule:

> **I-C. A stolen voice leaves the allocated set at the moment it is stolen**,
> before the caller can see it. There is no public call that returns a victim
> list, because a list computed against a set that then changes is precisely
> this bug.

The executable consequence, which is what VS-01 asserts:

```
    after N simultaneous note-ons at capacity C:
        liveCount()  ==  min(N, C)         exactly
        stealCount() ==  max(0, N − C)     exactly
```

### 2.3 The measure that made the fuzz test possible

`PROGRESS.md` records a subtler point from the same work, and it is a design
requirement here rather than a testing convenience. `activeVoices` is the wrong
measure of a stuck note, because a correctly released voice stays in the
allocation set until its tail retires. So is "panic wrote something". The thing
itself is **`sustainingVoices` — voices with no scheduled end.**

The substrate therefore exposes both counts, separately, and defines them:

- `liveCount()` — voices in the allocated set, including those in release whose
  tails have not retired. This is what the voice cap bounds.
- `sustainingCount()` — voices whose gate is high, i.e. nothing has scheduled
  their end. **This is the stuck-note measure**, and a fuzz run ends by asserting
  it is zero.

A non-vacuity check is part of the design, not an afterthought: the sampler in
MotionLab answered 0 for twelve held notes because a non-looping sample schedules
its own end at spawn. Any unit whose voices can schedule their own end must
report that voice as **not** sustaining, and the fuzz test must use a
configuration in which sustaining is reachable, or it tests nothing.

---

## 3. Files

| File                      | Contents                                        | Budget |
| ------------------------- | ----------------------------------------------- | ------ |
| `voice/note_id.h`         | `NoteId`, `VoiceId`, the sentinels              | 60     |
| `voice/note_registry.h`   | `NoteRegistry` — the one press→identity map     | 190    |
| `voice/voice_set.h`       | `VoiceSet`, the partition, allocation, stealing | 300    |
| `voice/trigger_bus.h`     | single/multi pulses and the gate                | 110    |
| `voice/envelope.h`        | `Envelope`, `EnvelopeShape`, segment maths      | 320    |
| `voice/envelope_shapes.h` | the five measured shape families                | 220    |
| `voice/lfo.h`             | `Lfo`, waveforms, delay+fade, retrigger         | 260    |
| `voice/mod_grid.h`        | the control-rate grid and `ModFrame`            | 190    |
| `voice/drift.h`           | `DriftModel`, the OU walk, tune events          | 210    |
| `voice/mpe.h`             | zones, channel state, dimension routing         | 300    |
| `voice/portamento.h`      | `Glide`, the four modes, the three laws         | 200    |
| `voice/specs.h`           | `ParamSpec` writers and block binding           | 240    |

---

## 4. Public interface

````cpp
namespace mw::dsp::voice {

using VoiceId = std::uint16_t;
using NoteId  = std::uint32_t;

inline constexpr VoiceId kNoVoice = 0xFFFFu;
inline constexpr NoteId  kNoNote  = 0u;      ///< 0 is never minted

// ============================================================== identity

/// The one place a press becomes an identity (invariant I-B).
///
/// Written on press, read on release, never recomputed. `release` takes the key
/// that was pressed and returns the NoteId that press minted — or `kNoNote` if
/// there was no such press, which is a fact the caller needs rather than an
/// error to swallow. That return value is what makes a doubled note-off, a
/// note-off for a key nobody pressed, and a cancelled pointer all harmless.
class NoteRegistry {
 public:
  void prepare(int maxHeld) noexcept;   ///< allocates once; 128 keys × 16 channels
  void reset() noexcept;

  /// Mints a NoteId. Monotonic and never reused within a session, so a stale
  /// reference cannot alias a live note.
  NoteId press(std::uint8_t channel, std::uint8_t key) noexcept;

  /// The NoteId `press` minted for this (channel, key), removed from the map.
  NoteId release(std::uint8_t channel, std::uint8_t key) noexcept;

  /// Everything currently held, for legato detection and for an arpeggiator.
  /// One held-key set in the product, so a portamento that asks "was another key
  /// down?" cannot get a different answer from the arpeggiator.
  int heldCount() const noexcept;
  NoteId heldAt(int index) const noexcept;
  std::uint8_t heldKeyAt(int index) const noexcept;

  /// Ends every held note and returns how many there were. Called on panic, on
  /// a transport stop, and when a zone leaves MPE control.
  int releaseAll() noexcept;
};

// ============================================================ allocation

enum class Allocation : std::uint8_t {
  RoundRobin,   ///< hand voices out in rotation; audible below the cap and meant to be
  FixedOrder,   ///< lowest free index first, while earlier keys are held
  Oldest,
  Quietest,
};

enum class StealOrder : std::uint8_t {
  ReleasingQuietestFirst,  ///< default: a voice already in release, lowest level first
  OldestFirst,
  SameKeyFirst,            ///< a repeated note takes its own previous voice
};

struct VoiceSetConfig {
  int capacity = 16;
  Allocation allocation = Allocation::RoundRobin;
  StealOrder stealOrder = StealOrder::ReleasingQuietestFirst;
  int unison = 1;              ///< voices stacked per note
  /// Declick applied to a stolen voice, milliseconds. Zero is the hardware
  /// behaviour for the vintage units and it is the default; the sampler sets
  /// 1.5, because a sample cut mid-waveform is a pop nobody asked for.
  float stealFadeMs = 0.0f;
};

class VoiceSet {
 public:
  void prepare(const VoiceSetConfig& config) noexcept;  ///< allocates once
  void reset() noexcept;

  /// The only way a voice is obtained. Steals internally when the set is full.
  ///
  /// There is deliberately no public `stealOne`, no `selectVictims`, and no
  /// `victims(int n, VoiceId* out)`. Invariant I-C is that a victim leaves the
  /// allocated set before anyone can see it, and an API that handed out a list
  /// would let a caller reconstruct PA-003 in three lines.
  VoiceId allocate(NoteId note) noexcept;

  /// Gate falls. The voice stays in the allocated set until its tail retires,
  /// which is why `liveCount` and `sustainingCount` are different numbers.
  /// Returns false when the note is not ours — a stolen note's late note-off,
  /// which must be a no-op and not a release of whoever holds the voice now.
  bool releaseNote(NoteId note) noexcept;

  /// Called by the voice itself when its envelope reaches its floor.
  void retire(VoiceId voice) noexcept;

  /// Every gate down, at once, with the declick envelope. Real-time safe: it is
  /// called from the audio thread when a panic message arrives.
  void panic() noexcept;

  int liveCount() const noexcept;
  int sustainingCount() const noexcept;   ///< the stuck-note measure, §2.3
  std::uint64_t stealCount() const noexcept;
  int capacity() const noexcept;

  /// Takes effect on the next allocation and never cuts a sounding voice.
  /// ADR-0006's rule for grains applies here in its own form: a tier that
  /// silenced a held note would turn a performance decision into an audible one.
  void setCapacity(int capacity) noexcept;

  NoteId noteOf(VoiceId voice) const noexcept;
  VoiceId voiceOf(NoteId note) const noexcept;
};

// =============================================================== triggers

/// Two one-sample pulses and a level, per voice.
///
/// Every envelope, ramp and LFO subscribes to whichever it wants. This is the
/// matrix synth's own structure and it is far simpler than special-casing each
/// generator: a *single* trigger is a note-on to a voice that is not gated, a
/// *multi* trigger is any note-on including one to a gated voice, plus a
/// note-off received while the voice is not gated.
struct TriggerBus {
  bool single = false;
  bool multi = false;
  bool gate = false;
  bool externalTrigger = false;
};

// ============================================================== envelopes

/// What a segment's parameter means.
enum class SegmentDrive : std::uint8_t {
  /// Duration is authoritative; the target is reached by construction. This is
  /// what makes decay duration a function of the decay control *only*, which is
  /// a measured behaviour of the DCO polysynth that contradicts textbook
  /// analogue envelopes and which a "physically reasonable" model gets wrong by
  /// being reasonable.
  Duration,
  /// Speed is authoritative; time falls out of the distance travelled. A rate
  /// of 60 across a zero-distance segment costs almost nothing, and the same
  /// rate across a 90 dB excursion takes far longer. Inverting this is named in
  /// `syn-02` §4.1 as the most common implementation error in this class.
  Rate,
};

/// The domain the envelope integrates in.
enum class EnvelopeDomain : std::uint8_t {
  Linear,   ///< amplitude, or pitch, depending on what it drives
  Decibel,  ///< the six-operator engine integrates in dB and must
};

enum class SegmentCurve : std::uint8_t {
  Linear,
  /// Exponential over `shape` time constants, with the offset that forces the
  /// segment to actually reach its target rather than approach it forever.
  Exponential,
  /// Step size shrinks as the level rises: fast in the domain at the bottom,
  /// decelerating at the top.
  TargetSeeking,
};

struct Segment {
  float target = 0.0f;
  float parameter = 0.0f;    ///< seconds if Duration, units/second if Rate
  SegmentCurve curve = SegmentCurve::Linear;
  float shape = 1.0f;        ///< time constants for Exponential, k for TargetSeeking
};

inline constexpr int kMaxSegments = 8;

struct EnvelopeShape {
  Segment segments[kMaxSegments]{};
  int count = 4;
  /// Which segment holds until release. Any segment may be the sustain point;
  /// ADSR is the case where this is 2. A dedicated sustain *stage* would not
  /// serve the eight-stage instrument at all.
  int sustainSegment = 2;
  /// Which segment ends the envelope. On release the envelope runs from wherever
  /// it is through the remaining segments up to this one and stops.
  int endSegment = 3;
  EnvelopeDomain domain = EnvelopeDomain::Linear;
  SegmentDrive drive = SegmentDrive::Duration;
  /// Floor in the envelope's own domain. The six-operator engine starts its
  /// attack about 89.9 dB down rather than at −inf, which is why its onset is
  /// percussive; it also removes the denormal that an exact zero would produce.
  float floorValue = 0.0f;
  /// Minimum time a zero-distance segment takes. Measured to be non-zero on the
  /// six-operator hardware and audible as a slight smear on fast multi-segment
  /// percussive envelopes. Zero for every other consumer.
  float zeroDistanceSeconds = 0.0f;
  /// Independent bits, not a mode enum. The matrix instrument's combinatorial
  /// freedom is the point: an LFO-triggered, free-running, no-sustain envelope
  /// is a looping shape generator and is how that instrument makes evolving
  /// pads without a sequencer.
  bool resetOnTrigger = false;
  bool multiTrigger = false;
  bool gated = false;
  bool freeRun = false;
  bool skipSustain = false;
};

class Envelope {
 public:
  void prepare(double sampleRate) noexcept;
  void setShape(const EnvelopeShape& shape) noexcept;
  void reset() noexcept;

  /// Advance `frames` samples of song time and return the value at the end.
  /// Advanced by **sample count**, never by block count: a generator advanced
  /// once per call produces a different envelope at every buffer size, and the
  /// offline renderer's own documentation names that as the failure its
  /// block-size cell exists to catch.
  float advance(const TriggerBus& triggers, int frames) noexcept;

  float value() const noexcept;
  bool sustaining() const noexcept;   ///< holding at the sustain segment
  bool finished() const noexcept;     ///< reached the end segment's target
  int segment() const noexcept;

  /// The shape, sampled for a face to draw, by running the same `advance` on a
  /// scratch copy. A curve drawn from a formula would be a second opinion.
  static void sampleShape(const EnvelopeShape& shape, double sampleRate, float gateSeconds,
                          float* out, int count) noexcept;
};

// =================================================================== LFOs

enum class LfoWave : std::uint8_t {
  Triangle, SawUp, SawDown, Square, Sine, SampleHold, Noise,
  /// Samples another modulation source at the LFO rate. A general-purpose
  /// sample-and-hold whose input is any source in the frame: sampling a triangle
  /// gives stepped vibrato, sampling pressure gives a held expression value,
  /// sampling a ramp gives a staircase. It belongs in the LFO rather than in a
  /// separate module because that is where its clock is.
  SampleInput,
};

enum class LfoScope : std::uint8_t {
  /// One LFO for the whole instrument; two voices sounding together are
  /// modulated **in phase**. This is a defining characteristic of one consumer
  /// and per-voice LFOs would change the instrument.
  Instrument,
  Voice,
};

enum class LfoRetrigger : std::uint8_t { Off, Single, Multi, External };

struct LfoConfig {
  LfoWave wave = LfoWave::Triangle;
  LfoScope scope = LfoScope::Voice;
  LfoRetrigger retrigger = LfoRetrigger::Off;
  float rateHz = 5.0f;
  /// Phase the LFO resets to when retriggered, 0..1. Repeatable phase per note
  /// is what percussive uses need and what a deterministic offline render needs.
  float retriggerPhase = 0.0f;
  /// Two-stage: complete silence for `delaySeconds`, then a ramp to full depth
  /// over `fadeSeconds`. A single-stage "fade in over N seconds" model is wrong
  /// and audibly so on slow vibrato patches; both stages were measured
  /// separately on one consumer's hardware.
  float delaySeconds = 0.0f;
  float fadeSeconds = 0.0f;
  float amplitude = 1.0f;
  bool throughLag = false;
  std::uint8_t sampleInput = 0;   ///< source index when wave == SampleInput
};

class Lfo {
 public:
  void prepare(double sampleRate, std::uint64_t seed) noexcept;
  void setConfig(const LfoConfig& config) noexcept;
  void reset() noexcept;
  float advance(const TriggerBus& triggers, const float* sources, int frames) noexcept;
  float value() const noexcept;
  float phase() const noexcept;
};

/// How two modulation contributions to one destination combine.
enum class ModCombine : std::uint8_t {
  Sum,
  /// Whichever is greater wins, sign from the first. Unusual, and the
  /// six-operator engine does exactly this for pitch and amplitude modulation:
  /// summing gives noticeably deeper vibrato when the LFO and the wheel are both
  /// active, which is a different instrument.
  Maximum,
};

}  // namespace mw::dsp::voice

```cpp
namespace mw::dsp::voice {

// ================================================================== drift

struct DriftConfig {
  /// One scalar scaling every deviation at once, 0..1.
  ///
  /// On the hardware the deviations are correlated — a loose unit is loose in
  /// every respect at once — so one control is both easier to use and more
  /// faithful than six. **The default is 0.** One consumer's identity is that
  /// it never goes out of tune, and a shared substrate whose drift defaulted on
  /// would silently wrong that instrument.
  float vintage = 0.0f;
  /// Correlation time of the pitch random walk, seconds.
  float walkSeconds = 30.0f;
  /// Stationary standard deviations at vintage == 1.
  float pitchWalkCents = 3.0f;
  float pitchOffsetCents = 1.5f;
  float pitchOffsetCentsBelowC3 = 5.0f;
  float cutoffPercent = 4.0f;
  float envelopeTimePercent = 5.0f;
  float vcaGainDb = 0.4f;
  float pulseWidthPercent = 2.0f;
  /// Residual after a tune, from the finite control word. Its size is unknown;
  /// its existence is documented, so it is a parameter with a placeholder rather
  /// than an omission.
  float tuneResidualCents = 0.3f;
  std::uint64_t seed = 0x2545F4914F6CDD1Dull;
};

class DriftModel {
 public:
  void prepare(double sampleRate, int voices, const DriftConfig& config,
               void* storage, std::size_t bytes) noexcept;
  void setConfig(const DriftConfig& config) noexcept;
  void reset() noexcept;

  /// Resets the accumulated walk to the post-tune residual. Drift then resumes
  /// and grows again — the routine is a reset, not a servo, and nothing holds
  /// the oscillators in tune between presses. A control that visibly fixes an
  /// audible problem is worth reproducing as a feature rather than hiding.
  void tune() noexcept;

  /// Advance by **song time**, not wall time. A bounce and a live pass must
  /// agree, and MotionLab's offline-bounce parity is the thing CLAUDE.md
  /// protects most explicitly. `songSeconds` comes from `ProcessContext`.
  void advance(double songSeconds, int frames) noexcept;

  float pitchCents(int voice, int oscillator, float midiNote) const noexcept;
  float cutoffFactor(int voice) const noexcept;
  float envelopeTimeFactor(int voice) const noexcept;
  float vcaGainDb(int voice) const noexcept;
  float pulseWidthFactor(int voice, int oscillator) const noexcept;
};

// ==================================================================== MPE

enum class ZoneSide : std::uint8_t { Lower, Upper };

/// Per-member-channel controller state, alive whether or not a note sounds.
///
/// This is the part that separates a real receiver from a demo. A member
/// channel's {bend, pressure, timbre} must be tracked even with nothing
/// sounding, because the values in effect at the next note-on are the ones that
/// note starts with. Fourteen or fifteen of these are alive at all times.
struct ChannelState {
  float bendNormalised = 0.0f;   ///< −1 … +1
  float pressure = 0.0f;
  float timbre = 0.5f;
  float bendSemitones = 48.0f;   ///< sensitivity; the MCM resets member channels to this
  bool timbreIsAbsolute = true;  ///< per input device; 64 does not mean "no change"
};

struct Zone {
  bool active = false;
  ZoneSide side = ZoneSide::Lower;
  std::uint8_t masterChannel = 0;
  std::uint8_t memberCount = 0;
  float masterBendSemitones = 2.0f;
};

class MpeRouter {
 public:
  void prepare() noexcept;
  void reset() noexcept;

  /// Configuration message. Recomputes **both** zones, because zones are
  /// allocated outward from their masters and an overlap truncates the other
  /// one. A receiver that recomputed only the addressed zone leaves the other
  /// claiming channels it no longer owns.
  ///
  /// Side effects are mandatory and are the most commonly mis-implemented
  /// numbers in the specification: master sensitivity ±2 semitones, member
  /// sensitivity ±48, all notes stopped and controllers reset on every channel
  /// entering or leaving MPE control.
  void configure(ZoneSide side, std::uint8_t memberCount) noexcept;

  bool isMember(std::uint8_t channel) const noexcept;
  bool isMaster(std::uint8_t channel) const noexcept;
  const Zone& zoneFor(std::uint8_t channel) const noexcept;

  void setBend(std::uint8_t channel, float normalised) noexcept;
  void setPressure(std::uint8_t channel, float value) noexcept;
  void setTimbre(std::uint8_t channel, float value) noexcept;
  void setBendSensitivity(std::uint8_t channel, float semitones) noexcept;

  /// The snapshot a note-on takes. Copied into the voice; the voice does not
  /// hold a pointer into channel state, because the channel is reused as soon
  /// as the note is released and a pointer would follow it.
  ChannelState snapshot(std::uint8_t channel) const noexcept;

  /// Unbinds a channel from a voice at note-off. **After this the voice is
  /// unreachable by channel**, not merely ignoring the channel: dispatch is by
  /// channel, so a released voice cannot be reached at all. That is what stops
  /// the classic receiver bug where member bend detunes a release tail after the
  /// channel has been handed to a new note.
  void unbind(std::uint8_t channel, VoiceId voice) noexcept;
  void bind(std::uint8_t channel, VoiceId voice) noexcept;

  /// Total bend in semitones for a bound voice: master bend scaled by master
  /// sensitivity, plus member bend scaled by member sensitivity. Addition is
  /// the universal reading of the specification's "combine meaningfully" and it
  /// is recorded here as our interpretation rather than as a quoted rule.
  float bendSemitones(VoiceId voice) const noexcept;
  /// Master and member summed in the normalised domain and clamped. Also our
  /// interpretation; the specification leaves it open.
  float pressure(VoiceId voice) const noexcept;
  float timbre(VoiceId voice) const noexcept;
};

// ============================================================ portamento

enum class GlideMode : std::uint8_t {
  Off,
  /// One glide state for the instrument. A monophonic line.
  Mono,
  /// Each voice glides from the note **that voice** last played. This is what
  /// "multi-portamento" means and it is the sampler's requirement: with five
  /// voices and five different previous notes there are five different starting
  /// pitches, and a single shared last-note state gives one.
  PolyPerVoice,
  /// Each new note glides from the nearest currently or most recently sounding
  /// pitch, which is what a chord change wants.
  PolyNearest,
};

enum class GlideLaw : std::uint8_t {
  ConstantRate,   ///< time proportional to interval
  ConstantTime,   ///< every transition takes the same time regardless of distance
  Exponential,    ///< slew toward the target
};

struct GlideConfig {
  GlideMode mode = GlideMode::Off;
  GlideLaw law = GlideLaw::ConstantRate;
  float rateSemitonesPerSecond = 24.0f;
  float timeSeconds = 0.100f;
  /// Glide only when notes overlap — fingered portamento. Overlap is asked of
  /// `NoteRegistry`, which already owns the held set, so a glide and an
  /// arpeggiator cannot disagree about whether a key was down.
  bool legatoOnly = false;
};

class Glide {
 public:
  void prepare(double sampleRate, int voices, void* storage, std::size_t bytes) noexcept;
  void setConfig(const GlideConfig& config) noexcept;
  void reset() noexcept;

  void start(VoiceId voice, float fromNote, float toNote, bool anotherKeyHeld) noexcept;
  float advance(VoiceId voice, int frames) noexcept;
  float note(VoiceId voice) const noexcept;

  /// False once the glide has arrived. An exponential law never arrives, so the
  /// glide **snaps** within 0.5 cents and clears this flag; without the snap a
  /// voice glides forever, the drift model's random walk rides on a target that
  /// is still moving, and every downstream consumer takes its slow path for the
  /// life of the note.
  bool gliding(VoiceId voice) const noexcept;
};

// ============================================================== mod grid

/// The control-rate grid.
///
/// Modulation is evaluated on a grid of absolute frame indices, **not once per
/// block**. A 16-frame block and a 1024-frame block therefore hit the same grid
/// points and produce the same samples, which is what the offline renderer's
/// block-size cell asserts. Between grid points, pitch and amplitude
/// destinations interpolate linearly — the same treatment `ParamBlock` gives a
/// parameter, for the same reason.
struct ModGrid {
  int stride = 32;              ///< samples; 1500 Hz at 48 kHz
  std::uint64_t frameIndex = 0; ///< absolute, from song position
};

inline constexpr int kMaxModSources = 32;

struct ModFrame {
  float sources[kMaxModSources]{};
};

}  // namespace mw::dsp::voice
````

---

## 5. DSP formulation

### 5.1 The allocation state machine

`VoiceSet` holds one array of `capacity` entries and one index permutation. A
voice's membership is **its position in the permutation**, not a flag:

```
    slots[0 .. live)             allocated, ordered oldest-first
    slots[live .. capacity)      free
```

Two flags can disagree with each other and with a count; a position cannot. Every
operation is a swap and an increment or decrement:

```
    allocate(note):
        if live == capacity:
            v = stealOne()                 # removes its victim, invariant I-C
        else:
            v = slots[live]; ++live
        owner[v] = note; gate[v] = true; ++sustaining
        noteToVoice[note] = v
        return v

    stealOne():
        i = selectVictim()                 # an index into [0, live)
        v = slots[i]
        invalidate(owner[v])               # a late note-off for it is a no-op
        if gate[v]: --sustaining
        slots[i] = slots[live-1]; slots[live-1] = v; --live
        return v                           # now provably outside the allocated set
```

The order matters and is the fix: **the victim leaves the set before the caller
receives it.** A `selectVictim` that ran over a set it had not updated is
PA-003; a `stealOne` that returned before the swap is PA-003 with an extra step.

`invalidate(owner[v])` closes the companion defect. When voice `v` is taken from
note A and given to note B, note A's later note-off must be a no-op. Without
invalidation, `releaseNote(A)` finds `noteToVoice[A] == v` and releases B — a
note the user is still holding stops sounding when they lift an _earlier_ key.
VS-05 tests it.

**Victim selection**, in order, and every tie broken by lowest voice index so the
result is deterministic and a golden render is stable:

1. A voice in release, lowest current envelope level first.
2. A voice whose note is the same key as the incoming note, if `SameKeyFirst`.
3. The oldest voice **not started in this block**.
4. The oldest voice, including ones started in this block.

Rule 3 exists so a chord of more notes than the cap does not eat its own notes as
it arrives, and rule 4 exists so rule 3 cannot deadlock when a single block
contains more note-ons than the cap — which is exactly the sixty-notes-at-one-
instant case. Rule 4 is why `liveCount()` after that case is `min(N, C)` rather
than something smaller.

**Unison.** `unison = k` allocates `k` voices per note and gives them one
`NoteId`. On the vintage instruments there is no detune control at all: the
spread is entirely the voices' own tuning error, which means unison sounds
different before and after a tune — thinner right after, wider as the instrument
drifts. That is only true if the drift model has real per-voice variation, so
`unison > 1` with `vintage == 0` is a level boost and nothing else, and the UI
should say so rather than let a user conclude unison is broken.

**Capacity changes never cut a sounding voice.** `setCapacity` records the new
number; the set shrinks by attrition as notes release. ADR-0006's rule for grain
rates applies here in its own form — a tier that silenced a held note would turn
a performance decision into an audible one and make it the user's problem to
explain.

### 5.2 Envelope segments

The engine advances a normalised position `x ∈ [0,1]` through the current
segment and maps it to a level. Which of `x` or the level is authoritative is the
`SegmentDrive` choice, and it is the choice most implementations get wrong in one
direction or the other.

**`Duration` drive.** The segment takes `parameter` seconds regardless of how far
it has to travel, so

```
    x[n] = x[n−1] + 1/(parameter · fs)                                       (1)
```

and the level is `start + (target − start)·f(x)` for the segment's curve `f`.
This is what makes decay duration a function of the decay control only, which is
measured behaviour on one consumer: raising the sustain level leaves the decay
duration essentially unchanged (19.78 s at sustain 0, 17.11 s at sustain 5),
where a textbook capacitor model would shorten it substantially.

**`Rate` drive.** Speed is authoritative and time falls out of the distance:

```
    level[n] = level[n−1] ± rate/fs      until the target is passed            (2)
```

so a rate of 60 across a zero-distance segment costs `zeroDistanceSeconds` and
the same rate across a 90 dB excursion takes far longer. Inverting (1) and (2)
is the error `syn-02` §4.1 names.

**Curves.**

```
    Linear:          f(x) = x
    Exponential:     f(x) = (1 − e^(−k·x) − e^(−k)·(1 − x)) / (1 − e^(−k))    (3)
    TargetSeeking:   L[n] = L[n−1] + (ceiling − L[n−1])·g                     (4)
```

(3) carries a subtraction that forces the segment to actually reach its target at
`x = 1` rather than approach it asymptotically. Without it a decay never arrives,
the envelope never advances to the next segment, and the voice never retires —
which is a stuck note produced by arithmetic rather than by input handling, and
it would pass every test in §2 while still hanging a note.

The five measured shape families the consumers need, expressed in these terms:

| Consumer         | Domain      | Drive    | Attack                                                                              | Decay/release                                                                                                          |
| ---------------- | ----------- | -------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| DCO polysynth    | Linear      | Duration | TargetSeeking, ending at exactly **one** time constant: `L(x) = (1 − e^(−x))/0.632` | Exponential over **3.5** time constants, with (3)'s offset. Decay and release measured identical, so one shared curve. |
| Phase distortion | Linear      | **Rate** | linear in the segment's own domain                                                  | linear; the domain is level for amplitude and pitch for the oscillator, and "linear" means different things in each    |
| Analogue five    | Linear      | Duration | linear on early revisions, exponential on later                                     | as attack; a global switch disables release entirely                                                                   |
| Six-operator     | **Decibel** | **Rate** | TargetSeeking with a floor 89.9 dB down                                             | linear in dB, which is a true exponential in amplitude                                                                 |
| Matrix           | Linear      | Duration | with a pre-attack delay segment                                                     | five segments plus a separate output scaling                                                                           |

Two numbers are worth stating because they are the difference between a faithful
onset and a soft one:

- The DCO polysynth's attack **ends at one time constant**, not at three to five.
  `0.632 = 1 − e^(−1)` exactly. A generic model that runs the attack to 95 %
  makes short attacks sound soft.
- The six-operator attack **floors at about 89.9 dB down** rather than at −inf,
  so an attack from silence is not infinitely long. Omitting the floor gives soft
  late attacks; using a linear-in-dB attack instead of (4) gives a clicky but
  flat onset. Both are the classic tells of a naive port.

**The dB domain is not optional for that consumer.** Its level counter's unit is
1/256 octave of amplitude — `6.0206/256 = 0.02352 dB` — and a decay that is
linear in dB is a true exponential in amplitude, a straight line on a dB plot. An
implementation that interpolates linearly in amplitude between levels sounds
"synthetic and slow to die", and VS-10 measures the straightness directly.

**Sample-rate independence.** Segment increments scale by `44100/fs` for the
rate-driven consumer and by `1/fs` for the duration-driven ones, so a patch takes
the same wall-clock time at any host rate. VS-08 measures it at four rates.

### 5.3 LFOs, and the two-stage delay

Phase is a `double` accumulator advanced by sample count, so a 16-frame and a
1024-frame block produce identical phase. Waveforms are generated without
band-limiting: the square steps instantly, the sawtooth wraps instantly. That is
deliberate — on the hardware these are integer operations on a phase accumulator
and the instant step is part of the sound — but it means an LFO at 20 Hz
modulating pitch produces audible content, which is correct and must not be
"fixed".

The delay is **two stages, both measured**: complete silence for `delaySeconds`,
then a ramp to full depth over `fadeSeconds`. One consumer's measured pairs at
five slider positions are 0/0, 0.064/0.053, 0.85/0.188, 1.20/0.348, 2.79/1.15
seconds. A single-stage "fade in over N seconds" model has no silent period at
all, and on a slow vibrato patch the difference is the whole gesture.

`SampleHold` and `SampleInput` share one clock — the LFO's own phase wrap — and
their generator is the substrate's deterministic PRNG rather than anything
seeded from a clock. One consumer's hardware uses a short-period generator whose
"random" modulation repeats audibly; whether to reproduce that period is a
listening decision recorded in §8, and the default is a long period.

**Combining.** `ModCombine::Maximum` implements
`out = max(|a|, |b|)` with the sign taken from the first source. The
six-operator engine combines its LFO and wheel contributions this way for both
pitch and amplitude, and summing instead gives noticeably deeper vibrato when
both are active. It is one enum value and it is the difference between two
instruments.

### 5.4 Per-voice drift

Six deviations, one scalar. The pitch walk is an Ornstein–Uhlenbeck process,
discretised **exactly** rather than by an Euler step:

```
    d[n] = d[n−1]·e^(−Δt/τ) + σ·sqrt(1 − e^(−2Δt/τ))·ξ[n],   ξ ~ N(0,1)      (5)
```

with `τ = 30 s` and `σ = 3.0 cents · vintage`. (5) is the exact solution of the
OU equation over the interval, so its stationary variance is `σ²` **for any
`Δt`**. An Euler step's variance depends on `Δt`, which means the drift depth
would change with the control-grid stride and therefore with the quality tier —
a tier that changed how much an instrument drifts is a tier that changes the
sound, which ADR-0006 §3 forbids.

`Δt` comes from `songSeconds`, not from a wall clock. A bounce and a live pass of
the same bar must produce the same drift, or the offline-bounce parity CLAUDE.md
protects is broken for every instrument at once.

The tuning-error shape is **structured, not uniform**. The reference instrument's
calibration measures C3 through C9 and extrapolates below C3, so error is
systematically larger in the bottom three octaves:

```
    offsetCents(note) = base(voice, osc) · ( note ≥ C3 ? 1 : k(note) )
    k(note) = 1 + (C3 − note)/12 · (5.0/1.5 − 1)                              (6)
```

giving ±1.5 cents in the measured range and ±5 cents an octave below C3, growing
linearly further down. A model that applied uniform random detune would be
wrong in a way that is audible on bass parts specifically, which is where it
matters.

`tune()` resets the walk to `tuneResidualCents`, not to zero: the correction can
only ever be as fine as one step of a finite control word, so a residual floor
exists immediately after tuning. Its size is unknown and the parameter carries a
placeholder rather than the omission.

**Default `vintage = 0`.** One consumer's pitch is divider-derived and exact, and
its own sheet says adding vintage-analogue drift there is a category error. VS-17
asserts that two voices playing the same key at `vintage = 0` null to −140 dBFS.

### 5.5 MPE routing

The pitch summing order, stated once so no consumer invents its own:

```
    note = keyNumber
         + glide(voice)                       # portamento, §5.6
         + masterBend·masterSensitivity       # zone-wide
         + memberBend·memberSensitivity       # per note, up to ±48
         + driftCents(voice, osc, note)/100   # §5.4
         + patchTranspose + patchDetune
    note = clamp(note, −12.0f, 139.0f)                                        (7)
```

The clamp is at the end and it is deliberate: with member sensitivity at ±48 a
full bend on a top key exceeds any oscillator's useful range, and clamping once
here means no oscillator has to. The bounds are two octaves below the lowest MIDI
note and one above the highest, so a legitimate extreme gesture is never clipped
while a nonsensical one cannot reach a filter coefficient.

**The channel-reuse rules**, which are where receivers most often fail:

1. A member channel is assigned to a note from its note-on until its note-off.
2. **After the note-off, per-note control stops** — regardless of a damper pedal
   or a long release — so the channel can be reused immediately.
3. Therefore a bend arriving after a note-off must not affect that note's
   release. Enforced structurally: `unbind` removes the voice from the channel's
   dispatch list, so the message has nowhere to land. A receiver that merely
   ignored late bends would still detune release tails the moment somebody
   refactored the ignore.
4. A releasing voice may sound for a long time; the channel is free anyway.
5. Per-channel controller state is tracked **even with nothing sounding**,
   because those are the values the next note-on starts with.

**The damper does not create a second lifetime concept.** Rule 2 is absolute:
`releaseNote` always ends the note's identity, unbinds the channel, and stops
per-note control. The damper only defers the _gate's_ fall. So a sustained note
has `heldCount() == 0`, `boundChannels() == 0` and `sustainingCount() > 0`, and
lifting the damper drops the gates within one block. That split is what removes
the whole sustain-pedal stuck-note class, and VS-06 asserts all three counts.

Three smaller rules, each of which has produced a bug somewhere:

- A note-on with velocity 0 is a **note-off with release velocity 64**, not
  velocity 0.
- A zero-pressure message immediately before a note-on or note-off is normal and
  must not be read as an expressive gesture.
- Timbre is absolute on some controllers and centred at 64 on others, and the
  data cannot tell you which. It is a per-input-device setting defaulting to
  absolute, and 64 must not be assumed to mean "no change".

### 5.6 Portamento

Three laws:

```
    ConstantRate:  t = |Δ| / rate                                             (8)
    ConstantTime:  t = timeSeconds,     independent of |Δ|                    (9)
    Exponential:   p[n] = p[n−1] + (target − p[n−1])·(1 − e^(−Δt/τ))         (10)
```

(10) never arrives, so the glide **snaps** when `|target − p| < 0.005` semitones
(0.5 cents, below the just-noticeable difference at every pitch) and clears
`gliding`. Without the snap, three things go wrong at once and none of them looks
like a portamento bug: the voice never reports a settled pitch, the drift walk of
§5.4 rides on a moving target, and every downstream consumer takes its
interpolating path for the life of the note.

Four modes, and what each is for:

- `Mono` — one glide state. A monophonic lead.
- `PolyPerVoice` — **multi-portamento**. Each voice glides from the note that
  voice last played. Five voices with five different previous notes give five
  different starting pitches; a single shared last-note state gives one, and the
  chord arrives as a unison sweep instead of five independent lines. This is the
  sampler's stated requirement and it is the reason glide state is per voice
  rather than per instrument.
- `PolyNearest` — glides from the nearest currently or recently sounding pitch,
  which is what a chord change wants.
- `legatoOnly` — the glide starts only if another key was down at the moment of
  the press. The held set comes from `NoteRegistry`, which already owns it, so
  the glide and the arpeggiator cannot disagree about whether a key was down.

---

## 6. Real-time safety

### 6.1 What `prepare()` allocates

Every type takes caller-provided storage and reports its size first, so **an
instrument performs exactly one allocation for its entire voice substrate.** A
unit that allocates once can be counted; a unit that allocates eleven times can
only be reviewed.

Per instance, at 16 voices, 5 envelopes and 5 LFOs per voice (the heaviest
consumer), 8 taps of held-key state:

| Item                                              | Bytes       |
| ------------------------------------------------- | ----------- |
| `NoteRegistry` map, 16 channels × 128 keys × 4 B  | 8 192       |
| `NoteRegistry` held list, 128 × 8 B               | 1 024       |
| `VoiceSet` slots + owner + gate + age, 16 × 16 B  | 256         |
| Envelopes, 16 voices × 5 × 40 B                   | 3 200       |
| Envelope shapes, 5 × 152 B (shared across voices) | 760         |
| LFOs, 16 × 5 × 32 B                               | 2 560       |
| Drift state, 16 voices × 2 osc × 24 B             | 768         |
| Glide state, 16 × 16 B                            | 256         |
| `ChannelState`, 16 × 20 B                         | 320         |
| `ModFrame` double-buffer, 16 voices × 2 × 128 B   | 4 096       |
| **Per instance**                                  | **≈ 21 KB** |

Twenty-one kilobytes for the whole substrate, against a sampler's sample memory
or a six-operator engine's tables. The substrate is not the memory question and
never will be; the reason to keep it in one arena is countability, not size.

### 6.2 The proof that `process()` allocates nothing

**Structural.** No type holds an owning container. The registry's map is a flat
`16 × 128` array of `NoteId`, indexed rather than hashed, so a press is a store
and a release is a load and a clear. The voice set is one permutation array.
Envelopes and LFOs are PODs in a flat array. `MpeRouter`'s dispatch is an array
indexed by channel. There is no virtual call on the sample path, and no
`std::function` anywhere — a modulation destination is an index into `ModFrame`,
not a callback.

**Measured**, by `rt_guard.h`. Seven cases, all of which must report zero:

1. 100 blocks of 1024 frames with 16 voices sounding, all envelopes and LFOs
   running, every parameter automated.
2. Note-ons at 200 Hz against a capacity of 8, so every allocation steals.
3. `panic()` called from the audio thread every 500 ms during (2).
4. `setCapacity()` changed from 16 to 4 and back mid-render.
5. An MPE configuration message mid-render, which stops all notes and resets
   every controller — the case most likely to want to rebuild something.
6. Block sizes 16, 17, 64, 128, 1024 in one render.
7. `reset()` from the audio thread, which a transport jump does.

Case 5 is the constraining one. The configuration message's mandatory side
effects include stopping every note on every channel entering or leaving MPE
control, which touches the registry, the voice set and every channel's state.
All three are fixed-size and all three are cleared by writing, not by rebuilding.

### 6.3 Determinism

The golden-render regression is the strongest platform-independent verification
ADR-0005 leaves us, and an instrument is where a render most easily becomes
irreproducible. Four sources, and what closes each:

- **Clock-seeded randomness** in the drift model and the sample-and-hold —
  closed by putting the seed in `DriftConfig` and restoring it on `reset`.
- **Wall-clock drift advance** — closed by advancing on `songSeconds`.
- **Block-dependent modulation** — closed by the absolute-frame grid of §4;
  measured by VS-07 at five block sizes.
- **Allocation order that depends on iteration order** — closed by breaking every
  victim-selection tie on lowest voice index.

### 6.4 Denormals

An envelope decaying toward zero and an LFO's fade ramp both approach denormal
territory, and the core's test binaries are compiled without `-ffast-math`, so
flush-to-zero is not in force where the numbers are graded. Two mechanisms
already handle most of it: `EnvelopeShape::floorValue` is non-zero for the
six-operator consumer by design, and (3)'s offset makes every other envelope
reach exact zero and stop. What remains — the LFO fade state and the glide
residual — is flushed below `1e-20f`, one compare each per grid point rather than
per sample, because both live on the control grid.

---

## 7. CPU budget per tier

Per grid point (every `stride` samples), per voice:

| Item                                                 | Flops |
| ---------------------------------------------------- | ----- |
| Envelope segment advance + curve                     | 20    |
| LFO phase + waveform + delay/fade                    | 12    |
| Drift OU step (5), per deviation                     | 6     |
| Glide step                                           | 5     |
| Modulation matrix slot (multiply–accumulate + clamp) | 3     |
| Voice bookkeeping (age, gate, retirement test)       | 4     |

Per sample, per voice: pitch interpolation from the grid (2 flops) and amplitude
interpolation (2). Everything else is amortised by `stride`.

Substrate overhead per voice per sample, for the two extremes:

| Consumer      | Envelopes        | LFOs           | Matrix slots | Deviations | Grid stride | Flops/sample/voice |
| ------------- | ---------------- | -------------- | ------------ | ---------- | ----------- | ------------------ |
| DCO polysynth | 1                | 1 (instrument) | 0            | 0          | 32          | **5.0**            |
| Analogue five | 2                | 1              | 4            | 6          | 32          | **7.4**            |
| Six-operator  | 7 (6 op + pitch) | 1              | 0            | 0          | 32          | **9.1**            |
| Matrix        | 5                | 5              | 40           | 6          | 32          | **13.7**           |

Against a synth voice's own oscillator and filter cost — 120 flops/sample for a
two-oscillator subtractive voice, 400 for a six-operator voice — the substrate is
**3 % to 11 % of a voice**. That is the number the tiers act on, and it is small
enough that the tier's real lever is the voice count, not the grid.

| Tier   | Voices | Grid stride  | Matrix slots | Drift update         | Matrix synth, 12 instances             |
| ------ | ------ | ------------ | ------------ | -------------------- | -------------------------------------- |
| Eco    | 8      | 64 (750 Hz)  | 20           | every 4th grid point | 8 × 8.4 × 48k × 12 = **38.7 Mflop/s**  |
| Studio | 16     | 32 (1500 Hz) | 40           | every grid point     | 16 × 13.7 × 48k × 12 = **126 Mflop/s** |
| Max    | 32     | 16 (3000 Hz) | 40           | every grid point     | 32 × 24.6 × 48k × 12 = **453 Mflop/s** |

Substrate only; the voices' own DSP is on top and dominates. Every figure is an
operation count against ADR-0006's assumed 2–8 Gflop/s scalar phone core, which
nobody here has verified, so under ADR-0005 these are **MODELLED**, not PASS.

Two tier rules, both inherited from ADR-0006 and both restated here because their
form is different for an instrument:

1. **A tier reduces the voice cap; it never cuts a sounding voice.** The cap
   takes effect on the next allocation. This is the direct analogue of "a tier
   reduces the grain rate, never drops grains mid-flight", and for the same
   reason: a held note stopping because the CPU got busy is a performance problem
   turned into an audible one.
2. **A tier changes the grid stride, never the shape.** Envelope segment times,
   drift depth and LFO rates are all defined in seconds and are unchanged by the
   stride, which is precisely why (5) had to be the exact OU discretisation
   rather than an Euler step.

---

## 8. Verification

Executable claims. Ledger cells — these map onto the instrument columns `I13`
polyphony and stealing, `I14` stuck-note fuzz, `I15` panic clears, `I16` MPE and
`I18` tuning. Run through `renderOffline` at 48 kHz unless stated.

| ID    | Measurement                                                                                                                                                     | Method                                                                | Pass criterion                                                                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS-01 | **Voice cap.** 60 note-ons at one instant, capacity 24. Repeat with 80 against 48.                                                                              | `liveCount()`, `stealCount()`.                                        | `liveCount() == 24` **exactly**; `stealCount() == 36` **exactly**. Second case: 48 and 32. This is PA-003 made executable.                                                                                                            |
| VS-02 | **Partition integrity.** After 100 000 randomised allocate/release/retire/steal operations.                                                                     | Walk the permutation.                                                 | Every `VoiceId` appears **exactly once** across free ∪ allocated; `liveCount()` equals the allocated span; **zero** duplicates. Mutation: replace the partition with a boolean flag per voice and this case must fail by name.        |
| VS-03 | **Stuck-note fuzz.** 5000 seeded events over four instruments: 4400 presses, 4000 releases, 1000 cancels, 500 octave shifts, 20 panics, 200 damper transitions. | Replay from the seed on failure.                                      | **0** held notes; **0** unmatched note-ons; `sustainingCount() == 0` at the end. Non-vacuity: the run must reach `sustainingCount() > 0` at least 500 times mid-run, or the configuration cannot sustain and the test proves nothing. |
| VS-04 | **A release names the press.** 1000 presses, each followed by a randomised transpose or octave change, then a release.                                          | Compare the returned `NoteId` against the minted one.                 | Equal in **1000 of 1000**. This is BUG-005 made executable.                                                                                                                                                                           |
| VS-05 | **Ghost note-off.** Steal voice V from note A with note B, then deliver note-off for A.                                                                         | `sustainingCount()`, `voiceOf(B)`.                                    | `releaseNote(A)` returns **false**; `sustainingCount() == 1`; B still owns V.                                                                                                                                                         |
| VS-06 | **Damper does not extend identity.** Damper down, 12 notes pressed and released, then damper up.                                                                | Three counts at each step.                                            | Immediately after release: `heldCount() == 0`, bound channels **0**, `sustainingCount() == 12`. Within **1 block** of damper up: `sustainingCount() == 0`.                                                                            |
| VS-07 | **Block-size invariance.** 10 s of a 16-voice pattern, block sizes 16, 17, 64, 128, 1024.                                                                       | `peakDifference` against the 128 render.                              | ≤ **6e−8** (half a Float32 step).                                                                                                                                                                                                     |
| VS-08 | **Sample-rate independence.** The same patch at 44.1, 48, 96, 192 kHz.                                                                                          | Time from note-on to −60 dB.                                          | Equal across the four rates within **±0.5 %**.                                                                                                                                                                                        |
| VS-09 | **Rate-driven zero-distance segment.** `L1 == L2`, rate R across 0..99.                                                                                         | Segment duration in samples.                                          | **> 0** at every rate; for R > 76, duration ≤ `20·(99 − R)` samples ± 20 %. A model that advances instantly through a zero-distance segment fails.                                                                                    |
| VS-10 | **Decibel-domain decay is straight.** Domain `Decibel`, R = 50, decay from 0 to −96 dB.                                                                         | Linear regression of level(dB) against time.                          | **R² ≥ 0.999**; slope **64.8 dB/s ± 5 %**. A linear-in-amplitude interpolation gives R² well below 0.9.                                                                                                                               |
| VS-11 | **Attack ends at one time constant.** DCO-polysynth attack shape.                                                                                               | Level at x = 0.5 and x = 1.0.                                         | `L(1.0) = 1.000 ± 0.001`; `L(0.5) = 0.6225 ± 0.002` (= (1 − e^−0.5)/0.632).                                                                                                                                                           |
| VS-12 | **Decay duration independent of sustain.** Same envelope at sustain 0.0 and 0.5, decay control fixed.                                                           | Duration of the decay segment.                                        | The two differ by ≤ **15 %**. A textbook capacitor model differs by ~50 % and fails.                                                                                                                                                  |
| VS-13 | **LFO scope.** Two voices started 250 ms apart, instrument-scoped LFO; then voice-scoped with `Single` retrigger.                                               | Phase difference between the two voices' LFO outputs.                 | Instrument scope: **0.000 ± 1e−6**. Voice scope: equal to 250 ms × rate, modulo 1, ± 1e−4.                                                                                                                                            |
| VS-14 | **Two-stage LFO delay.** Delay 0.85 s, fade 0.188 s.                                                                                                            | Output envelope after note-on.                                        | Output is **exactly 0** for 0.85 s ± 5 %; reaches 0.99 of full depth 0.188 s ± 5 % later. A one-stage model has no zero region and fails the first half.                                                                              |
| VS-15 | **Maximum, not sum.** Pitch modulation depth with LFO and wheel both at full.                                                                                   | Peak pitch deviation.                                                 | Within **2 %** of the larger contribution; at least **40 % below** their sum.                                                                                                                                                         |
| VS-16 | **Drift determinism.** Two full renders, same seed, separate processes; then a render of bars 33–40 against the tail of a render of bars 1–40.                  | `peakDifference`.                                                     | Same seed: **exactly 0.0f**. Song-position case: **exactly 0.0f**. Then change only the seed and assert the difference exceeds −40 dBFS, so the test is not passing on an engine that ignores drift.                                  |
| VS-17 | **Drift off by default.** `vintage = 0`, two voices on the same key.                                                                                            | Null one voice against the other.                                     | Residual ≤ **−140 dBFS**. The divider-derived instrument must be exact.                                                                                                                                                               |
| VS-18 | **Drift magnitude and correlation.** `vintage = 1`, 600 s of song time.                                                                                         | Standard deviation of pitch deviation; autocorrelation of the series. | σ = **3.0 cents ± 10 %**; autocorrelation crosses 1/e at **30 s ± 15 %**. Repeat at grid strides 16, 32, 64 and assert σ changes by ≤ 3 % — that is the test that (5) is the exact OU step and not an Euler one.                      |
| VS-19 | **Tuning-error shape.** `vintage = 1`, immediately after `tune()`, sample every semitone C0–C8.                                                                 | RMS deviation per octave.                                             | RMS below C3 is **≥ 2.5×** RMS above C3; RMS immediately after `tune()` is ≤ **0.4 cents**. Uniform random detune fails the first.                                                                                                    |
| VS-20 | **MPE sensitivity defaults.** Configuration message, then a full member bend and a full master bend.                                                            | Pitch deviation in semitones.                                         | Member: **48.00 ± 0.01**. Master: **2.00 ± 0.01**.                                                                                                                                                                                    |
| VS-21 | **MPE snapshot.** Set channel 3 bend to +12 semitones with nothing sounding, then note-on channel 3.                                                            | Starting pitch.                                                       | **+12.00 semitones ± 0.01** at the first sample of the note.                                                                                                                                                                          |
| VS-22 | **MPE release isolation.** Note-off on channel 3, then a full member bend on channel 3 during the release tail.                                                 | Pitch of the releasing voice.                                         | Changes by **0.000 semitones**. Then note-on a new note on channel 3 and assert _it_ starts bent — so the test is not passing on a router that dropped channel 3 entirely.                                                            |
| VS-23 | **Zone truncation.** Lower zone 10 members, then upper zone 10 members.                                                                                         | Both zones' channel sets.                                             | The two sets are **disjoint**; total members ≤ **14**; the lower zone was truncated, not the message ignored.                                                                                                                         |
| VS-24 | **Note-on velocity 0.**                                                                                                                                         | Registry and voice state.                                             | Treated as note-off; release velocity **64/127 ± 1/127**.                                                                                                                                                                             |
| VS-25 | **Portamento laws.** A 1-semitone and a 24-semitone glide, in `ConstantTime` and in `ConstantRate`.                                                             | Time to arrive.                                                       | `ConstantTime`: the two are equal within **1 ms**. `ConstantRate`: ratio **24:1 ± 2 %**.                                                                                                                                              |
| VS-26 | **Glide snaps.** `Exponential` law, 12-semitone glide.                                                                                                          | `gliding()` and the final pitch.                                      | `gliding()` becomes false within **0.005 semitones** of the target, and the reported pitch is then **bit-exactly** the target.                                                                                                        |
| VS-27 | **Multi-portamento.** `PolyPerVoice`, three voices with three different previous notes, then a three-note chord.                                                | Starting pitch of each glide.                                         | The three starting pitches equal the three previous notes **exactly**. With `Mono` the same case gives one starting pitch, which the test asserts as the contrast.                                                                    |
| VS-28 | **Panic clears.** `panic()` from the audio thread with 16 voices sounding.                                                                                      | Counts and samples.                                                   | `sustainingCount() == 0` **in the same block**; no per-sample first difference exceeds `peak/(0.0015·fs)` — i.e. the declick envelope was applied and there is no step.                                                               |
| VS-29 | **Capacity change under load.** 16 voices sounding, `setCapacity(8)`.                                                                                           | Counts across the transition.                                         | **Zero** sounding voices cut; `liveCount()` stays 16 until notes release; the 9th subsequent allocation steals rather than exceeding 8.                                                                                               |
| VS-30 | **Zero allocations in process.** `RtGuard` over the seven cases of §6.2.                                                                                        | `guard.allocations()`.                                                | **0** in each. Mutation-tested: a deliberate `new` in `allocate` fails the case by name.                                                                                                                                              |
| VS-31 | **One allocation in prepare.** `RtGuard` across the instrument's whole `prepare()`.                                                                             | `guard.allocations()`.                                                | **Exactly 1.**                                                                                                                                                                                                                        |

---

## 9. Open questions

1. **The sampler's reference sheet does not exist.** `PROGRESS.md` names writing
   `docs/reference/smp-01` as the action that unblocks that unit, and it is the
   only missing sheet of fourteen. Everything this document says about the
   sampler — that it wants an attack-hold-decay-sustain-release shape, that its
   `stealFadeMs` default is 1.5 ms, that "multi-portamento" means
   `GlideMode::PolyPerVoice` — is **assumed**, and every one of those assumptions
   must be re-checked when the sheet lands. `GlideMode::PolyPerVoice` in
   particular is a reading of a two-word phrase in a phase plan.
2. **One consumer's voice-assignment behaviour is unknown.** Its own sheet records
   rotation order and stealing policy as unfound. The substrate defaults it to
   `RoundRobin` with `ReleasingQuietestFirst`, and that is our choice, not a
   fact about the instrument.
3. **The matrix instrument's 0..63 time parameters have no published real-world
   units.** Its sheet marks them as unavailable outright. Until they exist, that
   instrument's envelope and LFO rate tables cannot be calibrated, and its
   verification rows can assert ordering and monotonicity but not seconds.
4. **The six-operator engine's zero-distance segment durations are unconfirmed.**
   The only source is an empirically gathered table that its own author flags as
   needing double-checking, gathered from two units. VS-09 therefore grades the
   _existence_ of a non-zero duration and bounds it loosely, because the
   existence is what is audible and the exact values are not established.
5. **"Combine meaningfully" is unspecified for master-channel pressure and
   timbre.** Summing in the normalised domain and clamping is what most receivers
   do and is what this document specifies, but it is our interpretation and the
   specification declines to say. If a controller in the field disagrees, this is
   the line that moves.
6. **The 32-sample control grid is chosen, not measured.** Whether the Eco tier's
   64-sample stride (750 Hz) is audible on a fast pressure gesture or a snapped
   glide has not been tested, and cannot be on this host — it needs a device and
   a listener, which ADR-0005 classes as BLOCKED. If it is audible, the Eco lever
   has to move from the grid to the voice count alone.
7. **The steal declick defaults are judgement.** No published measurement of any
   reference instrument's steal artefact exists. Zero for the vintage units
   follows from their sheets saying the hardware simply reloads and retriggers
   and that modelling a graceful fade would be an improvement and therefore
   wrong; 1.5 ms for the sampler follows from nothing but the observation that a
   sample cut mid-waveform pops.
8. **Whether to reproduce a short-period sample-and-hold.** One consumer's
   hardware generator repeats audibly, and whether that repetition is character or
   defect is a listening question. The default is a long period; the short-period
   option is not specified until somebody listens.
9. **One consumer's quarantined constants are still quarantined.** Its envelope
   lookup tables and its amplifier gain law came from a copyleft emulator, are
   marked as such in `LEGAL_NOTES.md`, and **may not reach `motionwave/`**. The
   envelope shape family in §5.2 is built only from that sheet's _measured_ rows
   — the five slider positions and the two fitted curves — and the two
   quarantined tables remain to be re-derived or replaced before that instrument
   ships.
