# Design — the nonlinear stage library

**Scope:** a design. Every signature below is a declaration, and what exists is
recorded in `docs/UNIT_LEDGER.md`, which `npm run ledger-guard` checks against
named tests. A status sentence here would be a second copy of that, checked by
nobody.

**Home:** `motionwave/core/dsp/nonlinear/`
**Namespace:** `mw::dsp::nl`
**Consumers:** Program EQ, Optical Leveller, FET Limiter, Variable-Mu Limiter,
Console EQ — the five units of the Vintage Collection (Phase 6).
**Sources:** `docs/reference/dyn-01-program-eq.md` … `dyn-05-console-eq.md`.
No reference manufacturer, product or component model number appears here; the
reference sheets hold those and they stay there (`LEGAL_NOTES.md` §2).

---

## 1. Why one library, and what belongs in it

All five units are the same shape: a **linear network** whose curve the user
controls, wrapped in **nonlinear elements the user does not control** — an input
transformer, one or two gain stages, an output transformer, and in two units a
control element that is itself the distorting element. Four of the five sheets
say in their own words that the colour survives EQ bypass, and three of them say
the harmonic signature is the thing that distinguishes the unit from its
neighbours.

If each unit builds its own saturator, five slightly different transformer models
appear and the cross-family check in `dyn-05` §10 test 19 — which asserts that
two nominally equivalent settings on two devices measurably differ — stops
testing the devices and starts testing whose copy-paste was newer. Worse, the
harmonic-order assertions are the _only_ tests that separate the models:
`dyn-01` test 10 wants second above third by 6 dB, `dyn-04` test 9 wants third
above second by 6 dB, and `dyn-05` test 10 and test 18 want opposite answers on
the two console lineages. Those are five claims about one library, not five
libraries.

So this library owns exactly four things:

1. **The saturation curve family** — five stage types with a shared small-signal
   expansion, so a harmonic ratio is a design parameter rather than an outcome.
2. **Magnetic core behaviour** — hysteresis and saturation of a flux, used both
   for transformers and, in one unit only, for EQ inductors.
3. **Control-path nonlinearity** — the distortion a feedback detector applies to
   its own control voltage, which changes the shape of a compression curve
   without adding a harmonic to the audio.
4. **The oversampling wrapper**, with a declared, exact, integer latency.

It owns **nothing** about detectors, time constants, ratios, knees, filters or
metering. Those are per-unit and they are where the five units actually differ.
The rule that keeps the boundary honest: _the library owns the element, the unit
owns the loop._ A ratio that emerges from a feedback loop cannot be a library
parameter, because `dyn-02` §3.3 and `dyn-04` §5 both say plainly that a ratio
computed from a static curve is right at one gain-reduction depth and wrong at
every other.

### 1.1 The union, derived from the five sheets

| Element the sheet requires                                    | dyn-01            | dyn-02    | dyn-03                | dyn-04               | dyn-05                              |
| ------------------------------------------------------------- | ----------------- | --------- | --------------------- | -------------------- | ----------------------------------- |
| Single-ended asymmetric stage, 2nd-harmonic led               | yes               | yes       | —                     | —                    | British lineage                     |
| Balanced stage, even-order cancelled, 3rd-harmonic led        | unresolved        | —         | later output revision | **the gain element** | —                                   |
| Balance disturbed at depth returns 2nd harmonic               | —                 | —         | —                     | yes, test 11         | —                                   |
| Bias-controlled variable-gain cell (gain element = amplifier) | —                 | —         | —                     | yes                  | —                                   |
| Voltage-variable-resistor divider, asymmetric, trimmable null | —                 | —         | **the signature**     | —                    | —                                   |
| Soft symmetric feedback block, 3rd-harmonic led               | —                 | —         | preamp                | —                    | American op-amp modules             |
| Photoresistive attenuator, mild static curvature              | —                 | yes       | —                     | —                    | —                                   |
| Magnetic core: hysteresis at low level, saturation at high    | in + out          | in + out  | in + out              | in + out             | both lineages                       |
| Magnetic core **inside** the EQ network                       | second order      | —         | —                     | —                    | British only; American **must not** |
| Static nonlinearity on a control signal inside a loop         | —                 | yes       | —                     | yes                  | —                                   |
| Oversampling with a measured alias floor                      | test 13, −70 dBFS | —         | test 16, −60 dBFS     | —                    | 48 and 96 kHz                       |
| Unit-to-unit variance exposed as one control                  | drift unknown     | cell wear | two trims             | valve condition      | —                                   |

Five stage types, one core model, one control shaper, one wrapper. That is the
whole library.

### 1.2 One level alignment for the whole family

Every published figure in the five sheets is in dBm or dBu into 600 Ω, and
0 dBm into 600 Ω is 0.775 V, which is 0 dBu — so the two units coincide for
these devices and one constant converts all of them.

```
    0 dBFS  =  +22 dBu          equivalently  +4 dBu = −18 dBFS
```

This is stated once, here, and every unit reads it from
`mw::dsp::nl::kFullScaleDbu`. Two units computing their own alignment is exactly
the failure ADR-0004 describes for parameter units, one layer down: the Program
EQ's "0.15 % THD at +10 dBm" and the FET Limiter's "threshold −32 dBm" have to
mean the same voltage or the two models cannot be compared.

A consequence worth stating rather than discovering: the Variable-Mu Limiter's
published +27 dBm clipping point is **+5 dBFS**. The model does not clip there
and must not; 32-bit float carries it and the user's converter is the limit. A
model that hard-limited at 0 dBFS would fail that unit's own clipping-point test
by clipping 5 dB early.

---

## 2. Files

ADR-0003 caps a file at ~400 lines. The split is by element, because that is the
seam that already exists.

| File                         | Contents                                                               | Budget |
| ---------------------------- | ---------------------------------------------------------------------- | ------ |
| `nonlinear/curve.h`          | the rational curve `R`, its derivatives, the small-signal coefficients | 140    |
| `nonlinear/triode_stage.h`   | `TriodeStage`, `PushPullStage`                                         | 180    |
| `nonlinear/variable_gain.h`  | `RemoteCutoffCell`, `PhotoresistiveCell`                               | 170    |
| `nonlinear/fet_divider.h`    | `FetDivider`                                                           | 150    |
| `nonlinear/feedback_block.h` | `FeedbackBlockStage`                                                   | 90     |
| `nonlinear/magnetic_core.h`  | `MagneticCore`, the play operator                                      | 180    |
| `nonlinear/control_shaper.h` | `ControlShaper`                                                        | 70     |
| `nonlinear/oversampler.h`    | `Oversampler<kFactor>`, halfband tables                                | 300    |
| `nonlinear/specs.h`          | `ParamSpec` writers and block binding (ADR-0004)                       | 200    |

---

## 3. Public interface

C++17, declarations only. Compiled under the core's
`-Wall -Wextra -Wpedantic -Werror -Wshadow -Wconversion -Wsign-conversion
-Wold-style-cast -Wdouble-promotion`, so every conversion below is explicit and
every literal is typed.

### 3.1 The curve, and the coefficients everything else is calibrated against

```cpp
namespace mw::dsp::nl {

/// The one shaping function in the library.
///
/// It is defined as this rational form, not as an approximation to tanh. That
/// distinction is load-bearing: the harmonic ratios every verification test in
/// §7 asserts are derived from *this* expansion, and swapping in a more
/// accurate tanh later would move them by about 1 dB and fail four tests for a
/// reason nobody would find.
///
///     R(u) = u·(27 + u²) / (27 + 9u²),   u clamped to [-3, +3]
///
/// The clamp is what makes it bounded; without it the rational grows as u/9 and
/// a limiter built on it would have no limit.
float curve(float u) noexcept;

/// First three derivatives of `curve` at an operating point, in closed form.
struct CurveDerivatives {
  float first = 1.0f;
  float second = 0.0f;
  float third = 0.0f;
};
CurveDerivatives curveDerivatives(float u0) noexcept;

/// Normalised second- and third-order coefficients of the expansion of `curve`
/// about `u0`, i.e. y/y' = v + c2·v² + c3·v³ + O(v⁴).
///
/// A face that draws a stage's harmonic profile calls this, and so does the
/// calibration test. There is no second formula anywhere.
struct Curvature {
  float c2 = 0.0f;
  float c3 = 0.0f;
};
Curvature curvature(float u0) noexcept;

/// Full-scale reference, §1.2. Every dBm/dBu figure in the reference sheets is
/// converted through this and nowhere else.
inline constexpr float kFullScaleDbu = 22.0f;
float dbuToLinear(float dbu) noexcept;
float linearToDbu(float amplitude) noexcept;

}  // namespace mw::dsp::nl
```

### 3.2 The five stages

Every stage has the same four-call shape: `prepare` off the audio thread,
`setConfig` at block rate, `process` per sample, `reset` on a transport jump.
None is virtual. A virtual call per sample at 8× oversampling is eight indirect
calls per host sample per channel, and the compiler cannot inline the shaper
into the oversampler's inner loop through one.

```cpp
namespace mw::dsp::nl {

/// Scratch a stage needs, in floats, so a unit can size one arena for
/// everything it owns. See §5.1.
struct StageScratch {
  float* data = nullptr;
  std::size_t floats = 0;
};

// ---------------------------------------------------------- single-ended

/// One asymmetric gain stage. The Program EQ's make-up amplifier, the Optical
/// Leveller's voltage amplifier, and the British console lineage's discrete
/// Class A stages are all this with different drive and bias.
class TriodeStage {
 public:
  struct Config {
    /// Peak input amplitude mapped onto the curve's argument. Sets how far up
    /// the curve the signal runs and therefore the third-harmonic level.
    float drive = 0.27f;
    /// Operating-point offset in the same units. §4.1 derives the rule
    /// `bias >= drive·peak/3` for the second harmonic to lead the third by
    /// 6 dB, which is what `dyn-01` test 10 asserts.
    float bias = 0.046f;
    /// Corner of the DC-restoration high-pass, in hertz. A biased curve has a
    /// non-zero mean and without this the offset walks into the next stage and
    /// biases *it*, which is how a chain of three stages ends up asymmetric in
    /// a way nobody designed.
    float restoreHz = 5.0f;
  };

  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;
  float process(float x) noexcept;

  /// The coefficients this instance is currently running at, for a face.
  Curvature curvature() const noexcept;
};

// -------------------------------------------------------------- balanced

/// Two half-stages driven anti-phase and subtracted. Even order cancels
/// exactly at `imbalance == 0`, which is what makes this the third-harmonic-led
/// stage `dyn-04` test 9 and `dyn-03`'s later output revision both need.
class PushPullStage {
 public:
  struct Config {
    float drive = 0.27f;
    /// Common-mode operating point. Driven by the unit's control voltage in
    /// the Variable-Mu Limiter, because there the bias *is* the gain control.
    float bias = 0.0f;
    /// Fractional gain difference between the two halves. Zero cancels even
    /// order to the arithmetic floor; non-zero returns it in proportion.
    float imbalance = 0.0f;
    /// How much additional imbalance each unit of |bias| introduces. This is
    /// the mechanism behind `dyn-04` test 11 — the second harmonic reappearing
    /// at deep gain reduction — and it is a mechanism rather than a fudge:
    /// pushing a balanced pair toward cutoff does not push both halves equally.
    float imbalancePerBias = 0.35f;
    float restoreHz = 5.0f;
  };

  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;
  float process(float x) noexcept;
  Curvature curvature() const noexcept;
};

// ------------------------------------------------------- variable gain

/// A remote-cutoff gain cell: the thing being distorted and the thing doing the
/// compressing are the same component. The Variable-Mu Limiter's whole
/// character follows from that and this is the type that expresses it.
///
/// The cell owns no detector. It takes a control voltage and returns audio; the
/// unit closes the loop. That split is why the ratio can rise with gain
/// reduction without a ratio parameter existing anywhere.
class RemoteCutoffCell {
 public:
  struct Config {
    /// Cutoff voltage. `control` runs 0 (no reduction) toward this.
    float cutoffVolts = 1.0f;
    /// Exponent of the transconductance law, §4.3. 2.5 is our starting value
    /// and it is the number `dyn-04` test 6 grades.
    float lawExponent = 2.5f;
    PushPullStage::Config stage{};
  };

  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;

  /// `control` in volts, 0..cutoffVolts. Read once per sample; the unit is
  /// responsible for having smoothed it.
  float process(float x, float control) noexcept;

  /// Gain in decibels at a control voltage, from the same law `process` uses.
  /// The gain-reduction meter reads this, so a meter cannot disagree with the
  /// audio (CLAUDE.md's picture-from-the-same-evaluation rule).
  float gainDb(float control) const noexcept;
};

/// The Optical Leveller's attenuator element. Its dynamics — the two release
/// branches and the exposure-history state — belong to that unit; what belongs
/// here is only the cell's static curvature, which `dyn-02` §6.2 marks as a
/// mild second-order effect.
class PhotoresistiveCell {
 public:
  struct Config {
    float darkResistance = 1.0f;   ///< normalised; the real value is unknown
    float lightResistance = 0.002f;
    /// Signal dependence of the cell's own resistance. Zero makes it a clean
    /// attenuator, which is the correct default until a data sheet arrives.
    float signalDependence = 0.0f;
  };
  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;
  float process(float x, float conductance) noexcept;
  float gainDb(float conductance) const noexcept;
};

// ---------------------------------------------------------- FET divider

/// A voltage-variable resistor in the shunt leg of a divider, with the drain
/// voltage fed partly back to the gate.
///
/// The two hardware trims map onto two parameters with physical meaning rather
/// than being modelled as a mystery: `bias` is where the element sits at the
/// edge of conduction, and `feedbackFraction` is the fraction of the drain
/// swing returned to the gate. At exactly 0.5 the leading even-order term
/// cancels — which is why the hardware's distortion trim nulls at one operating
/// point and only one.
class FetDivider {
 public:
  struct Config {
    float seriesResistance = 1.0f;
    float onResistance = 0.02f;
    float pinchOffVolts = 1.0f;
    /// The bias trim. Calibrated so the element sits 1 dB into attenuation with
    /// no control signal, matching the documented hardware procedure.
    float bias = 0.0f;
    /// The distortion trim, 0..0.5. Defaults to a correctly calibrated unit.
    float feedbackFraction = 0.5f;
  };

  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;
  float process(float x, float control) noexcept;
  float gainDb(float control) const noexcept;
};

// ------------------------------------------------------- feedback block

/// A discrete gain block with global feedback: low distortion at nominal level,
/// rising steeply near the rails, symmetric, third-harmonic led. The FET
/// Limiter's preamp and the American console lineage's op-amp modules.
class FeedbackBlockStage {
 public:
  struct Config {
    float drive = 0.15f;
    float railVolts = 1.0f;
    float restoreHz = 5.0f;
  };
  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;
  float process(float x) noexcept;
};

}  // namespace mw::dsp::nl
```

### 3.3 Magnetic core

```cpp
namespace mw::dsp::nl {

/// Hysteresis and saturation of a magnetic core.
///
/// Used for transformers and, in the British console lineage only, for the EQ
/// section's inductors. It is one type used twice rather than two types,
/// because the physics is the same and because `dyn-05` test 17 asserts that
/// the American lineage has **no** EQ-section saturation — a rule that is only
/// checkable if the placement is an explicit decision instead of something
/// baked into a "console" block.
class MagneticCore {
 public:
  struct Config {
    /// Low-frequency pole of the magnetising inductance, hertz. The flux is the
    /// integral of the voltage, so this is where the 1/f rise in distortion
    /// stops. Below it the core stops accumulating and the model stops getting
    /// worse.
    float poleHz = 12.0f;
    /// Flux at which the anhysteretic curve is one third compressed. Calibrated
    /// per unit against §7's NL-06 band.
    float saturationFlux = 1.0f;
    /// Coercivity, in the same flux units. This is the term that produces
    /// distortion at low level and never goes away; setting it to zero turns
    /// the model into pure saturation and NL-07 fails by name.
    float coercivity = 0.004f;
    /// Fraction of the primary's own distortion cancelled by a feedback
    /// winding. The FET Limiter's output transformer has one and must therefore
    /// distort *less* than its input transformer, not more.
    float feedbackCancellation = 0.0f;
  };

  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  void reset() noexcept;
  float process(float x) noexcept;

  /// One full magnetisation loop at a stated amplitude and frequency, written
  /// into caller storage, for a face that draws the B–H loop. Runs the same
  /// `process` the audio runs on a scratch copy — a loop drawn from a formula
  /// would be a second opinion and CLAUDE.md forbids one.
  static void sampleLoop(const Config& config, double sampleRate, float amplitude,
                         float frequencyHz, float* out, int count) noexcept;
};

}  // namespace mw::dsp::nl
```

### 3.4 Control shaper

```cpp
namespace mw::dsp::nl {

/// A static nonlinearity applied to a *control* signal inside a detector loop.
///
/// Declared as its own type rather than reusing `TriodeStage` so that nobody
/// puts it in the audio path by accident. Both sheets that need it say the same
/// thing: this element does not add harmonics to the audio, it changes the
/// shape of the gain-reduction curve, and the loop partially linearises it.
/// Treating it as an audio saturator would put its distortion in the spectrum
/// where it does not belong.
class ControlShaper {
 public:
  struct Config {
    float drive = 1.0f;
    float bias = 0.0f;
    /// Loop-gain estimate used to report how much of the shaping the loop
    /// removes. Diagnostic only; it does not affect the sample path.
    float loopGain = 10.0f;
  };
  void prepare(double sampleRate, const Config& config) noexcept;
  void setConfig(const Config& config) noexcept;
  float process(float control) noexcept;
};

}  // namespace mw::dsp::nl
```

### 3.5 Oversampler

```cpp
namespace mw::dsp::nl {

/// Halfband cascade oversampling wrapper.
///
/// Wraps a *nonlinear block*, never a whole unit. Oversampling a linear filter
/// costs CPU for nothing and moves its coefficients, and two of the five units
/// are graded on frequency-response flatness to ±0.8 dB.
template <int kFactor>
class Oversampler {
 public:
  static_assert(kFactor == 1 || kFactor == 2 || kFactor == 4 || kFactor == 8,
                "Only power-of-two factors up to 8 have a declared, integer latency.");

  /// Floats of scratch this configuration needs. Called before `prepare` so a
  /// unit can size one arena for everything it owns.
  static std::size_t scratchFloats(int maxFrames) noexcept;

  /// Off the audio thread. Returns false when the configuration cannot declare
  /// an exact integer latency, which `prepare` refuses rather than rounding —
  /// see §4.6. A wrapper that is half a sample out combs against the dry path
  /// at 10 µs, and delay compensation cannot fix a number that was never true.
  bool prepare(double sampleRate, int maxFrames, StageScratch scratch) noexcept;

  void reset() noexcept;

  /// Exact, and the number the node reports to the graph's compensation.
  int latencySamples() const noexcept;

  /// `shaper(float) -> float` is a callable, taken by forwarding reference so
  /// it inlines. At kFactor == 1 this is the identity path and the samples are
  /// bit-identical to calling the shaper directly, which NL-11 asserts.
  template <typename Shaper>
  void process(const float* in, float* out, int frames, Shaper&& shaper) noexcept;
};

}  // namespace mw::dsp::nl
```

### 3.6 Parameters (ADR-0004)

```cpp
namespace mw::dsp::nl::param {

/// Offsets within a stage's parameter block.
///
/// A unit adds its own base to these when it writes its **static** ParamSpec
/// table. The library never builds a table at run time: `ParamSet` requires
/// specs that outlive it, and building one per instance would be an allocation
/// per instance of every plugin — exactly what ADR-0004 sized the framework to
/// avoid.
inline constexpr ParamId kDrive = 0;
inline constexpr ParamId kBias = 1;
inline constexpr ParamId kCoreDrive = 2;
inline constexpr ParamId kUnitVariance = 3;
inline constexpr ParamId kOversampling = 4;
inline constexpr std::size_t kStageParamCount = 5;

/// Fills caller-owned static storage with this library's specs, renumbered from
/// `base`. Called once, off the audio thread, from a unit's static initialiser.
void writeStageSpecs(ParamId base, ParamSpec* out) noexcept;

/// Reads the block's settled values into a stage config. Called from the unit's
/// `beginBlock`, after `ParamSet::beginBlock` and before any sample is touched.
TriodeStage::Config triodeConfigFrom(const ParamSet& params, std::size_t firstIndex) noexcept;
MagneticCore::Config coreConfigFrom(const ParamSet& params, std::size_t firstIndex) noexcept;

}  // namespace mw::dsp::nl::param
```

**Unit variance is one control, not two trims.** Three of the five sheets ask
for a variance parameter and one of them names two engineering trims. Exposing
two trims makes a user calibrate a plug-in; exposing one scalar that moves every
per-instance deviation together is both easier to use and more faithful, because
on the hardware the deviations are correlated — a drifted unit is drifted in
every respect at once. The default is a correctly calibrated unit.

---

## 4. DSP formulation

### 4.1 The curve and its harmonics

Write the shaping function as

```
    R(u) = u·(27 + u²) / (27 + 9u²),        u ∈ [−3, +3]
```

Expanding about the origin,

```
    R(u) = u − (8/27)·u³ + O(u⁵)
```

so with `u = A·sin θ` the third harmonic of a symmetric stage is

```
    H3/H1 = (8/27)·A²/4 = 0.0741·A²                                        (1)
```

Note the number: **0.0741, not tanh's 0.0833**. The 11 % difference is 1 dB and
every threshold in §7 is written against (1).

Introduce an operating-point offset `u₀` and expand about it. With
`R'(u) = 1 − (8/9)u²`, `R''(u) = −(16/9)u`, `R'''(u) = −16/9`, the normalised
coefficients of `y/R'(u₀) = v + c₂v² + c₃v³ + …` are

```
    c₂ = R''(u₀) / (2·R'(u₀))  ≈ −(8/9)·u₀
    c₃ = R'''(u₀) / (6·R'(u₀)) ≈ −8/27
```

and for `v = A·sin θ`,

```
    H2/H1 = |c₂|·A/2 = 0.4444·u₀·A                                         (2)
    H3/H1 = |c₃|·A²/4 = 0.0741·A²                                          (3)
```

Two consequences, both of which the sheets ask for by name:

- **The second harmonic falls off one power of `A` more slowly than the third.**
  So a single-ended stage is second-dominant at moderate drive with the third
  emerging as level rises, which is what every listening description of the
  Program EQ and the Optical Leveller reports and what a symmetric shaper cannot
  do at any setting.
- Setting (2) ≥ 2·(3) gives the design rule

  ```
      u₀  ≥  A / 3                                                         (4)
  ```

  **The operating point must be at least a third of the peak drive for the
  second harmonic to lead the third by 6 dB**, and the two are equal at
  `A = 3u₀`. That single inequality is the calibration for three of the five
  units and it is what NL-01 measures.

Worked anchor, for the Program EQ's make-up amplifier at its published operating
point of +10 dBm (= −12 dBFS = 0.2512 peak, §1.2), targeting the published
0.15 % THD with the second harmonic 12 dB above the third:

```
    H3/H1 = 3.5e−4  →  A = sqrt(3.5e−4 / 0.0741) = 0.0687
    H2/H1 = 1.4e−3  →  u₀ = 1.4e−3 / (0.4444 · 0.0687) = 0.0459
    THD    = sqrt(1.4e−3² + 3.5e−4²) = 1.44e−3 = 0.144 %
    drive  = A / 0.2512 = 0.2735
```

`u₀ = 0.0459` against `A/3 = 0.0229` satisfies (4) with a factor of two in hand.
These four numbers are the `TriodeStage::Config` defaults in §3.2 and NL-01
grades them.

### 4.2 The balanced stage

Two half-stages driven anti-phase, with a fractional gain difference `β`:

```
    y = ½·[ (1+β)·R(g(x + b)) − (1−β)·R(g(−x + b)) ]                        (5)
```

At `β = 0` every even-order term cancels identically — not approximately, and
not to a tolerance, but term by term, because (5) reduces to an odd function of
`x`. That is why NL-03 can assert the second harmonic below −80 dBc rather than
below some measured floor: anything above the arithmetic noise means the two
halves are not being evaluated on the same curve.

At `β ≠ 0` the even order returns in proportion to `β`, and the effective second
harmonic is

```
    H2/H1 ≈ β · (1 + 0.4444·u₀·A) / (1 − 0.0741·A²) ≈ β                     (6)
```

to first order — i.e. **the imbalance is, to a good approximation, the
second-harmonic ratio directly**. That makes `imbalance` a legible parameter
rather than a fudge factor, and it makes the Variable-Mu Limiter's
"second harmonic returns at depth" test a statement about `imbalancePerBias`:

```
    β(b) = β₀ + β₁·|b|                                                      (7)
```

with `β₁ = 0.35` chosen so that `dyn-04` test 11's ≥ 6 dB rise in the
second-to-third ratio between 3 dB and 20 dB of gain reduction is met with
margin. It is our number; no published measurement of the reference unit's
push-pull balance exists.

### 4.3 The remote-cutoff cell

Transconductance falls with bias toward a cutoff voltage `Vc`:

```
    gm(v) = gm₀ · (1 − v/Vc)^p ,     v ∈ [0, Vc),   p = 2.5                (8)
    gain_dB(v) = 20·p·log₁₀(1 − v/Vc)                                       (9)
```

Differentiating (9),

```
    d(gain_dB)/dv = −20·p / ( ln10 · (Vc − v) )                            (10)
```

**The magnitude of (10) grows as `v` approaches cutoff**, so each additional volt
of control buys more decibels of gain reduction than the last. That is the whole
of the Variable-Mu Limiter's "ratio rises with gain reduction", and it falls out
of the element rather than being imposed by a curve: at 3 dB of reduction
`v/Vc = 0.056` and the slope is 21.7 dB/V; at 20 dB, `v/Vc = 0.309` and the
slope is 31.4 dB/V — a factor of 1.45 in the element alone, which the feedback
loop then amplifies into the factor of 2 that `dyn-04` test 6 requires.

The audio rides on the same electrode, so the cell's distortion is the curvature
of (8) sampled by the signal:

```
    y = gm(v + κ·x_grid) · x / gm₀                                          (11)
```

with `κ` the fraction of the audio swing that appears at the control electrode.
Because the second derivative of (8) grows as `(1 − v/Vc)^(p−2)`, distortion
rises far faster than gain falls. That is `dyn-04` test 10 — THD at 20 dB of
reduction at least 10 dB above THD at 3 dB — and it is a consequence, not a
parameter.

### 4.4 The FET divider

Channel resistance in the triode region, with a fraction `λ` of the drain
voltage returned to the gate:

```
    r(V) = r_on / (1 − V/Vp),      V = V_control + λ·y                     (12)
    y    = x · Rs / (Rs + r(V))                                            (13)
```

(12) and (13) are implicit in `y`. One Newton step from the previous sample's
solution converges to below a Float32 step for the swings these units see, and
it costs one divide; the alternative — solving the quadratic — costs a square
root and buys nothing measurable.

Expanding (13) for small `λ`, the leading even-order term carries a factor
`(1 − 2λ)`. **At `λ = 0.5` it vanishes.** That is the physical meaning of the
hardware's distortion trim and it explains, without hand-waving, why the null
holds at one operating point only: the cancellation is exact for the quadratic
term of the ideal triode-region law, and neither the cubic term nor the drift of
`r_on` with the control voltage is touched by it.

Two testable consequences follow directly and both are in the sheet:

- Second harmonic exceeds third by ≥ 6 dB at 10 dB of gain reduction, because
  the residual asymmetry is second order while the divider's own compression is
  third.
- Harmonic content at 10 dB of reduction exceeds that at 2 dB by ≥ 8 dB, because
  `r` has moved further along a curve whose second derivative grows with `1/(1 −
V/Vp)³`.

### 4.5 Magnetic core

**The core model is a nonlinearity of the integrated signal, not of the signal.**
That one structural decision is what makes the distortion frequency-dependent
for free: for a sine of amplitude `V` at frequency `f`, flux amplitude is
`V/(2πf·N)`, so flux — and therefore distortion — rises as `1/f`. A waveshaper
applied to the voltage cannot do this at all, and `dyn-01` test 11 and `dyn-05`
test 10 both fail against one.

```
    Φ[n] = ρ·Φ[n−1] + (1 − ρ)·k·x[n],     ρ = exp(−2π·poleHz/fs)          (14)
    P[n] = max( min(P[n−1], Φ[n] + c), Φ[n] − c )        play operator     (15)
    B[n] = Φ_sat · R( (Φ[n] − α·P[n]) / Φ_sat )                            (16)
    y[n] = (1 − γ)·B[n] + γ·x[n]                                           (17)
```

(15) is a rate-independent backlash of half-width `c` — the standard hysteresis
primitive, two compares and two adds, no allocation, no table, no library. It is
what makes the model **not a waveshaper**: the output depends on the
magnetisation history, so an ascending and a descending traversal of the same
flux give different outputs, and the loop it traces has non-zero area at every
amplitude down to zero. That is the mechanism behind "distortion at low signal
levels that never goes away", and it is the half of the transformer's behaviour
that a saturation curve alone cannot produce.

(16) is odd-symmetric, so the core is third-harmonic dominant, which is what
every sheet says about every transformer in the five units.

(17) is the feedback-winding term: `γ` is the fraction of the core's own
distortion the winding cancels. The FET Limiter's output transformer has one, so
its `γ > 0` and it distorts **less** than that unit's input transformer. A model
that gave the output transformer more distortion because it works at a higher
level would be reasoning correctly from the wrong circuit.

**Calibration band.** The published 0.15 % figure for the Program EQ is almost
certainly a 1 kHz measurement — its conditions are not stated — and the sheet's
own test asserts only that 30 Hz is _worse_, without bounding it. So the
calibration target is stated as a band rather than a point:

```
    THD at 1 kHz, +10 dBm      ≤ 0.03 %      (core's own contribution)
    THD at 30 Hz,  +10 dBm     1.5 % ± 1.0 % (core's own contribution)
    THD at 30 Hz,  −60 dBFS    ≥ 0.02 %      (the hysteresis floor)
```

The only published anchor for the mechanism is a 2.9 % figure at 600 mV / 30 Hz
on an unrelated small-signal part, which characterises the mechanism and not the
part; 3 % is therefore the ceiling of the band and is recorded as such rather
than used as a target.

### 4.6 Oversampling, and why the latency is an integer

Each stage is a symmetric halfband FIR pair. For a halfband of length `L`
(necessarily `L = 4m + 3`, which is what makes every other tap zero), the group
delay is `(L−1)/2` samples at the stage's own upper rate. Interpolating with
`L_u` and decimating with `L_d` therefore costs

```
    round-trip delay = (L_u + L_d − 2) / 4   samples at the stage's input rate
```

and since `L_u + L_d − 2 = 4(m + n) + 4`, **that is always an integer**. Nesting
stages needs one more condition: an inner stage's delay, measured at its own
input rate, must be even for it to be an integer at the rate outside it. Both
conditions are checkable at `prepare` time, and `prepare` returns false rather
than rounding, because a half-sample error is 10 µs at 48 kHz and the graph's
delay compensation is only ever as correct as the number a node reports.

The shipped cascade:

| Factor | Stage lengths (up / down)         | Stage delay       | Total, samples @ host rate |
| ------ | --------------------------------- | ----------------- | -------------------------- |
| 1×     | —                                 | —                 | **0**                      |
| 2×     | 75 / 75 @ 2fs                     | 37 @ fs           | **37**                     |
| 4×     | 75 / 75 @ 2fs, then 35 / 39 @ 4fs | 37 @ fs, 18 @ 2fs | **46**                     |
| 8×     | + 19 / 31 @ 8fs                   | + 12 @ 4fs        | **49**                     |

Halfbands are self-complementary, so passband ripple and stopband ripple are the
same number: designing the first stage for −100 dB stopband gives 8.7e−5 dB of
passband ripple automatically. That matters because the Program EQ's flatness
test fails at ±0.8 dB and the wrapper must not spend any of that budget.

The first stage's transition band is 0.5 ± 0.043 of its own rate, so at a 48 kHz
host rate the passband ends at 19.9 kHz. Content between 19.9 and 24 kHz is
attenuated. That is inaudible and standard, but it is a real, stated cost and it
is the reason the 1× path must be an exact bypass rather than a wrapper run at
unity: the bypass null test asserts −120 dBFS and a 0.0001 dB ripple would not
reach it, but a truncated top octave would not either.

---

## 5. Real-time safety

### 5.1 What `prepare()` allocates — once, into one arena

Every type in this library takes a `StageScratch` and reports
`scratchFloats(...)` before `prepare` is called, so **a unit performs exactly one
allocation for its entire nonlinear chain.** That is not tidiness: a unit that
allocates once can be _counted_, and a unit that allocates eleven times can only
be reviewed. The RT test in §7 asserts `guard.allocations() == 1` across a whole
`prepare()`, and any future stage that quietly acquires a `std::vector` fails it
by name.

| Owner              | Storage                                                | Floats at 48 kHz, maxFrames 1024 |
| ------------------ | ------------------------------------------------------ | -------------------------------- |
| `Oversampler<2>`   | two halfband delay lines (75 taps), one 2× work buffer | 150 + 2048 = 2198                |
| `Oversampler<4>`   | + two lines (35, 39 taps), one 4× work buffer          | + 74 + 4096 = 6368               |
| `Oversampler<8>`   | + two lines (19, 31 taps), one 8× work buffer          | + 50 + 8192 = 14 610             |
| `TriodeStage`      | one DC-restore state                                   | 1                                |
| `PushPullStage`    | two half-stage states + one restore state              | 3                                |
| `RemoteCutoffCell` | contained `PushPullStage` + one control state          | 4                                |
| `FetDivider`       | previous solution, for the Newton start                | 1                                |
| `MagneticCore`     | flux state, play state                                 | 2                                |
| `ControlShaper`    | none                                                   | 0                                |

Halfband coefficient tables are `constexpr` and live in `.rodata`. They are
**generated at build time** by `motionwave/tools/gen_halfband_tables` rather than
computed on first use, for two reasons that both bite later: a function-local
static initialised on first `prepare()` compiles to a guarded, _locking_
initialisation, and the audio thread may not take a lock; and a table computed at
run time can differ in the last bit between targets, which would make the
golden-render regression fail on a phone for a reason that is not a bug.

### 5.2 The proof that `process()` allocates nothing

Structural, then measured.

**Structural.** No type in §3 holds an owning container. Every buffer is a raw
pointer into the arena, fixed at `prepare`. There is no virtual call on the
sample path, so there is no indirection through which an allocating override
could enter. `Oversampler::process` takes its shaper by forwarding reference and
never type-erases it — a `std::function` there would allocate on construction
and is the one thing this interface is shaped to prevent.

**Measured**, by `motionwave/core/test/rt_guard.h`, which arms an `operator new`
hook around the call. Four cases, all of which must report zero:

1. 100 blocks of 1024 frames through a full chain (core → oversampled triode →
   core) with static parameters.
2. The same, with every parameter swept across its full range, including the
   oversampling **choice** parameter, which is the interesting case: changing
   the factor must select a pre-prepared cascade rather than build one.
3. Block sizes 16, 17, 64, 128, 1024 in the same render, so a partial block
   cannot take a different path.
4. `reset()` called from the audio thread mid-render, which a transport jump
   does.

Case 2 is the one that constrains the design: **all three cascades are prepared,
and the oversampling parameter selects among them.** Preparing only the current
factor would mean a rate change on the audio thread, and there is no way to do
that without allocating. The cost is the 14 610 floats in the table above —
58 KB per instance, 700 KB for twelve — which is cheap against the alternative
of an unprovable claim.

The guard is itself mutation-tested (`PROGRESS.md` records the existing case): a
deliberate allocation inside `process` must make the test fail by name, or the
guard proves nothing.

### 5.3 Denormals

The core's test binaries are deliberately compiled without `-ffast-math`, so
flush-to-zero is not in force where the numbers are graded. Two recursive states
in this library decay toward zero during silence and would spend hundreds of
cycles per sample there: the DC-restore high-pass in every stage, and the flux
integrator in `MagneticCore`.

**Every recursive state in this library is flushed to zero when its magnitude
falls below 1e-20f** — one compare per state per sample, at most four per sample
per channel for a full chain. NL-14 measures it: after 60 s of silence following
a full-scale tail, the per-block wall time must not exceed the loudest block's by
more than 10 %.

---

## 6. CPU budget per tier

ADR-0006's tiers are **Eco / Studio / Max**. Eco is enforced on mobile, not
suggested. The rule that makes a tier honest applies here in its own form: **a
tier changes the oversampling factor, never the model.** Dropping the core model
or the asymmetry at Eco would make a plug-in sound different on a phone, which
ADR-0006 §3 names as the single worst outcome available.

Per-sample, per-channel flop counts. A divide is counted as 4, a multiply-add as
2, consistent with the reference sheets' arithmetic.

| Primitive                                              | Flops/sample |
| ------------------------------------------------------ | ------------ |
| `curve` (clamp, 3 mults, 2 adds, 1 divide)             | 10           |
| `TriodeStage` (curve + bias + restore)                 | 16           |
| `PushPullStage` (two curves + imbalance + restore)     | 30           |
| `RemoteCutoffCell` (push-pull + law (8) + control)     | 46           |
| `FetDivider` (one Newton step, two divides)            | 22           |
| `FeedbackBlockStage`                                   | 14           |
| `MagneticCore` (integrator 3, play 4, curve 10, mix 3) | 20           |
| `ControlShaper`                                        | 12           |
| `Oversampler<2>` round trip                            | 114          |
| `Oversampler<4>` round trip                            | 228          |
| `Oversampler<8>` round trip                            | 384          |

Worked per-unit budgets. "Wrapped" flops are multiplied by the factor because
they run at the inner rate; core models and detectors run at the host rate.

| Unit                  | Tier   | Factor | Wrapped block          | Host-rate block                  | Flops/sample/ch | Stereo Mflop/s @48k | ×12 |
| --------------------- | ------ | ------ | ---------------------- | -------------------------------- | --------------- | ------------------- | --- |
| Program EQ            | Eco    | 1×     | triode 16              | 2 cores 40                       | 56              | 5.4                 | 65  |
| Program EQ            | Studio | 2×     | triode 16 → 32         | 2 cores 40                       | 186             | 17.9                | 214 |
| Program EQ            | Max    | 4×     | triode 16 → 64         | 2 cores 40                       | 332             | 31.9                | 382 |
| Optical Leveller      | Eco    | 1×     | triode 16 + cell 12    | 2 cores 40 + shaper 12           | 80              | 7.7                 | 92  |
| Optical Leveller      | Studio | 2×     | 28 → 56                | 52                               | 222             | 21.3                | 256 |
| FET Limiter           | Eco    | 2×     | fet 22 + block 14 → 72 | 2 cores 40 + detector 30         | 256             | 24.6                | 295 |
| FET Limiter           | Studio | 4×     | 36 → 144               | 70                               | 442             | 42.4                | 509 |
| FET Limiter           | Max    | 8×     | 36 → 288               | 70                               | 742             | 71.2                | 855 |
| Variable-Mu           | Eco    | 2×     | cell 46 → 92           | 2 cores 40 + shaper 12           | 258             | 24.8                | 297 |
| Variable-Mu           | Studio | 4×     | 46 → 184               | 52                               | 464             | 44.5                | 535 |
| Console EQ (British)  | Eco    | 1×     | 2 blocks 28            | 2 cores 40 + 3 inductor cores 60 | 128             | 12.3                | 147 |
| Console EQ (British)  | Studio | 2×     | 28 → 56                | 100                              | 270             | 25.9                | 311 |
| Console EQ (American) | Eco    | 1×     | 2 blocks 28            | 1 core 20                        | 48              | 4.6                 | 55  |
| Console EQ (American) | Studio | 2×     | 28 → 56                | 20                               | 190             | 18.2                | 219 |

Against ADR-0006's assumed 2–8 Gflop/s scalar phone core, twelve instances of the
most expensive unit at Eco is **295 Mflop/s = 3.7 % to 15 % of one core**, and at
Studio it is 509 Mflop/s = 6.4 % to 25 %. So: **Eco fits twelve on a phone and
Studio does not, at the low end of the assumed core throughput.** That is the
same conclusion ADR-0006 reached for the granular pair, reached independently
here, and it is stated as MODELLED under ADR-0005 — every figure above is an
operation count, not a measurement.

Tier assignment, per unit, and the reason:

| Unit             | Eco    | Studio | Max    | Why                                                                                                                                                                                                                       |
| ---------------- | ------ | ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program EQ       | 1×     | 2×     | 4×     | Its nonlinearity runs at −12 dBFS with 0.15 % THD; there is almost nothing to alias. NL-09 measures the 1× alias floor and publishes it rather than assuming it.                                                          |
| Console EQ       | 1×     | 2×     | 4×     | Same, plus inductor cores that are only excited by large low-frequency boosts.                                                                                                                                            |
| Optical Leveller | 1×     | 2×     | 4×     | A 10 ms attack cannot generate high-frequency control content.                                                                                                                                                            |
| FET Limiter      | **2×** | **4×** | **8×** | A 20 µs attack is faster than one period of any audio frequency below 50 kHz, so the detector itself is a distortion generator. Its own sheet calls it the most likely of the five to alias. Its Eco floor is 2×, not 1×. |
| Variable-Mu      | 2×     | 4×     | 4×     | The gain element is the amplifier, so distortion arrives with the compression and grows with it.                                                                                                                          |

---

## 7. Verification

Each row is a Ledger cell: an executable claim with a number, run offline through
`renderOffline` at 48 kHz unless stated, and re-run at 44.1, 96 and 192 kHz for
the rows marked _rates_.

| ID    | Measurement                                                                                                                                                       | Method                                                                                        | Pass criterion                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NL-01 | **Second-over-third rule.** `TriodeStage` at the §4.1 anchor (drive 0.2735, bias 0.0459), 1 kHz at −12 dBFS.                                                      | FFT, 1 Hz bins, 8 s.                                                                          | H2/H1 = 1.40e−3 ± 15 %; H3/H1 = 3.50e−4 ± 15 %; total THD 0.144 % ± 0.02 pp; H2 exceeds H3 by ≥ 6.0 dB.                                                                                   |
| NL-02 | **The crossover moves with drive.** Same stage, sweep drive so `A` runs 0.5·u₀ → 6·u₀.                                                                            | Ratio H2/H3 at each point.                                                                    | H2/H3 crosses 0 dB at `A = 3·u₀ ± 12 %`; the ratio is monotonically falling across the sweep with no reversal.                                                                            |
| NL-03 | **Even-order cancellation.** `PushPullStage`, imbalance 0, bias 0, 1 kHz at −6 dBFS.                                                                              | FFT.                                                                                          | H2 ≤ **−80 dBc**. H4 ≤ −80 dBc. H3 ≥ −40 dBc, i.e. the stage is working.                                                                                                                  |
| NL-04 | **Imbalance returns even order linearly.** Same, imbalance 0.02, 0.05, 0.10.                                                                                      | H2/H1 at each.                                                                                | H2/H1 within ±20 % of the imbalance value at each of the three points; the fit through the origin has R² ≥ 0.99.                                                                          |
| NL-05 | **Ratio rises with reduction.** `RemoteCutoffCell`, measure `gainDb` slope (10) at control giving 3, 10 and 20 dB of reduction.                                   | Numerical derivative of `gainDb`.                                                             | Each slope strictly greater than the previous; slope at 20 dB ≥ **1.40×** slope at 3 dB. THD at 20 dB exceeds THD at 3 dB by ≥ **10.0 dB** at matched output level.                       |
| NL-06 | **Core distortion is frequency-dependent in the right direction.** `MagneticCore` at default calibration, 30 Hz and 1 kHz, both at +10 dBm-equivalent (−12 dBFS). | THD, and H3/H2 at 30 Hz.                                                                      | THD(1 kHz) ≤ 0.03 %; THD(30 Hz) = 1.5 % ± 1.0 pp; THD(30 Hz) exceeds THD(1 kHz) by ≥ **3.0 dB**; H3 exceeds H2 by ≥ **6.0 dB** at 30 Hz.                                                  |
| NL-07 | **Hysteresis floor.** Same core, 30 Hz at −60 dBFS.                                                                                                               | THD.                                                                                          | THD ≥ **0.02 %**. Mutation: with `coercivity = 0` the same measurement must read ≤ 0.001 % and this case must fail by name.                                                               |
| NL-08 | **Feedback winding reduces, not increases.** Two cores, identical but `feedbackCancellation` 0.0 and 0.4, same 30 Hz drive.                                       | THD of each.                                                                                  | The `0.4` core's THD is between 40 % and 70 % of the `0.0` core's.                                                                                                                        |
| NL-09 | **Alias floor per tier.** 15 kHz sine at the unit's maximum drive, host 48 kHz; and 12 kHz at 15 dB of gain reduction for the FET divider.                        | FFT; identify components not at `n·f₀`.                                                       | 1×: recorded, no threshold — this row exists to _publish_ the untiered figure. 2×: ≤ −60 dBFS below 15 kHz. 4×: ≤ **−70 dBFS**. 8×: ≤ −80 dBFS.                                           |
| NL-10 | **Declared latency is measured latency.** _rates_ Impulse through `Oversampler<F>` for F ∈ {1,2,4,8}.                                                             | Sample index of the peak, and of the centroid.                                                | Peak index equals `latencySamples()` **exactly**, at all four rates and all four factors: 0 / 37 / 46 / 49.                                                                               |
| NL-11 | **1× is an exact bypass.** Render a 60 s pink-noise + drums file through `Oversampler<1>` wrapping the identity, and directly.                                    | `peakDifference`.                                                                             | **Exactly 0.0f.** Not −140 dBFS; zero. A 1× path that filters has changed the samples.                                                                                                    |
| NL-12 | **Passband ripple.** _rates_ Log sweep 20 Hz–20 kHz through `Oversampler<4>` wrapping the identity.                                                               | Magnitude response.                                                                           | Within **±0.01 dB** from 20 Hz to 19 kHz; the loss at 20 kHz is recorded, not graded.                                                                                                     |
| NL-13 | **Block-size invariance.** Full chain, 10 s of programme, block sizes 16, 17, 64, 128, 1024.                                                                      | `peakDifference` against the 128 render.                                                      | ≤ **6e−8** (half a Float32 step).                                                                                                                                                         |
| NL-14 | **Denormal safety.** 5 s at −1 dBFS, then 60 s of digital silence, `Oversampler<8>` + full chain.                                                                 | Per-block wall time, worst block in the silent region against worst block in the loud region. | Silent worst ≤ **1.10 ×** loud worst.                                                                                                                                                     |
| NL-15 | **One allocation in prepare.** `RtGuard` armed across `prepare()` of a full chain including all three cascades.                                                   | `guard.allocations()`.                                                                        | **Exactly 1.**                                                                                                                                                                            |
| NL-16 | **Zero allocations in process.** `RtGuard` over the four cases of §5.2.                                                                                           | `guard.allocations()`.                                                                        | **0** in each. Mutation-tested: a deliberate `new` inside `process` fails the case by name.                                                                                               |
| NL-17 | **Cross-family separation.** The British and American console configurations, same nominal low-boost setting, 40 Hz at 12 dB below clipping.                      | THD of each, with EQ flat and with full boost.                                                | British: boosted THD exceeds flat THD by ≥ **6.0 dB**. American: the same difference is ≤ **3.0 dB**. If both models answer the same, they are sharing a core placement and one is wrong. |
| NL-18 | **Curvature agrees with the samples.** For 20 random configs, compare `curvature()` against H2 and H3 measured from `process`.                                    | (2) and (3) against the FFT.                                                                  | Predicted and measured H2/H1 within **±10 %**; H3/H1 within ±10 %. This is the test that keeps a face honest.                                                                             |

---

## 8. Open questions

1. **Which stage the Program EQ's make-up amplifier instantiates is not
   settled.** `dyn-01` §6.3 records an unresolved conflict between a
   push-pull description and a tube complement consistent with a simpler
   arrangement. The library supports both; the choice is a unit-level decision
   and the sheet says it must be re-checked against the circuit reference before
   the harmonic profile is frozen. NL-01 is written for the single-ended answer
   and would need its polarity reversed for the other.
2. **The bias that puts the second/third crossover at the right level has no
   published number.** §4.1's `u₀ = 0.0459` is derived from a THD figure and a
   harmonic-ratio assertion, both of which are the sheet's, but nothing published
   says where the reference unit's crossover actually sits. It is our choice.
3. **No coercivity figure exists for any of the transformers in the five
   units.** The only anchor is a mechanism-level measurement on an unrelated
   part. §4.5's band is engineering judgement bounded by that one number.
4. **Whether a rate-independent play operator is sufficient.** A full
   history-dependent magnetics model of the class the tape literature uses would
   be more faithful and needs an implicit solve per sample; its real-time cost on
   this budget is unknown and it cannot be measured here. The decision to ship
   the play operator is a cost decision made without the comparison.
5. **The 4× versus 8× threshold for the FET Limiter.** Its own sheet identifies
   the _detector_ as the aliasing source, not the audio path. Whether the
   detector must also run at the oversampled rate — which would roughly double
   the unit's Eco cost — is not settled by any published measurement, and NL-09
   at 1× exists partly to find out.
6. **Inductor core magnitude for the British console lineage.** No published DCR
   or core data was located, so `MagneticCore`'s configuration inside that unit's
   EQ network is calibrated only against NL-17's ≥ 6 dB assertion, which bounds
   it from below and not at all from above.
7. **Whether unequal halfband lengths are the right answer to the half-sample
   problem.** The alternative — a polyphase IIR with a declared group delay — is
   cheaper and has non-linear phase. The choice here was made on the ground that
   an exact integer latency is what delay compensation needs; nobody has measured
   whether the IIR's phase error is audible in these units.
8. **`kFullScaleDbu = 22.0f` is a convention, not a measurement.** It makes every
   published dBm figure in the five sheets directly testable, and it puts the
   Variable-Mu Limiter's clipping point above full scale. If the product decides
   that a unit must not exceed 0 dBFS, this constant moves and every calibration
   in §4 moves with it.
