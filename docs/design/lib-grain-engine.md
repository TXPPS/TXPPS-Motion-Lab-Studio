# Design — the grain engine

**Scope:** a design. Every signature below is a declaration, and what exists is
recorded in `docs/UNIT_LEDGER.md`, which `npm run ledger-guard` checks against
named tests. A status sentence here would be a second copy of that, checked by
nobody.

**Home:** `motionwave/core/dsp/grain/`
**Namespace:** `mw::dsp::grain`
**Consumers:** Granular Reverb and Granular Delay (Phase 7).
**Sources:** `docs/reference/fx-02-granular-reverb.md`,
`docs/reference/fx-03-granular-delay.md`, ADR-0006.
No reference product name appears here; the sheets hold those.

---

## 1. Purpose, and the boundary

`fx-03` opens by saying "read `fx-02` §1 first — grain windows, the
density/overlap normalisation, and the scheduler are specified there and are not
repeated here." That sentence is this library's charter. Both units need the same
scheduler, the same windows, the same normalisation, the same interpolated
pitched read and the same allocation-free lifecycle; they differ in what they
granulate and in what they do with the result.

So the engine owns:

1. **Scheduling** — when a grain starts, to a fraction of a sample.
2. **Windowing** — the shapes, their tables, and the constants the normalisation
   depends on.
3. **The grain** — read position, pitch, reverse, pan, amplitude, and its life.
4. **The pool** — a fixed set of slots, and the arithmetic that makes exhaustion
   unreachable rather than merely unlikely.
5. **The visualiser state**, published from the same structs the render used.

The engine owns **none** of: the reverb's feedback loop, its diffusion allpasses,
its damping, tilt or freeze; the delay's tap times, routing matrix, feedback
chain, tape or bucket-brigade character. Those are per-unit and they are the
whole difference between the two devices.

One deliberate exception to that boundary, going the other way: the delay's tape
character needs a magnetic-hysteresis primitive, and one already exists in
`mw::dsp::nl::MagneticCore` (`docs/design/lib-nonlinear.md` §4.5). The delay
consumes it rather than growing its own. Two hysteresis models in one product
would be two answers to one question.

### 1.1 What each consumer needs, side by side

| Requirement                                   | Granular Reverb                                      | Granular Delay                                                                |
| --------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| Source buffer                                 | one mono circular buffer, written by a feedback loop | two channels, written by the input, read at N tap positions                   |
| Scheduler instances                           | one                                                  | **one per tap** (Smear sets grains-per-tap and taps have independent lengths) |
| Grain length                                  | 5–500 ms, default 60                                 | 35–120 ms, driven by Smear                                                    |
| Density                                       | 1–2000 grains/s, default 350                         | grains-per-tap 1–32, driven by Smear                                          |
| Position spray                                | 0–100 % of the size window                           | ±15 to ±400 ms by Smear                                                       |
| Per-grain pitch                               | weighted interval set, per grain                     | per tap, fixed, plus fine detune                                              |
| Reverse                                       | not used                                             | per tap, forces grain length ≥ 30 ms                                          |
| Smear = 0 collapse                            | not used                                             | **must be bit-exact a plain interpolated tap**                                |
| Normalisation must sit inside a feedback loop | yes                                                  | yes                                                                           |
| Visualiser                                    | live particles over the buffer                       | live particles per tap                                                        |

The engine serves both by holding no opinion about where the source samples came
from: it is handed a view of somebody else's buffer and a write-head index.

---

## 2. Files

| File                    | Contents                                             | Budget |
| ----------------------- | ---------------------------------------------------- | ------ |
| `grain/window_tables.h` | generated `constexpr` tables and their moments       | 120    |
| `grain/window.h`        | shape enum, table lookup, normalisation constants    | 130    |
| `grain/grain.h`         | the `Grain` POD, spawn, render-one                   | 200    |
| `grain/pool.h`          | `GrainPool`, the free/active partition, reservations | 190    |
| `grain/scheduler.h`     | `Scheduler`, the fractional onset counter, jitter    | 180    |
| `grain/source.h`        | `GrainSource` view, interpolated and pitched reads   | 170    |
| `grain/engine.h`        | `GrainEngine`, `process`, tier caps                  | 300    |
| `grain/visual.h`        | `GrainView`, `GrainFrame`, the publish ring          | 170    |
| `grain/rng.h`           | the deterministic generator                          | 80     |

---

## 3. Public interface

```cpp
namespace mw::dsp::grain {

// ------------------------------------------------------------------ source

/// A view of somebody else's circular buffer.
///
/// Non-owning, exactly like `AudioBuffer`, and for the same reason: the reverb's
/// buffer is a feedback loop and the delay's is a tap line, and an engine that
/// owned the storage would have to have an opinion about which. The unit writes
/// it; the engine only reads behind the write head.
struct GrainSource {
  const float* data = nullptr;
  /// Power of two, so the wrap is a mask. A modulo per interpolated read per
  /// grain is a division in the innermost loop the engine has.
  int capacity = 0;
  int mask = 0;
  /// Where the unit's write head is *at the first frame of this block*. The
  /// engine advances its own copy per sample; it never re-reads this mid-block,
  /// because a read offset measured against a moving head is not an offset.
  int writeIndex = 0;
  double sampleRate = 48000.0;
};

// ------------------------------------------------------------------ window

enum class WindowShape : std::uint8_t { Hann = 0, Tukey = 1, Gaussian = 2, Rectangular = 3 };

/// Mean of w and of w², for the amplitude normalisation of §5.3.
///
/// Read from the generated tables rather than from a closed form, so the
/// constant the normalisation uses and the table the audio reads cannot drift
/// apart. Getting this wrong is the most common failure in granular code: the
/// device gets louder as density rises, the user trims the output, and then the
/// feedback loop's gain changes with density and the reverb runs away.
float windowMean(WindowShape shape, float tukeyAlpha) noexcept;
float windowMeanSquare(WindowShape shape, float tukeyAlpha) noexcept;

// ------------------------------------------------------------------- grain

/// What a grain captures at spawn and never re-reads.
///
/// A grain that consulted a live parameter mid-flight would change pitch or pan
/// under a user's hand and would make the visualiser's particles disagree with
/// what is sounding. Everything a grain needs is frozen here at spawn.
struct GrainSpec {
  double readOffset = 0.0;      ///< samples behind the write head, fractional
  int lengthSamples = 0;
  float pitchRatio = 1.0f;      ///< 2^(semitones/12); negative is not used, see `reverse`
  float amplitude = 1.0f;
  float pan = 0.0f;             ///< −1 hard left, +1 hard right
  float onsetFraction = 0.0f;   ///< sub-sample onset, 0..1
  WindowShape shape = WindowShape::Hann;
  float tukeyAlpha = 1.0f;
  bool reverse = false;
  std::uint8_t tap = 0;         ///< which scheduler spawned it; 0 for the reverb
};

/// One live grain. Trivially copyable, 64 bytes, no owning members.
struct Grain {
  double readPos = 0.0;
  double readInc = 1.0;
  float windowPhase = 0.0f;
  float windowInc = 0.0f;
  int remaining = 0;
  float gainL = 0.0f;
  float gainR = 0.0f;
  float lpState = 0.0f;         ///< pre-read anti-alias pole, used only when |pitch| is large
  float lpCoeff = 0.0f;
  std::uint32_t id = 0;         ///< monotonic, stable for this grain's whole life
  std::uint16_t windowBase = 0;
  std::uint8_t tap = 0;
  std::uint8_t flags = 0;
};

// -------------------------------------------------------------------- pool

/// Fixed-size slot store with a free/active partition.
///
/// Membership is a *position*, not a flag. Two flags can disagree with each
/// other and with a count; a position cannot. `active()` returns a contiguous
/// prefix, so the render loop has no liveness branch and no gaps.
class GrainPool {
 public:
  /// Bytes this configuration needs, so the engine can size one arena.
  static std::size_t storageBytes(int slots) noexcept;

  void prepare(int slots, int tapCount, void* storage, std::size_t bytes) noexcept;
  void reset() noexcept;

  /// Null when this tap has used its reservation and the shared surplus is
  /// gone. The caller counts the miss; it never waits and never grows.
  Grain* acquire(std::uint8_t tap) noexcept;

  /// Retire by index. The last active grain is swapped into the freed slot, so
  /// slot indices are **not** stable across a retirement — which is exactly why
  /// `Grain::id` exists and why the visualiser keys on it. A particle that
  /// keyed on a slot index would teleport whenever a neighbour ended.
  void retire(int activeIndex) noexcept;

  Grain* active() noexcept;
  int activeCount() const noexcept;
  int capacity() const noexcept;

  /// Per-tap guarantee, §5.6.
  int reservationPerTap() const noexcept;
};

// --------------------------------------------------------------- scheduler

struct ScheduleConfig {
  float grainsPerSecond = 350.0f;
  /// 0 gives a constant hop (quasi-synchronous); 1 gives a fully stochastic
  /// onset series. A reverb wants the stochastic end, because a constant hop
  /// makes the grain rate audible as a pitch.
  float onsetJitter = 0.6f;
};

class Scheduler {
 public:
  void prepare(double sampleRate, const ScheduleConfig& config, std::uint64_t seed) noexcept;
  void setConfig(const ScheduleConfig& config) noexcept;
  void reset() noexcept;

  /// Frames until the next onset, and the sub-sample fraction of that onset.
  /// Returns a whole-sample count so the engine can render in spans between
  /// onsets; the fraction is handed to the grain and applied as an initial
  /// fractional read offset *and* an initial window phase.
  int framesToNextOnset(float* outFraction) noexcept;

  void consume(int frames) noexcept;
  std::uint64_t spawnCount() const noexcept;
};

// ------------------------------------------------------------------ visual

/// One grain as the visualiser sees it. 24 bytes.
struct GrainView {
  std::uint32_t id = 0;
  float age = 0.0f;             ///< 0..1 through its window, now
  float positionSeconds = 0.0f; ///< where in the buffer it is reading, now
  float pitchRatio = 1.0f;
  float pan = 0.0f;
  float amplitude = 0.0f;       ///< current *windowed* amplitude, not the peak
};

inline constexpr int kPublishedGrains = 64;

/// One visualiser frame. Trivially copyable, so it can cross the SPSC ring.
struct GrainFrame {
  std::uint32_t sequence = 0;
  float bufferSeconds = 0.0f;
  float writeHeadSeconds = 0.0f;
  std::uint16_t published = 0;
  /// True count, which may exceed `published`. The UI is told both so it can
  /// say "64 of 210 shown" instead of drawing a lie.
  std::uint16_t live = 0;
  std::uint8_t tapCount = 1;
  GrainView grains[kPublishedGrains];
};

// ------------------------------------------------------------------ engine

enum class Tier : std::uint8_t { Eco = 0, Studio = 1, Max = 2 };

struct EngineConfig {
  int tapCount = 1;             ///< 1 for the reverb, 1..8 for the delay
  int poolSlots = 256;
  int maxGrainSamples = 24000;  ///< 500 ms at 48 kHz
  Tier tier = Tier::Studio;
  /// Part of the configuration, not drawn from a clock. A render is a pure
  /// function of (graph, spec) and a golden file is checked in; a scheduler
  /// seeded from the wall clock would make every golden render fail once.
  std::uint64_t seed = 0x9E3779B97F4A7C15ull;
};

struct SpawnParams {
  float grainSeconds = 0.060f;
  float lengthJitter = 0.25f;
  float minOffsetSeconds = 0.020f;
  float spraySeconds = 0.400f;
  float sprayAmount = 0.70f;
  float ampJitter = 0.15f;
  float panSpread = 1.0f;
  WindowShape shape = WindowShape::Hann;
  float tukeyAlpha = 1.0f;
  bool reverse = false;
  /// Weighted semitone set, §5.4. At most 8 entries; a null set means unison.
  const float* pitchSemitones = nullptr;
  const float* pitchWeights = nullptr;
  int pitchCount = 0;
  float pitchSpreadCents = 0.0f;
};

class GrainEngine {
 public:
  /// Floats and bytes this configuration needs, before `prepare` is called.
  static std::size_t arenaBytes(const EngineConfig& config, int maxFrames) noexcept;

  /// Off the audio thread. One allocation for the whole engine, made by the
  /// caller into `arena`; the engine takes no memory of its own.
  bool prepare(double sampleRate, int maxFrames, const EngineConfig& config,
               void* arena, std::size_t bytes) noexcept;

  void reset() noexcept;

  /// Block rate, before any sample is touched. `tap` is 0 for the reverb.
  void setSchedule(std::uint8_t tap, const ScheduleConfig& schedule) noexcept;
  void setSpawn(std::uint8_t tap, const SpawnParams& spawn) noexcept;
  void setTier(Tier tier) noexcept;

  /// Renders every live grain into the stereo accumulator, spawning new ones at
  /// their sample-accurate onsets. Writes, does not accumulate; the unit sums.
  void process(const GrainSource& source, float* outL, float* outR, int frames) noexcept;

  /// Overlap factor actually in force after the tier cap, per tap. This is the
  /// number that predicts both the sound and the CPU, and the UI shows it.
  float overlap(std::uint8_t tap) const noexcept;
  /// Density after the cap. Shown so a user on Eco is not lied to.
  float clampedDensity(std::uint8_t tap) const noexcept;

  int liveGrains() const noexcept;
  std::uint64_t spawned() const noexcept;
  std::uint64_t dropped() const noexcept;

  /// Consumer side of the visualiser ring, called from the UI thread. Returns
  /// false when no new frame is ready, in which case the UI draws the previous
  /// one — a visualiser that misses a frame is fine; one that blocks the audio
  /// thread is a defect (ADR-0004).
  bool takeFrame(GrainFrame* out) noexcept;
};

}  // namespace mw::dsp::grain
```

---

## 4. Naming: the sheets' tiers and ADR-0006's

`fx-02` §7.4 and `fx-03` §9.3 name their quality tiers **Eco / Normal / High**.
ADR-0006 names the product's tiers **Eco / Studio / Max**. They are the same three
tiers and this library uses ADR-0006's names, because that is the ADR and because
a user-visible tier that is called one thing in a spec sheet and another on a
panel is how a bug report becomes untranslatable.

| ADR-0006 | Sheets        | Interpolation                       | Max overlap `O` per tap |
| -------- | ------------- | ----------------------------------- | ----------------------- |
| Eco      | Normal→ _Eco_ | linear                              | 12                      |
| Studio   | _Normal_      | cubic Hermite                       | 32                      |
| Max      | _High_        | cubic Hermite + pre-read anti-alias | 96                      |

---

## 5. DSP formulation

### 5.1 Scheduling, and the artefact it exists to prevent

Onsets come from a running fractional counter in **double**:

```
    Δ = (fs / R) · (1 + ξ·jitter),        ξ ~ U(−1, +1)                     (1)
```

accumulated in a double-precision fractional sample counter. When the counter
crosses an integer boundary a grain is spawned with **the fractional part
preserved**, applied as both an initial fractional read offset and an initial
window phase.

The failure this design exists to prevent is specific and measurable: if onsets
are quantised to block boundaries, a 256-sample block at 48 kHz imposes a
**187.5 Hz** periodicity on the cloud. It is plainly audible as a buzz, it is
independent of every user control, and — this is the part that makes it hard to
find — it moves when the host changes its buffer size, so it reads as an
environment problem. GE-03 tests for it at four block sizes precisely because
"the artefact must not move with block size" is the definitive discriminator.

`process` therefore walks the block in spans:

```
    while (framesLeft > 0):
        n = min(framesLeft, scheduler.framesToNextOnset(&fraction))
        renderSpan(n)                 # every live grain advances n samples
        if (n reached the onset): spawnGrain(fraction)
        framesLeft -= n
```

A span may be zero-length when two onsets land in the same sample, which happens
at high density and must not loop forever; the span loop is bounded by
`frames + maxSpawnsPerBlock` iterations, and `maxSpawnsPerBlock` is
`ceil(R_max · maxFrames / fs) + 1`, computed at `prepare`.

### 5.2 Windows

Let `N` be grain length in samples, `x = n/(N−1) ∈ [0,1]`.

```
    Hann:      w(x) = 0.5·(1 − cos 2πx)
    Tukey(α):  w(x) = 0.5·(1 + cos(π·(2x/α − 1)))          0 ≤ x < α/2
               w(x) = 1                                     α/2 ≤ x ≤ 1 − α/2
               w(x) = 0.5·(1 + cos(π·(2x/α − 2/α + 1)))     1 − α/2 < x ≤ 1
    Gaussian:  w(n) = exp(−½·((n − M)/(σM))²),   M = (N−1)/2,  σ = 0.30
```

σ is **fixed at 0.30 and not exposed**. At 0.30 the endpoint is 0.00387, which is
−48.2 dB and inaudible; at 0.50 it is 0.135, which is −17.4 dB and clicks once
per grain. A σ control is a control whose upper half is a defect.

Tables are **4096 points plus one guard point**, read with linear interpolation
and a per-grain phase increment of `4096/N`. That is 4 flops per sample per grain
against roughly 25 for evaluating a cosine. The window is **not** computed with a
recursive resonator: a resonator drifts over long grains and the drift lands
exactly on the grain tail, which is where a discontinuity clicks.

**The tables are generated at build time** by `motionwave/tools/gen_window_tables`
into a `constexpr` header, together with their moments. Three reasons, all of
which bite later if the tables are built on first use: a function-local static
initialised on first `prepare()` compiles to a _locking_ initialisation and the
audio thread may not take a lock; a table computed at run time can differ in the
last bit between targets, which would break the golden render on a phone for a
reason that is not a bug; and generating the moments alongside the samples is
what stops the normalisation constant and the table the audio reads from drifting
apart.

The generator asserts its own output against the closed forms:

| Window         | `mean(w)`               | `mean(w²)`                  |
| -------------- | ----------------------- | --------------------------- |
| Hann           | 0.5                     | 0.375 (= 3/8)               |
| Tukey(α)       | 1 − α/2                 | 1 − 5α/8                    |
| Tukey(1)       | must equal Hann exactly | must equal Hann exactly     |
| Gaussian σ=0.3 | ≈ 0.376                 | ≈ 0.266 — numerical, see §8 |
| Rectangular    | 1                       | 1                           |

### 5.3 Density, overlap and normalisation

```
    O = R · L                (overlap factor, expected grains sounding at once) (2)
    A = 1 / sqrt( O · mean(w²) )         incoherent grains                     (3)
```

Grains here are incoherent — asynchronous onsets, randomised read positions — so
**powers add** and (3) is the correct normalisation. The coherent form
`A = 1/(O·mean(w))` is wrong for this engine and is not offered, because offering
it would put a 6 dB error one enum value away.

`A` is applied **at spawn**, so it is inside whatever loop the unit builds around
the engine. That placement is the entire content of `fx-02` V6 and `fx-03` V6:
if the normalisation sits on the output instead, turning Density up multiplies
the loop gain, the decay time changes with density, and at long decays the reverb
runs away. GE-06 measures RT60 across a 75:1 density sweep and fails at 5 %
variation.

**Hann at hop exactly `N/2` (`O = 2`) sums to exactly 1.0.** The running engine is
asynchronous and does not satisfy constant-overlap-add, but that identity gives
an exactly-verifiable test case (GE-02) for the table, the phase increment and
the normalisation in isolation, and it is the first test to run because every
later failure is ambiguous until it passes.

### 5.4 Per-grain pitch

```
    r = 2^(s/12)                                                             (4)
```

The grain reads the buffer with increment `r` while its **window still runs for
`L` seconds of output**, so it consumes `r·L` seconds of source. No phase vocoder,
no FFT, no latency: the cost is the interpolated read the engine was already
doing. This is granular synthesis's structural advantage and it is the reason
both units are granular.

`s` is drawn per grain from a weighted set, plus a uniform detune of
`±pitchSpreadCents`. Drawing per grain rather than fixing one shift is what makes
a chord instead of a detune — a fixed shift gives one transposed copy, while a
per-grain draw gives a simultaneous chord whose voices are continuously
reshuffled.

Reverse plays the grain's source span backwards: the read starts at
`readOffset − r·L·fs` and the increment is `−r`. Reverse is coherent **only** when
the grain has a defined span, so enabling it forces `grainSeconds ≥ 0.030` and
`grainsPerTap ≥ 1`; without that clamp a "reversed" non-granular tap stutters at
the buffer wrap.

Interpolation: **4-point cubic Hermite** (≈14 flops) at Studio and Max, linear
(≈4) at Eco. Linear at `r = 2` has a −6 dB error at Nyquist/2 and audible
aliasing on bright material, so the Eco tier's interpolation choice is a real,
stated cost and GE-11 publishes its alias figure rather than assuming it. At
`|s| > 12` semitones, Max additionally applies a one-pole at `0.45·fs/r` before
the read; the pole's state is per grain because per-grain pitch differs, which is
what the two floats in `Grain` are for.

### 5.5 Spray and jitter — five independent axes

Position spray, onset jitter, amplitude jitter, length jitter and pan spread are
five separate controls because they are five separate perceptual dimensions and
collapsing them loses settings that both sheets call for.

The delay collapses them behind one **Smear** control, which is a UI decision
belonging to that unit, not an engine decision. The engine takes the five; the
delay's Smear table drives them:

| Smear | Grains/tap | Position spray | Onset jitter | Grain length    |
| ----- | ---------- | -------------- | ------------ | --------------- |
| 0 %   | 1          | 0              | 0            | window bypassed |
| 25 %  | 3          | ±15 ms         | 10 %         | 120 ms          |
| 50 %  | 8          | ±60 ms         | 35 %         | 80 ms           |
| 75 %  | 16         | ±150 ms        | 60 %         | 55 ms           |
| 100 % | 32         | ±400 ms        | 100 %        | 35 ms           |

Grains get **shorter** as smear rises, which is what walks the tap across the
~50 ms fusion threshold: above it the grains are heard as separate events, below
it they fuse into a cloud. That crossing is the whole content of the control.

**Smear = 0 must reduce to a plain interpolated read.** Not "sound like" —
reduce to. The window is bypassed entirely, one grain per tap runs continuously,
and GE-07 nulls the result against a reference plain tap at −140 dBFS. That test
is the cheapest possible guarantee that the granular machinery has not quietly
coloured the conventional delay everybody uses ninety per cent of the time.

**Randomness is deterministic.** One 64-bit generator per engine, seeded from
`EngineConfig::seed`, restored by `reset()`. `renderOffline` documents its own
contract — "nothing here reads a clock, a random source, or anything outside its
arguments" — and a golden render is checked in. An engine seeded from the clock
would make every golden render fail exactly once and then be quietly deleted.

### 5.6 The pool, and why exhaustion is unreachable

Onsets are a stochastic process with mean `O` grains sounding at once. For a
Poisson count with mean `O`, the standard deviation is `sqrt(O)`, so
`O + 4·sqrt(O)` bounds the 99.99th percentile closely enough for this purpose.
With length jitter of ±25 % the effective mean rises by up to 25 %.

At the Max tier's cap of `O = 96`:

```
    worst-case mean  = 96 × 1.25 = 120
    99.99th pct      ≈ 120 + 4·sqrt(120) = 164
    pool             = 256                                                   (5)
```

**256 slots is 1.56× the 99.99th percentile and 2.13× the mean.** That arithmetic
is why `dropped == 0` is a design guarantee rather than a hope, and GE-08 asserts
it as exactly zero at five densities over 60 seconds each.

The tier cap is applied by **reducing `R` to satisfy `R·L ≤ O_max`, never by
dropping grains mid-flight.** ADR-0006 §1 puts the reason plainly: dropping a
sounding grain modulates loudness with CPU load, which turns a performance
problem into an audible one and makes it the user's problem to explain. Reducing
`R` changes the density, and (3) compensates automatically, so the result is
sparser-textured but level-stable. The clamped density is published through
`clampedDensity()` and shown.

**Per-tap reservation.** The delay shares one pool across up to eight taps. Each
tap is guaranteed `floor(slots / tapCount)` slots and may borrow from the surplus
above that. Without the reservation a tap at Smear 100 % starves a tap at Smear
25 % and one tap of a multi-tap delay silently stops sounding — which reads as a
routing bug, not a pool bug, and would cost a day.

### 5.7 Visualiser state

Ledger cell `U20` and Directive 04 §7 require the visualiser to show **real
engine state**. CLAUDE.md states the same rule more strongly: a picture is drawn
from the same evaluation the audio uses, never a second opinion, and it is the
rule that has caught the most bugs in this codebase.

So `GrainView` is filled **from the live `Grain` structs, after the block was
rendered, using the same `readPos` and `windowPhase` the samples came from.**
There is no parallel particle simulation and no re-derivation of where a grain
"would be".

ADR-0004 says the audio→UI direction is write-only from audio through a
pre-allocated ring. So the engine _publishes_; the UI does not poll a getter that
would race:

- Publish rate is capped at **60 Hz**, counted in samples so it is block-size
  invariant. At 64-frame blocks the engine would otherwise publish 750 times a
  second to a screen that redraws sixty.
- When `live > 64`, the published subset is **the 64 oldest by `id`** —
  deterministic, so particles persist between frames instead of flickering as a
  random subset reshuffles.
- `id` is a monotonic spawn counter and is **stable for a grain's whole life**.
  It has to be: `GrainPool::retire` swaps the last active grain into the freed
  slot, so slot indices change under a grain that did nothing. A visualiser
  keyed on slot index would teleport a particle every time an unrelated
  neighbour ended, and GE-13 is the test that catches it.
- `GrainFrame` is 1552 bytes and trivially copyable, so it satisfies
  `SpscRing`'s static assertion. A ring depth of 4 costs 6.2 KB.

---

## 6. Real-time safety

### 6.1 What `prepare()` allocates

Nothing. `GrainEngine::prepare` takes an arena the caller allocated after asking
`arenaBytes()`, so **the whole engine is one allocation made by the unit**, and
the unit's own `prepare` can be wrapped in an `RtGuard` asserting
`allocations() == 1`. A unit that allocates once can be counted; a unit that
allocates eleven times can only be reviewed.

Per instance, at `poolSlots = 256`, `tapCount = 8`, `maxFrames = 1024`:

| Item                                            | Bytes           |
| ----------------------------------------------- | --------------- |
| Grain pool, 256 × 64 B                          | 16 384          |
| Pool index partition, 256 × 2 B × 2             | 1 024           |
| Schedulers, 8 × 48 B                            | 384             |
| Spawn parameter sets, 8 × 96 B                  | 768             |
| Visualiser ring, 4 × 1552 B                     | 6 208           |
| Stereo accumulator, 2 × 1024 × 4 B              | 8 192           |
| **Per instance**                                | **≈ 33 KB**     |
| Window tables, `constexpr`, shared process-wide | 65 552 (rodata) |

Against the reverb's own 960 KB circular buffer and the delay's 0.19–3.07 MB
line, the engine's footprint is under 4 % of the instance and is not the memory
question — the memory question is the source buffer and it belongs to the units.

### 6.2 The proof that `process()` allocates nothing

**Structural.** `GrainEngine` holds no owning container; every pointer is into
the arena and is fixed at `prepare`. `GrainSource` is a non-owning view, exactly
like `AudioBuffer`, and for the same stated reason: a buffer that could allocate
is a buffer someone will allocate. Spawning takes a slot from a fixed partition
and returns null on a miss. Retiring is a swap and a decrement. The publish path
pushes a fixed-size POD into a pre-allocated ring and drops on full. There is no
virtual call on the sample path.

**Measured**, by `rt_guard.h`. Six cases, all of which must report zero:

1. 100 blocks of 1024 frames at the default density.
2. Density automated across its full range, 1 → 2000 grains/s, in one render.
3. The tier changed from Max to Eco and back **mid-render**, which is the case
   that would tempt a re-prepare.
4. `tapCount` at 8 with every tap's Smear automated independently.
5. Deliberate pool exhaustion: `poolSlots` forced to 16 with `O = 96`, so
   `acquire` returns null thousands of times. The miss path must not allocate,
   and `dropped()` must be non-zero, or the test is vacuous.
6. `reset()` from the audio thread mid-render, which a transport jump does.

Case 5 deserves the space it takes: a drop counter that is never exercised is a
counter nobody has checked, and `fx-02` V8 makes `dropped == 0` a pass criterion
in normal operation — which is only meaningful if the non-zero path is known to
work.

### 6.3 Determinism as a real-time property

Two renders of the same graph with the same seed must be **bit-identical**, not
close. That is not a nicety: the golden-render regression is the only
platform-independent verification ADR-0005 leaves us, and a granular engine is
the most obvious place for a render to become irreproducible. The three ways it
could, and what prevents each:

- **Clock-seeded randomness** — prevented by putting the seed in the config.
- **Block-dependent scheduling** — prevented by the fractional onset counter of
  §5.1, and measured by GE-03 and GE-12 at five block sizes.
- **Uninitialised pool storage** — prevented by `prepare` zeroing the arena and
  by `reset` re-zeroing it. A grain that starts from a stale `lpState` produces a
  render that differs on the second run.

---

## 7. CPU budget per tier

The dominant term is grain rendering, and it is **linear in the overlap factor**:

```
    flops/sample ≈ C_grain · O_total + C_engine                              (6)
```

where `O_total` is summed over taps. `C_grain`, per grain per sample:

| Operation                              | Studio/Max | Eco    |
| -------------------------------------- | ---------- | ------ |
| Read-pointer advance + mask wrap       | 2          | 2      |
| Interpolation (cubic Hermite / linear) | 14         | 4      |
| Window table read + lerp               | 4          | 4      |
| Amplitude + pan, accumulate to L and R | 4          | 4      |
| **C_grain**                            | **24**     | **14** |

`C_engine`, per sample, stereo — the engine's own overhead, excluding everything
the units add:

| Item                                                          | Flops              |
| ------------------------------------------------------------- | ------------------ |
| Scheduler amortised (R spawns/s × ~60 flops)                  | ~1 per tap         |
| Accumulator clear                                             | 2                  |
| Visualiser publish, amortised at 60 Hz × 64 grains × 6 fields | ~0.5               |
| **C_engine**                                                  | **≈ 4 + tapCount** |

The engine is essentially free; `O` is the whole cost. Worked figures at 48 kHz:

| Configuration                     | `O_total` | Tier   | Flops/sample | Mflop/s | ×12       |
| --------------------------------- | --------- | ------ | ------------ | ------- | --------- |
| Reverb, sparse (60 g/s × 80 ms)   | 4.8       | Eco    | 72           | 3.5     | 42        |
| Reverb, Eco cap                   | 12        | Eco    | 173          | 8.3     | **100**   |
| Reverb, default (350 g/s × 60 ms) | 21        | Studio | 509          | 24.4    | **293**   |
| Reverb, Studio cap                | 32        | Studio | 773          | 37.1    | 445       |
| Reverb, Max cap                   | 96        | Max    | 2 309        | 110.8   | 1 330     |
| Delay, 4 taps, Smear 0            | 4         | Eco    | 64           | 3.1     | 37        |
| Delay, 4 taps, Eco cap (2/tap)    | 8         | Eco    | 120          | 5.8     | 69        |
| Delay, 4 taps, Smear 50 %         | 32        | Studio | 780          | 37.4    | 449       |
| Delay, 8 taps, Studio cap         | 32        | Studio | 780          | 37.4    | 449       |
| Delay, 8 taps, uncapped 8×32      | 256       | —      | 6 156        | 295     | **3 545** |

The last row is the configuration ADR-0006 exists to refuse, and the numbers
agree with that ADR's own table to within the difference between "engine only"
and "whole plug-in".

**Tier caps, and what they cost the user:**

| Tier   | Max `O` per tap | Interpolation        | Twelve reverbs                  | Verdict         |
| ------ | --------------- | -------------------- | ------------------------------- | --------------- |
| Eco    | 12              | linear               | 100 Mflop/s = 1.3–5 % of a core | fits            |
| Studio | 32              | Hermite              | 445 Mflop/s = 5.6–22 %          | desktop         |
| Max    | 96              | Hermite + anti-alias | 1.33 Gflop/s = 17–67 %          | desktop, warned |

Every figure is an operation count against ADR-0006's assumed 2–8 Gflop/s scalar
phone core, which nobody here has verified. Under ADR-0005 these are **MODELLED**,
not PASS, and the benchmark harness converts them to a required per-core time
budget that a device later either meets or does not.

---

## 8. Verification

Executable claims. Ledger cells. Run through `renderOffline` at 48 kHz unless
stated.

| ID    | Measurement                                                                                                             | Method                                                                                        | Pass criterion                                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GE-01 | **Window moments.** Generated tables against closed forms.                                                              | Numerical integration of the shipped tables.                                                  | Hann `mean(w²)` = **0.375000 ± 1e−6**; `mean(w)` = 0.500000 ± 1e−6; Tukey(α=1) equals Hann **bit-for-bit**; Tukey(0.4) `mean(w²)` = 0.750 ± 1e−4. Gaussian values recorded, not graded (§9.3). |
| GE-02 | **Constant-overlap-add.** Hann, hop exactly `N/2`, unity pitch, no spray, no jitter, feedback bypassed.                 | DC 1.0 in; measure output.                                                                    | Output = **1.000 ± 0.001**, constant. Run first; every later failure is ambiguous until this passes.                                                                                           |
| GE-03 | **Block-rate buzz.** R = 300, L = 30 ms, jitter 0, DC input. Block sizes 64, 128, 256, 512.                             | FFT; the component at `fs/blockSize` relative to the grain-rate component.                    | ≤ **−80 dBFS** at every block size, **and** the measured level must not move by more than 3 dB across the four sizes. Movement with block size is the definitive signature.                    |
| GE-04 | **Continuity versus overlap.** Sweep `O` 0.25 → 32, white noise in.                                                     | Longest inter-grain gap; RMS modulation depth of the output envelope.                         | At `O ≥ 4`: no gap exceeds **4.0 ms**; envelope modulation ≤ **1.5 dB RMS ± 0.5**.                                                                                                             |
| GE-05 | **Pitch accuracy.** Single grain, s = +7, 1 kHz sine source, 200 ms grain.                                              | Peak frequency of the rendered grain.                                                         | **1498.31 Hz ± 2 cents.** Repeat at s = −12, +12, +19, +24.                                                                                                                                    |
| GE-06 | **Decay independent of density.** Engine inside a reference unity loop with fixed gain; sweep density 20 → 1500 g/s.    | RT60 by backward integration at each point.                                                   | RT60 varies by ≤ **5 %** across the sweep. This is the direct test that (3) is inside the loop; failure here is the runaway-feedback bug.                                                      |
| GE-07 | **Smear-zero null.** Smear 0, one tap at 500 ms, unity pitch, no feedback.                                              | Null against a reference plain cubic-Hermite delay at the same time; 60 s pink noise + drums. | Residual ≤ **−140 dBFS**. No tolerance.                                                                                                                                                        |
| GE-08 | **Grain accounting.** 60 s at each of density {10, 100, 350, 1000, 2000} g/s; and per-tap at Smear {25, 50, 75, 100} %. | Instrument the scheduler and pool.                                                            | `spawned/60` within **±1 %** of the set rate; `rendered == spawned`; `dropped == 0` **exactly**.                                                                                               |
| GE-09 | **Drop path works.** Pool forced to 16 slots at `O = 96`.                                                               | Same instrumentation.                                                                         | `dropped > 0`; **no allocation** (shares the guard with GE-15); output remains finite and free of NaN. A drop counter nobody has exercised proves nothing.                                     |
| GE-10 | **Per-tap fairness.** 8 taps, tap 0 at Smear 100 %, taps 1–7 at Smear 25 %, pool 256.                                   | Grains rendered per tap over 60 s.                                                            | Every tap achieves at least its reservation of **32 slots**; no tap renders zero grains in any 1 s window.                                                                                     |
| GE-11 | **Alias floor per tier.** Pitch set spanning −12 … +19, 10 kHz sine in.                                                 | FFT; components not at `10 000·2^(s/12)`.                                                     | Eco (linear): recorded, not graded — this row publishes the untiered figure. Studio: ≤ **−60 dBFS**. Max: ≤ **−70 dBFS**.                                                                      |
| GE-12 | **Block-size invariance.** 10 s of programme, same seed, block sizes 16, 17, 64, 128, 1024.                             | `peakDifference` against the 128 render.                                                      | ≤ **6e−8** (half a Float32 step).                                                                                                                                                              |
| GE-13 | **Grain id stability.** 10 000 spawns and retirements with forced swap-removes; track every published `id`.             | Compare each grain's `id` across every frame it appears in.                                   | **Zero** id changes for a live grain. Mutation: key the view on slot index instead and this case must fail by name.                                                                            |
| GE-14 | **Determinism.** Two full renders of the same graph, same seed, separate processes.                                     | `peakDifference`.                                                                             | **Exactly 0.0f.** Then change only the seed and assert the difference is > −40 dBFS, so the test is not passing by accident on an engine that ignores randomness.                              |
| GE-15 | **Zero allocations in process.** `RtGuard` over the six cases of §6.2.                                                  | `guard.allocations()`.                                                                        | **0** in each. Mutation-tested.                                                                                                                                                                |
| GE-16 | **One allocation in prepare.** `RtGuard` across the unit's `prepare()` including `arenaBytes` + `GrainEngine::prepare`. | `guard.allocations()`.                                                                        | **Exactly 1.**                                                                                                                                                                                 |
| GE-17 | **Visualiser fidelity.** Capture a frame; simultaneously log every live grain's `readPos` from the render.              | Compare `positionSeconds` against the logged read positions.                                  | Every published grain's position matches the position the render used to **≤ 1 sample**; `live` equals the true live count exactly; `published == min(live, 64)`.                              |
| GE-18 | **Publish rate.** 60 s at block sizes 64 and 1024.                                                                      | Frames pushed per second.                                                                     | **60 ± 1** at both block sizes. A rate that changes with block size is counting blocks, not samples.                                                                                           |
| GE-19 | **Tier cap does not drop sounding grains.** Change Max → Eco mid-render with 96 grains live.                            | Per-grain lifetime log; output RMS across the transition.                                     | **Zero** grains retired before their window ended; output RMS changes by ≤ **1.0 dB** across the transition.                                                                                   |
| GE-20 | **CPU linear in overlap.** Profile at `O` = 4, 8, 16, 32, 64.                                                           | Per-block processing time.                                                                    | Linear fit **R² ≥ 0.98**; extracted slope within **±25 %** of `C_grain/fs`. A non-linear fit means allocation or cache behaviour is leaking into the audio thread.                             |
| GE-21 | **Reverse symmetry.** A reversed grain over a time-symmetric source with a symmetric window.                            | Null against the forward grain.                                                               | Residual ≤ **−120 dBFS**. Catches the off-by-one at the span end, which is otherwise inaudible until it clicks once per grain at high density.                                                 |

---

## 9. Open questions

1. **Whether the mean read offset predicts RT60, or the median, or the harmonic
   mean.** `fx-02` §2.2 derives `fb = 10^(−3τ̄/RT60)` by analogy with the comb
   case and marks it as inference; §11.2 says the right statistic is unknown. The
   engine exposes the offset distribution and the reverb calibrates against
   measurement. That calibration is the reverb's, not the engine's, and this
   library must not grow a `setDecay`.
2. **The normalised echo-density measure named in `fx-02` V7 could not be reached
   in its original form**, so its exact definition is unavailable and the
   0.9-in-80 ms target is engineering judgement. GE has no echo-density row for
   that reason; the reverb must add one once the definition is in hand.
3. **The Gaussian `mean(w²) ≈ 0.266` is a numerical estimate**, computed rather
   than sourced. GE-01 records it rather than grading it until it is verified
   against an independent integration.
4. **Whether 64 published grains is enough at `O = 200`.** At the Max tier the
   visualiser shows under a third of the cloud. Showing a deterministic oldest-64
   is defensible and honest, but whether it _reads_ as the cloud is a design
   question this document cannot answer and a device it cannot run on.
5. **Whether one scheduler per tap is right for the delay.** The alternative is
   one shared scheduler with tap tags, which would couple the taps' onset
   statistics. Per-tap was chosen because Smear sets grains-per-tap and taps have
   independent lengths; the cost is `tapCount` counters and the risk is the
   starvation §5.6 reserves against. GE-10 tests the reservation, not the choice.
6. **Whether the pre-read anti-alias pole belongs to the grain or to the
   source.** It is per grain here because per-grain pitch differs, at a cost of
   two floats and two flops per grain. Running one filter on the source would be
   cheaper and wrong for mixed pitch sets, and would be right for the delay,
   where a tap's pitch is fixed. The engine currently pays the general cost in
   both units.
7. **Real phone throughput.** Every figure in §7 is an operation count against an
   assumed 2–8 Gflop/s scalar core that nobody here has verified, and ADR-0006
   says so in its own consequences. The tier caps rest on that assumption and are
   MODELLED under ADR-0005.
8. **Whether the delay's 8-tap × 32-grain configuration should exist at all.**
   It is specified because the control ranges permit it and capped because it
   costs 3.5 Gflop/s for twelve instances. If product decides nobody needs it,
   the cap becomes a hard limit, `poolSlots` drops from 256 to 128, and (5)'s
   headroom argument has to be redone.
