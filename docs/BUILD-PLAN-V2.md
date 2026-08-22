# MotionLab v2 — build plan

This is the contract for the v2 build: what "complete, professional, front to back"
means, in the order it has to be built. It came out of a role-based audit of the
codebase against [`REFERENCE-FSP8.md`](REFERENCE-FSP8.md) — ten discipline leads
(product, DSP, application architecture, visual design, QA, accessibility,
performance, MIDI/music systems, mixing/mastering, documentation) each read the
source and reported what was missing, wrong, shallow or unpolished, and a single
synthesis pass turned 210 findings into the waves below.

Two rules make the waves buildable in parallel:

1. Each wave opens with one **integration workitem** that owns the shared files
   (`src/model/types.ts`, `src/state/projectStore.ts`, `src/state/uiStore.ts`,
   `src/styles/tokens.css`, `src/App.tsx`). It lands first and publishes the
   contracts the rest of the wave builds against.
2. Every other workitem in a wave owns a **disjoint** set of files, so they can be
   built at the same time without stepping on each other.

## Wave 0 — stop the bleeding

Live correctness bugs that make playback, bounces and the master fader wrong today,
plus the safety net that stops later waves regressing silently.

| Item | What                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------ |
| W0-2 | **Integration**: dead master fader, gesture leaks, undo bounds                                         |
| W0-1 | Silent mid-clip starts, voice stealing in offline renders, metronome routing, de-click                 |
| W0-3 | CI on push, multi-tab data safety, and proof for the guarantees the README claims                      |
| W0-4 | Accessibility interaction blockers: Space activating the wrong control, overlays that never trap focus |

## Wave 1 — foundations

| Item | What                                                                                         |
| ---- | -------------------------------------------------------------------------------------------- |
| W1-1 | **Integration**: patch-based store, command/undo layer, selection union, stepwise migrations |
| W1-2 | Worker platform: peaks, persistence, media LRU, multi-resolution envelopes                   |
| W1-3 | Design system: type/spacing/elevation/motion/z scales, focus and state layers                |
| W1-4 | Page host and code splitting — somewhere for Start / Project / Show to live                  |
| W1-5 | One time authority everywhere, and the transport the reference specifies                     |
| W1-6 | Surface registry: stop enumerating editors in six files                                      |
| W1-7 | Audio graph: patch-driven reconcile, worklet loader, key bus, real master                    |

## Wave 2 — console and effects

| Item  | What                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| W2-1  | **Integration**: effect registry, macros, cue sends, effect presets                                                           |
| W2-2  | Dynamics: compressor, gate/expander, limiter, multiband, de-esser                                                             |
| W2-3  | Tone: parametric EQ, filter, saturation, distortion, amp + cab, bitcrusher                                                    |
| W2-4  | Modulation, time and stereo: chorus, flanger, phaser, tremolo, rotary, autopan, ping-pong, width, gain match, analyser, tuner |
| W2-5  | Metering: LUFS, true peak, correlation, spectrum, oscilloscope, gain reduction                                                |
| W2-6  | Console: real channel strip, Channel Overview, channel editor, folder/VCA/FX strips                                           |
| W2-7  | Plugin faces: EQ curve, compressor transfer curve, GR meters, modulation visualisations                                       |
| W2-8  | Export: stems, per-track, formats, bit depth, dither, normalisation, metadata, progress                                       |
| W2-9  | Arrangement at scale: virtualised rows, O(1) hit-testing, viewport ruler                                                      |
| W2-10 | Automation: Write and Trim modes, master and tempo lanes                                                                      |

## Wave 3 — MIDI product

| Item  | What                                                                                |
| ----- | ----------------------------------------------------------------------------------- |
| W3-1  | **Integration**: controllers, bend, note expression, clip loop, project key, groove |
| W3-2  | MIDI file import and export, project merge                                          |
| W3-3  | MIDI recording, live CC/bend/aftertouch, MIDI clock, latency-compensated capture    |
| W3-4  | Note FX: arpeggiator, chorder, repeater, note filter, velocity curve                |
| W3-5  | Instruments: a real virtual-analogue synth, macro controls, one visual language     |
| W3-6  | Drum editor                                                                         |
| W3-7  | Score / notation editor                                                             |
| W3-8  | Piano roll: ruler, controller lanes, velocity ramps, tools, note clipboard          |
| W3-9  | Key commands editor and control link (MIDI learn)                                   |
| W3-10 | Chord detection, Chord Assistant, chord-following clips                             |

## Wave 4 — audio intelligence

| Item | What                                                                   |
| ---- | ---------------------------------------------------------------------- |
| W4-1 | **Integration**: warp map, analysis records, range selection, tool set |
| W4-2 | Warp, timestretch, tempo-follow and the Bend tool                      |
| W4-3 | Audio editor surface                                                   |
| W4-4 | Vocal Tune                                                             |
| W4-5 | Audio → Note (monophonic and polyphonic)                               |
| W4-6 | Stem separation                                                        |
| W4-7 | Range, Paint, Listen, Zoom tools; strip/insert silence; quantize panel |
| W4-8 | Event FX, render/transform to audio, track freeze                      |

## Wave 5 — the missing pages

| Item | What                                                                  |
| ---- | --------------------------------------------------------------------- |
| W5-1 | **Integration**: mastering-project, show, template and preset schemas |
| W5-2 | Start page                                                            |
| W5-3 | Project page (mastering)                                              |
| W5-4 | Show page (live performance)                                          |
| W5-5 | Browser: Instruments, Effects, Files, Pool, Cloud                     |
| W5-6 | Templates, track presets, chain presets                               |
| W5-7 | Reference video track and the time-signature lane                     |
| W5-8 | Scratch pads and arranger section operations                          |

## Wave 6 — polish and proof

| Item | What                                                                                 |
| ---- | ------------------------------------------------------------------------------------ |
| W6-1 | **Integration**: shell polish, announcement layer, overlay system, module docs       |
| W6-2 | Visual polish: track colour identity, waveforms, empty states, icon hygiene          |
| W6-3 | Accessibility: grid semantics for every pointer-only surface                         |
| W6-4 | Preferences, themes, UI scaling, honest application chrome                           |
| W6-5 | Internationalisation foundation and logical-property sweep                           |
| W6-6 | Test suite completion: component tests, realistic session fixture, visual regression |
| W6-7 | Documentation: parity table, corrections, and the reference material a DAW ships     |

Progress against this plan is recorded in [`RELEASE-NOTES.md`](RELEASE-NOTES.md).
