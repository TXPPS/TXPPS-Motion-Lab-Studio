# Parity with Fender Studio Pro 8

Measured against [`REFERENCE-FSP8.md`](REFERENCE-FSP8.md), section by section.
Three verdicts only:

- **Yes** — the workflow exists and is usable for real work.
- **Partial** — it exists, with a stated limit.
- **No** — it does not exist. Where that is deliberate, the reason is given.

MotionLab is a browser DAW. Where the reference depends on native-only capability,
the benchmark is parity of the _workflow_, not of the mechanism.

## 1. Pages

| Reference                | MotionLab |                                                                           |
| ------------------------ | --------- | ------------------------------------------------------------------------- |
| Start page               | **Yes**   | Recents, six session templates, machine status, release notes             |
| Song page                | **Yes**   | Arrange + console + browser + inspector + editors                         |
| Project page (mastering) | **Yes**   | Ordered release, BS.1770 measurement, delivery targets, release chain     |
| Show page (live)         | **Yes**   | Setlist with per-song tempo, signature, start point and notes; stage mode |

## 2. Song page

| Reference                 | MotionLab   |                                                                                                                                                    |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport                 | **Yes**     | Bars·beats·ticks and a millisecond clock, both typeable; bar-step transport with marker jumps; tap tempo; loop; punch; count-in; performance meter |
| Timeline ruler            | **Yes**     | Wall clock over bars and beats, walked through the signature map                                                                                   |
| Arrangement Overview      | **Yes**     | Whole-song canvas with a draggable viewport window                                                                                                 |
| Marker track              | **Yes**     | Drag, seek, rename, loop-to-next                                                                                                                   |
| Arranger track            | **Yes**     | Named sections that resize, reorder and carry their contents                                                                                       |
| Chord track               | **Yes**     | Placement, detection, and clips that follow it                                                                                                     |
| Tempo track               | **Yes**     | Jump and linear-ramp tempo events, and signature changes                                                                                           |
| Video track               | **No**      | Out of scope; stated in the reference document                                                                                                     |
| Track types               | **Yes**     | Audio, instrument, drum, bus, FX channel, folder, VCA                                                                                              |
| Tools                     | **Partial** | Pointer, range, split, erase, mute, slip. Paint, listen and zoom-drag are not built                                                                |
| Snap                      | **Yes**     | Off, grid, events, zero-crossing and adaptive, with a magnet strength                                                                              |
| Console                   | **Yes**     | Input trim/polarity/mono, named inserts, sends, pan, stereo meter with a printed dB scale, mute/solo/solo-safe/arm, routing, VCA assignment        |
| Channel Overview          | **Yes**     | One channel laid out horizontally with its EQ curve and gain reduction                                                                             |
| Cue mixes                 | **No**      | Not built                                                                                                                                          |
| Sidechain routing         | **Yes**     | Any track keys the compressor, gate, expander or ducker on any other                                                                               |
| Metering                  | **Yes**     | Peak, RMS, stereo, peak hold, over-indicator, LUFS (M/S/I), LRA, true peak, correlation, spectrum, oscilloscope                                    |
| Browser                   | **Yes**     | Instruments, Effects, Loops, Samples, Pool, Projects                                                                                               |
| Inspector                 | **Yes**     | Track, clip, inserts, sends, note FX, time and pitch                                                                                               |
| Music editor (piano roll) | **Yes**     |                                                                                                                                                    |
| Drum editor               | **Yes**     | Lane grid from a GM or pad-derived drum map                                                                                                        |
| Score editor              | **Partial** | Real engraving — duration fitting, ties, beaming, key-aware spelling, voices. Editing is done in the piano roll                                    |
| Audio editor              | **Yes**     | Waveform, plus Audio→Notes, Vocal Tune and stem separation                                                                                         |
| Automation editor         | **Yes**     | Lanes with five curve shapes, marquee point editing, read/touch/latch/write/trim                                                                   |

## 3. Editing and production

| Reference                     | MotionLab   |                                                                                                                                                 |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| MIDI recording                | **Yes**     | Count-in, capture from every input, held notes closed at the stop, clip rounded to the bar                                                      |
| Comping and take lanes        | **Yes**     | Swipe comping with micro-fades at the joins                                                                                                     |
| Non-destructive audio editing | **Yes**     | Trim, split, heal, fades, crossfades, gain, normalise, polarity, mono sum, slip, ripple delete, nudge                                           |
| Strip / insert silence        | **Yes**     | Over a range: strip silence, insert and delete time, cut/copy/paste, mute, fade, gain, reverse                                                  |
| Audio bend / warp             | **Partial** | Transient detection, tempo detection, tempo-follow, speed and transpose with pitch preservation. Per-marker warp dragging is not in the UI      |
| Groove extraction             | **Partial** | The model extracts and applies grooves; no UI surface yet                                                                                       |
| Vocal Tune                    | **Yes**     | Analysis, scale-aware correction, retune speed, vibrato preservation, rendered as a new clip                                                    |
| Audio → Note                  | **Yes**     | Monophonic and polyphonic                                                                                                                       |
| Stem separation               | **Partial** | Classical DSP, not a trained model — separates a well-recorded mix usefully and a dense one only partly. The stems always sum back to the input |
| Chord detection and Assistant | **Yes**     | Detection, functional suggestions with reasons, six progressions, four follow modes                                                             |
| Arranger sections             | **Yes**     |                                                                                                                                                 |
| Scratch pads                  | **Yes**     | Parallel arrangements over the same tracks, with copy in and out                                                                                |
| Note FX                       | **Yes**     | Arpeggiator, chorder, repeater, note filter, velocity curve                                                                                     |
| Event FX                      | **Yes**     | Per-clip note inserts, applied identically in playback and in export                                                                            |
| Instruments                   | **Yes**     | Virtual-analogue synth, quick sampler, drum rack, multisample, instrument rack                                                                  |
| Macro controls                | **Yes**     | Eight per track, each mapping several parameters with range and curve                                                                           |
| Effects                       | **Yes**     | 27 kinds across dynamics, tone, modulation, time, stereo and utility, with plugin faces                                                         |
| Automation                    | **Yes**     | Read, touch, latch, write, trim, off                                                                                                            |
| Mixdown and export            | **Yes**     | Master, stems by bus, per track; WAV 16/24/32-bit and float, FLAC; 44.1–96 kHz; TPDF and shaped dither; true-peak normalisation; metadata       |
| MIDI file import and export   | **Yes**     | Format 0 and 1 in, format 1 out, with the tempo and signature map                                                                               |
| Project merge                 | **No**      | Not built                                                                                                                                       |
| Key commands                  | **Yes**     | Editable, conflict-checked, restorable, and layout-independent                                                                                  |
| Control link (MIDI learn)     | **Yes**     | Learn by moving the control; absolute, relative and toggle modes, a settable range and invert                                                   |
| Themes                        | **Yes**     | System, dark, light, high contrast                                                                                                              |
| UI scaling                    | **Yes**     | 85% to 140%                                                                                                                                     |

## 4. Deliberately not attempted

Third-party plugin hosting (VST/AU/AAX), disc burning and DDP, proprietary control-surface
protocols beyond Web MIDI, and video scoring. Each is named in
[`REFERENCE-FSP8.md`](REFERENCE-FSP8.md) §4 with the reason.
