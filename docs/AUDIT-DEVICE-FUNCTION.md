# Device function audit — does each device do what it shows?

Every stock device checked against its own audio: each declared parameter traced to the
line that reads it, each unit and range checked against what the DSP does with the number,
each face checked against the graph it claims to draw, each bypass checked for
transparency, and the offline render checked against the live one.

Scope: the 27 kinds in `EFFECT_SPECS` (`src/model/effects.ts` — the array the brief calls
`EFFECTS`) and their 164 declared parameters, plus `SynthParams`, `SamplerParams` and
`SampleZone`. The `wam` placeholder is out of scope: a plugin declares no parameters here
by design.

Read against `src/model/effects.ts`, `src/audio/effectChain.ts`, `src/audio/exportMix.ts`,
`src/components/mixer/PluginFace.tsx`, `src/audio/synth.ts`,
`src/audio/samplerInstrument.ts`, `src/model/sampler.ts`, `src/model/synthFace.ts` and
`src/model/paramRegistry.ts`.

Line numbers are as of this audit. Nothing here is asserted from a name: every row was
read on both sides.

**18 findings — 4 high, 7 medium, 7 low.** 26 of 27 devices have every declared parameter
reaching the audio; the exception is the Tuner. What was checked and found correct is
listed at the end so it is not re-traced.

---

## High

| # | Device | Claimed | What actually happens | Sites | Smallest correct fix |
| --- | --- | --- | --- | --- | --- |
| H-1 | EQ8 | Two knobs labelled **Low shelf Q** and **High shelf Q**, range 0.2–4, default 0.71, formatted `Q 0.71`, and automatable like any other parameter | Nothing reads them. The value is written to `BiquadFilterNode.Q` on a node whose `type` is `lowshelf`/`highshelf`, and the Web Audio specification does not use `Q` for those two types — the shelf slope is fixed at S = 1. The app's own response model says so and ignores the value too, so the curve is right and the control is dead | Claimed: `src/model/effects.ts:160-168` (the `Q` spec `eqBand` appends unconditionally), used at `:320` and `:325`; drawn from `:780-786`. Audio: `src/audio/effectChain.ts:999` writes it to the shelf node; `src/audio/dsp/curves.ts:81` and the `lowshelf`/`highshelf` cases at `:133-153` compute the shelf from `aS` and never touch `q` | Give `eqBand` a `withQ` parameter and pass `false` for the two shelf bands, so `lsQ`/`hsQ` stop being declared. Have `eq8Bands` pass the constant `Math.SQRT1_2` for shelves so the response model still gets a number, and skip the `.Q` write in `buildEq8` for bands whose type is a shelf. No migration is needed: `normaliseParams` rebuilds each parameter map from the spec, so stored `lsQ`/`hsQ` values are dropped on load and nothing sounds different, because they never did |
| H-2 | Tuner | Blurb: *"Pitch readout. Passes audio through untouched."* One parameter, **Reference**, 415–465 Hz, default 440 | There is no pitch readout anywhere and nothing reads `reference`. `faceKindOf` sends the Tuner to the `scope` face, which draws a time-domain waveform; the builder configures the analyser window and comments that the reference "only shifts how the measured frequency is named", but nothing names anything. `noteFromHz`, `centsBetween` and `detectPitch` exist in `src/model/pitch.ts` with a `referenceHz` argument and have no caller in `src/` at all — only `tests/pitch.test.ts` | Claimed: `src/model/effects.ts:670-685`. Audio/UI: `src/audio/effectChain.ts:2043-2049`; `src/components/mixer/PluginFace.tsx:1293-1294` (`'tuner' → 'scope'`) and `:1375-1377` (`TapFace`, mode `scope`); `src/model/pitch.ts:216-256` (unused) | Add a `TunerFace` beside the others in `PluginFace.tsx`: read `tap.getFloatTimeDomainData` on the frame loop, call `detectPitch(samples, tap.context.sampleRate)`, name the result with `noteFromHz(hz, paramOf(effect, 'reference'))` and draw the cents deviation. Point `faceKindOf('tuner')` at it. That makes the blurb and the control true in one change. If that is not wanted now, the honest alternative is to delete `reference` and reword the blurb to "Scope tap" |
| H-3 | Limiter | A 20:1 brickwall at the ceiling, drawn on a +24 dB input axis (`axisTopOf` widens the plot precisely because "its own drive control reaches +24 dB and the detector can now measure that far"), with a live gain-reduction meter beside it | The transfer WaveShaper is only defined over an envelope of 0…1, so above 0 dBFS the VCA's gain stops moving. With the default ceiling of −0.3 dB the VCA can never reduce by more than **0.40 dB**, no matter how hard the device is driven — everything above that is removed by the hard clipper downstream. The face draws the law extended over the whole +24 dB axis, and the GR meter reads the VCA control signal, so it reports 0.4 dB while 23 dB is being clipped off. Measured through the shipped functions: at +24 dBFS in, the face plots −23.09 dB of reduction and the shaper delivers −0.40 dB | Claimed: `src/model/effects.ts:860-870` (`dynamicsLawOf` case `'limiter'`, ratio 20, knee 2); `src/components/mixer/PluginFace.tsx:436-443` (`axisTopOf` → 24) and `:487-495` (the plotted law). Audio: `src/audio/effectChain.ts:426` (shaper), `:454` (`depth` → the meter tap), `:497-503` (`gainReductionDb`), `:780-820` (the build, with the clipper at `:786`); `src/audio/dsp/curves.ts:424-426` (`transferCurve` samples the law over \|x\| ≤ 1). The mechanism is documented at `src/audio/effectChain.ts:255-274`, but only as a detector note — not as a consequence for this device's meter or face | Make the envelope scale a property of the processor rather than a global. For the limiter, build the rectifier at unity (`rectifierCurve(1)`, so the shaper sees `\|x\|/DETECTOR_HEADROOM`) and sample its curve as `transferCurve(e => dynamicsGain(law, e * DETECTOR_HEADROOM))`. That covers 0…+24 dBFS at the cost of curve resolution below −36 dBFS, which for a limiter is free — its law is unity everywhere down there. Leave the gate and the compressor on the present scale, which is what the `DETECTOR_HEADROOM` note is right about. One change fixes the meter and the face together |
| H-4 | Chorus, Flanger, Phaser, Tremolo, Auto Pan, Rotary | Each modulation device draws its LFO shape "scaled by depth" (`docs/DEVICE-PARITY.md` §1.3 describes it that way) | `EffectVisual` passes `paramOf(effect, 'depth') \|\| 0.6` into a face that clamps depth to 0…1. Three separate defects follow. (a) Chorus and Flanger declare `depth` in **milliseconds** (0–12 and 0–8), so any setting at or above 1 ms clamps to 1 and draws a full-scale sweep; the picture stops responding to the control over almost its whole range. (b) The `\|\| 0.6` fallback means a device set to **zero depth** — no modulation at all — draws a 60 % moving waveform. This hits all five devices that have a `depth`. (c) Rotary declares no `depth` and no `shape`, so `paramOf` returns 0 for both: its face is a fixed 60 % sine that does not move for speed, slow/fast rate, crossover, horn depth, drum depth or mic spread. Separately, the face's shape table carries five names where the model offers three, so `saw` and `random` are unreachable | Claimed: `src/components/mixer/PluginFace.tsx:1342-1352`, table at `:930`, drawing at `:949-968`. Audio: `src/audio/effectChain.ts:1288-1337` (chorus, `depth` in ms at `:1313`), `:1339-1387` (flanger, `:1369`), `:1533-1610` (rotary, `hornDepth`/`drumDepth` at `:1582`). Specs: `src/model/effects.ts:420` and `:442` (`unit: 'ms'`) | Add a `modulationOf(effect)` descriptor to `effects.ts` alongside `delayLayoutOf` and `widthFieldOf`, returning the shape index and a normalised 0–1 depth per kind: chorus and flanger report `min(depth_ms, delay_ms) / delay_ms`, which is what the audio's own `Math.min(depth/1000, base)` produces; phaser, tremolo and auto pan report their percent unchanged; rotary reports its horn depth and the selected rate. Drive `LfoFace` from that and delete the `\|\| 0.6`. Trim the face's shape table to the three shapes `ShapedLfo` builds |

### H-3 in numbers

Default limiter (`ceiling −0.3 dB`, `LIMITER_RATIO 20`, `LIMITER_KNEE_DB 2`), evaluated
through `compressorGain` and `transferCurve` as shipped:

| Input | Reduction the face plots | Reduction the shaper delivers | Where the rest of the level goes |
| --- | --- | --- | --- |
| −6 dBFS | 0.00 dB | 0.00 dB | — |
| 0 dBFS | −0.40 dB | −0.40 dB | — |
| +6 dBFS | −5.98 dB | −0.40 dB | 5.6 dB into the clipper |
| +12 dBFS | −11.69 dB | −0.40 dB | 11.6 dB into the clipper |
| +24 dBFS | −23.09 dB | −0.40 dB | 23.6 dB into the clipper |

The last curve entry is `0.9548`, which is −0.401 dB; that is the meter's floor.

---

## Medium

| # | Device | Claimed | What actually happens | Sites | Smallest correct fix |
| --- | --- | --- | --- | --- | --- |
| M-1 | Ping-Pong | The face draws the echoes as taps on a time axis, and the `DelayLayout` doc says the picture is "a promise the audio keeps" | `delayLayoutOf` hard-codes the `'straight'` modifier, but `buildPingPong` reads the **Feel** choice and applies it. On Dotted the audio spaces its repeats 1.5× wider than the picture; on Triplet, ⅔ as wide. The plain Delay is unaffected — it has no Feel control and both sides use `'straight'` | Claimed: `src/model/effects.ts:936`. Audio: `src/audio/effectChain.ts:1683-1687` | Pass the modifier: `syncSeconds(paramOf(effect, 'timeSixteenths'), bpm, effect.kind === 'pingpong' ? syncModifierByIndex(choiceOf(effect, 'modifier')) : 'straight')`. `tests/effectCurves.test.ts` already pins the straight case; add the dotted one beside it |
| M-2 | Delay | A tempo-synced time control, and a collapsed slot summary naming the division | The parameter carries `unit: 'x'`, so the knob formats it as a bare `6.0` where the identical Ping-Pong control reads `6/16`. The slot summary computes `1/round(16/n)`, which is only correct for n ∈ {1, 2, 4, 8, 16}: the default of 6 prints "1/3", which is not a division this delay can produce, and 11 of the 16 settings print something wrong | Claimed: `src/model/effects.ts:545` (`unit: 'x'`) and `:1298-1299` (`describeEffect`). Correct counterpart: `:565` (Ping-Pong, `unit: 'div'`) and `:1300-1301`. Audio: `src/audio/effectChain.ts:1639-1643` (`syncSeconds(…, 'straight')`); naming in `src/audio/dsp/curves.ts:638-653` | Set the Delay's `timeSixteenths` unit to `'div'` and make its `describeEffect` case `describeDivision(paramOf(effect, 'timeSixteenths'), 'straight')`. Both are already the Ping-Pong's behaviour |
| M-3 | Sampler | The automation lane is called **Sampler · Resonance** with `unit: 'Q'`, formatted as a bare number | The same value is written to `filter.Q.value` on a `lowpass` or `highpass`, which Web Audio reads as **decibels** — it is the lift at the corner. The instrument panel already says so (`0.8 dB`, with a comment explaining it) and `synthFace.ts` carries the value in a field called `qDb`. Only the automation registry still calls it Q, so the same number reads in two units depending on where you look at it. The synth's descriptor was corrected for exactly this and the sampler's was not | Claimed: `src/model/paramRegistry.ts:70-79`. Audio: `src/audio/samplerInstrument.ts:129-133`; `src/model/sampler.ts:60-62` (`filterType` is only `off`/`lowpass`/`highpass`, both of which read Q in dB); `src/model/synthFace.ts:38-52` and `:88-92`. Already-correct counterpart: `src/model/paramRegistry.ts:154-174` | Set the descriptor's `unit` to `'dB'` and `format` to `` (v) => `${v.toFixed(1)} dB` ``, matching the synth entry directly above it. Leave `min`/`max`/`scale` alone for the same reason the synth entry gives: they decide how a stored 0–1 lane value maps back, and moving them changes how saved lanes sound |
| M-4 | Classic drum kit | An instrument track of type `drum` offers five automation lanes: Cutoff, Resonance, Attack, Release and Level | `DrumKit` reads exactly one field of `SynthParams` — `volume`. There is no filter and no envelope in it: it starts a buffer and applies velocity. So four of the five lanes are automatable, drawable and read by nothing. The synth panel is already honest here (it hides the oscillator, filter and envelope sections for a drum track); only the automation list is not | Claimed: `src/model/paramRegistry.ts:294-311` (gated on `type === 'instrument' \|\| type === 'drum'`) with the list at `:143-204`. Audio: `src/audio/synth.ts:255-302`, the single read at `:272`; construction at `src/audio/engine.ts:796-797` and `src/audio/exportMix.ts:722-725`, both keyed on `type === 'drum' && !sampler` | Offer the lane list the instrument can honour: keep the full `SYNTH_PARAMS` for `type === 'instrument'`, and for a classic-kit drum track (`type === 'drum'` with no `sampler`) offer only Level. A drum track converted to a rack already routes through the sampler branch and is unaffected |
| M-5 | Tremolo | **Stereo phase**, 0–180°, step 1° — 181 settings | The value is snapped to the nearest of {0, 90, 180}, which are the only offsets a pair of oscillators can hold exactly for an arbitrary waveform. Everything between 46° and 134° is 90°; the control moves 180 steps and the audio has three | Claimed: `src/model/effects.ts:501-509`. Audio: `src/audio/effectChain.ts:1444` (`STEREO_PHASES`), `:1492-1495`, `:1517-1523` (`closestPhaseIndex`) | Declare it as a choice — `choice('stereoPhase', 'Stereo phase', ['0°', '90°', '180°'])` — and index `STEREO_PHASES` with `choiceOf`. The knob becomes a three-position switch, which is what the audio is, and `closestPhaseIndex` goes away. Stored values 0/90/180 do not survive as indices, so this one needs a migration or a new key |
| M-6 | Limiter | *"Bypassing forces dry to unity and wet to zero rather than disconnecting, so … a bypassed insert is mathematically transparent whatever the wet path does"* (`WetDry`), and every other insert is built that way | The Limiter has no dry path around its clipper. Bypass returns `drive`, `preClip` and `postClip` to unity and opens the VCA's dry leg, but the signal still passes through `brickwall` — a `WaveShaperNode` with `oversample: '4x'`. The identity curve is transparent inside the rails; the browser's up- and down-sampling filters that `'4x'` switches on are not, and they are not latency-free. It is the one insert whose bypass is not a route around everything it adds | Claimed: `src/audio/effectChain.ts:161-166` (the `WetDry` contract) and the pattern at `:648-680` (`SwitchableFilter`). Audio: `:786` (the shaper), `:790` (the only path), `:800-817` (bypass restores gains but not the route). Test coverage stops at the compressor: `tests/effectCurves.test.ts:862-880` | Put the clipper in a crossfade: a dry gain from `vca.output` to `postClip`'s output summed against `preClip → brickwall`, ramped from the same `bypass` flag — the shape `SwitchableFilter` already uses. Then extend the bypass-transparency test at `tests/effectCurves.test.ts:862` over every kind rather than the compressor alone |
| M-7 | Chorus, Flanger, Phaser, Tremolo, Auto Pan, Rotary | Tremolo: *"Level modulation, free-running or locked to the project tempo."* Auto Pan: *"…free-running or tempo-locked."* Both have a **Tempo sync** switch | Sync locks the *rate* and never the phase. The oscillators are started with no time argument when the chain is built, so the phase at any bar is whatever the wall clock made it. Two consequences that matter: a bounce does not print the phase that was monitored, and a bounce of bars 5–8 does not print the same phase those bars have inside a full-song bounce — offline the LFOs start at render t = 0, which is `preRoll` seconds before the delivered audio begins, and that offset is the same whatever range was asked for | Claimed: `src/model/effects.ts:466` and `:609` (the blurbs), `:470` / `:613` (the `sync` choice). Audio: `src/audio/effectChain.ts:548-549` (`start()` with no argument), used by `ShapedLfo` at `:589`; no phase reset exists anywhere in the file. Offline: `src/audio/exportMix.ts:56-72` and `:411` — the graph is built at t = 0 and the pre-roll is trimmed afterwards | Give `QuadratureLfo` and `ShapedLfo` a `start(when)` and call it. Offline, start them at the moment the trimmed range begins, so a bounce is bar-consistent and range-independent. For the two devices with a Tempo sync switch, derive the start from the transport position at play so "locked to the project tempo" means locked to the bar rather than only to the rate |

---

## Low

| # | Device | Claimed | What actually happens | Sites | Smallest correct fix |
| --- | --- | --- | --- | --- | --- |
| L-1 | Analyser | A spectrum drawn on a 20 Hz–20 kHz log axis | The bin-to-hertz conversion hard-codes a 24 kHz Nyquist. At 44.1 kHz every point is drawn about 8.8 % high in frequency — roughly an eighth of an octave — so the display disagrees with the EQ curve beside it on the same channel | `src/components/mixer/PluginFace.tsx:1010` | `const nyquist = tap.context.sampleRate / 2;` |
| L-2 | MotionSynth | `SynthParams.resonance` is documented as *"Filter resonance Q (0.1..20)"* | The voice writes it to a `lowpass` `Q`, which Web Audio reads as decibels, and clamps 0.05–24. Every other site now says so — the panel displays dB, `synthFace.ts` names the field `qDb`, the automation descriptor was corrected. The type declaration is the last place that still says Q, and it is the first place a reader looks | Claimed: `src/model/types.ts:105-106`. Audio: `src/audio/synth.ts:81-85`. Corrected elsewhere: `src/model/synthFace.ts:38-52`, `src/model/paramRegistry.ts:154-174` | Reword the comment: filter resonance in decibels of lift at the corner, clamped 0.05–24 by the voice |
| L-3 | Ping-Pong | The face draws taps alternating above and below the axis — the two sides of the stereo image | `DelayLayout` carries no width, so the drawing alternates whatever the **Width** control is set to. At width 0 both pan nodes sit at centre and the audio produces no left/right alternation at all, while the picture still shows it | Claimed: `src/model/effects.ts:895-943` (`DelayLayout`, no width field); drawn at `src/components/mixer/PluginFace.tsx:715-760`. Audio: `src/audio/effectChain.ts:1693-1695` | Add `width` to `DelayLayout`, fill it from the parameter for a ping-pong and 0 for a delay, and let `DelayFace` draw both sides when the width is small |
| L-4 | Stereo Width | The face draws the mono-bass line only above 21 Hz, so 20 Hz reads as "off" | 20 Hz is the parameter's minimum but not an off position: the side channel always passes a Butterworth highpass, so the processor is never quite transparent at any setting | Claimed: `src/components/mixer/PluginFace.tsx:859`. Audio: `src/audio/effectChain.ts:1815` (the filter) and `:1853` (always written) | Make the mono-bass filter switchable with the `SwitchableFilter` pattern and crossfade it out at the minimum, so the face's "off" is the audio's off |
| L-5 | Ping-Pong | `DelayLayout.toneHz` is documented as *"Damping corner the repeats pass through, in Hz"*, and the interface doc says the builder sets its delay time and feedback from this description | A ping-pong has no `tone` parameter — it has Low cut and High cut — so `paramOf` falls through to 0 and the field reports a 0 Hz damping corner. Nothing draws it, so nothing is visibly wrong today; the field is simply not true for one of the two kinds it serves. The doc claim is also loose: the two builders call `syncSeconds` themselves rather than reading the layout, which is how M-1 became possible | `src/model/effects.ts:914-916` (the field and its doc), `:938` (the read); `src/model/effects.ts:895-903` (the interface doc). Audio: `src/audio/effectChain.ts:1690-1691` (`lowCut`/`highCut`) | Either drop `toneHz` (nothing consumes it) or fill it from `highCut` for a ping-pong, and correct the doc comment to say the layout and the builder share one conversion rather than that the builder reads the layout |
| L-6 | EQ | **Mid Q** carries `unit: 'x'`, so it formats as `1.0` where every other quality factor in the catalogue formats as `Q 1.00` | The value is correct — a peaking biquad reads Q as a plain factor and `buildEq3` writes it unconverted — only its unit is not the one the catalogue uses for the same quantity | Claimed: `src/model/effects.ts:308`. Compare `:160-168` (EQ8) and `:340-348` (Filter), both `unit: 'Q'`. Audio: `src/audio/effectChain.ts:964` | `unit: 'Q'` |
| L-7 | Bitcrusher, Saturator, Distortion | A **Mix** control, which reads as a clean parallel blend of the processed and unprocessed signal | The wet path is delayed relative to the dry one, so any setting between the extremes combs rather than blends. The bitcrusher's rate-reduction network is a cascade of boxcar holds whose group delay is exactly (2^k − 1)/2 samples — 31.5 samples at 64×, putting the first comb null near 760 Hz at 48 kHz. The saturator's and distortion's shapers run `oversample: '4x'`, whose up/down-sampling filters are not latency-free. The dry path in `WetDry` has no matching delay | `src/audio/effectChain.ts:155-196` (`WetDry`, undelayed dry), `:1234-1252` (the hold cascade), `:1119` and `:1149` (the `'4x'` shapers) | Delay the dry leg by the wet path's group delay. The bitcrusher's is exactly computable from the active stage count; the shapers' is browser-dependent and would have to be measured or accepted, in which case say so where the parameter is declared |

---

## Checked and found correct

Do not re-trace these.

**Every parameter reaches the audio, for 26 of the 27 kinds.** All 164 declared parameters
were traced from `ParamSpec.key` to a `paramOf`/`choiceOf` read. The only key nothing reads
is `tuner.reference` (H-2). Two more are read but reach a node field the platform ignores
(`eq8.lsQ`, `eq8.hsQ`, H-1). `gainMatch.target` is deliberately not read by the audio: the
builder applies `trim` only and the face computes the suggestion from the analyser
(`src/audio/effectChain.ts:1917-1932`, `src/model/effects.ts:707-730`,
`src/components/mixer/PluginFace.tsx:1120-1225`) — that is the fixed behaviour, working.

**Units and ranges against the DSP.** The Q-in-decibels trap is handled correctly
everywhere it arises in the effects: `buildFilter` converts with `qToDb` for the pass modes
and passes the plain factor to the bandpass (`effectChain.ts:1090-1092`), `buildEq8` does
the same for HP and LP (`:1004`), and `eqMagnitudeResponse` converts the same way for the
plots (`curves.ts:223-240`), so face and audio agree. `Math.max` checks: `bits` stops at
`MAX_CRUSH_BITS`, `CRUSH_FACTORS` and the crusher's stage count agree at 64× / 6 stages,
`PHASER_STAGES` matches the `stages` range and step, the phaser's depth is cents on
`detune`, `chorus`/`flanger` depth is clamped to the base delay so the line never goes
negative, `DriveStage`'s maximum matches the Filter's `drive` range at 24 dB, the multiband
band parameters are all inside `DynamicsCompressorNode`'s own ranges, the reverb's `size`
range matches `renderImpulse`'s clamp, and `predelay` fits its `DelayNode`.

**Faces.** `dynamicsLawOf`, `shaperCurveOf`, `deesserBand`, `multibandSplits`, `eq8Bands`,
`reverbTailOf`, `widthFieldOf` and `tuneSettingsOf` are each read by both the builder and
the face, and each was checked on both sides. The de-esser's band strip, the multiband's
crossover, the four waveshaper curves, the reverb envelope's 2.2 exponent and the Vocal
Tune staircase all match the audio. Vocal Tune is fully wired: all six parameters flow
through `tuneSettingsOf` into `src/components/audioeditor/AudioEditor.tsx:113-118` and the
`formantPreserve` flag reaches `pitchShiftChannel`.

**Bypass.** Every insert was checked for a transparent bypass, including the latency it
adds. 26 of 27 route around everything they add: `WetDry` forces dry to unity, the control
VCA crossfades to a constant-1 gain path with makeup and look-ahead returned to unity, EQ8
gain bands ramp to 0 dB and its pass filters crossfade out, the Filter mutes all three
modes and opens a dry leg, the flanger's through-zero dry delay is forced off, and the
measurement inserts are a single unity gain with a dead-end analyser branch. The Limiter is
the exception (M-6).

**Offline against realtime.** Both paths build every insert through the same
`InsertChain`/`buildEffectNode`, so there is no per-device divergence to find:
`exportMix.ts:429-445` mirrors `engine.buildMasterChain` including the safety limiter's
threshold, knee, ratio and ballistics and the `master.limiter === false` disengage
(`engine.ts:664-667`); `:468-491` mirrors the channel strip; `:514-515` applies the same
sidechain routing; `:833-834` builds clip event-FX chains as the engine does at
`engine.ts:1386-1388`; instruments are constructed the same way at `:675-725` and synth and
sampler automation is applied per voice at note time in both. The reverb's tail is seeded
from the effect id (`effectChain.ts:1745-1760`), so a bounce reproduces the monitored tail.
The two known divergences are the gain-reduction readouts, which are analyser-based and
silent offline with no effect on the audio, and the LFO phase (M-7).

**Instruments.** All nine `SynthParams` fields reach a `PolySynth` voice (`presetName` is
display only), and `synthFace.ts` reports the same clamps the voice applies — pinned by
`tests/synthFace.test.ts`, including that the response is computed with Q as decibels. All
sixteen `SamplerParams` fields and all twenty-five `SampleZone` fields reach a voice or the
zone lookup: `matchZones` honours key and velocity ranges, mute, solo and round-robin
groups and applies the key crossfade; `zonePlaybackRate` uses `rootNote`, `keyTrack`,
`tuneCoarse` and `tuneFine`; the window, loop points and reverse mirroring are applied at
`samplerInstrument.ts:109-122`; `chokeGroup` cuts at `:99-103`; `oneShot`, `gain`, `pan`,
`velToGain` and the envelope all reach the voice. `zone.slices` is editor data by design —
consumed by `slicesToPads` and the slice-to-MIDI action in `projectStore.ts:1560-1600`, not
by the voice. The "LFO → filter with the filter off" case is already handled honestly:
`samplerLfoOf` returns null and the panel says why (`SamplerPanel.tsx:1222-1228`), though
the voice still constructs and starts an oscillator that connects to nothing — waste, not a
lie.

### Not covered

Third-party `wam` plugins (they declare no parameters here, by design), note FX, and the
audio editor's offline retune beyond confirming that Vocal Tune's device settings drive it.
