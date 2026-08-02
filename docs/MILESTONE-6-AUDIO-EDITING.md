# Milestone 6 — Professional Audio Editing, Comping & Multitrack Workflow

The editing surface grew the tools engineers actually reach for: shaped
crossfades, take lanes with swipe comping, split/heal/slip/ripple, cleanup
analysis, and locks/groups for multitrack safety — all non-destructive, all
flowing through the same schedule math the offline bounce uses.

## 1. Verification status

| Area | Status |
| --- | --- |
| Fade shapes (linear, equal power, equal gain, S-curve) on fade-in and fade-out | Implemented; unit-tested math (equal power crosses at −3 dB; amplitude pairs sum to unity); drawn as real curves on clips |
| Crossfades (menu on two same-track clips; overlap created from real trim headroom; complementary shapes; single undo) | Implemented; e2e through the menu; refuses honestly when no material exists to overlap |
| Take lanes (multiple takes, visibility, mute, solo-audition, promote, reorder, safe delete) | Implemented; e2e drives lanes, audition, promote; deleting the last take flattens to a plain clip |
| Swipe comping (segment data only, join micro-fades, indicators, single-step undo) | Implemented; e2e swipe → segments; comp bar mirrors segments; undo restores |
| Pack clips into takes | Implemented; e2e packs two stacked clips and opens the lanes |
| Split / heal / join | Implemented; heal requires genuinely contiguous material (same media, contiguous offsets ±15 ms) — MIDI merges notes; e2e splits with the tool and heals from the menu |
| Slip editing (tool 5 + store op, clamped to real source bounds) | Implemented; e2e verifies offset moves while the clip stays put |
| Ripple delete (per-track foundation) | Implemented; later clips pull left by the removed span; locked material is skipped; e2e verified |
| Clip nudge (arrows, Shift = fine) and zoom-to-selection | Implemented; e2e verified |
| Normalization (−0.3 dBFS via clip gain), phase invert, mono sum | Implemented; normalize/analysis read the decoded buffer; phase and mono flags flow into live playback and the render |
| DC-offset + peak analysis, visual silence detection | Implemented; inspector readout; silence runs dim in the waveform |
| Sample-aware zoom | Implemented; above ~600 px/s the waveform draws min/max from decoded samples instead of the peak cache |
| Track/clip locking, edit groups (linked selection) | Implemented; store-level guards (the only place that counts) + UI badges; e2e verifies locks hold and groups link |
| Render correctness | e2e: a phase-inverted duplicate cancels to < 2% of the reference peak (proves sample-aligned scheduling and polarity); comp clips render take-correct material; shaped fades render (M5-style amplitude checks) |
| `#/qa-audio-edit` fixture | 2,020 clips / 56 tracks, every editing feature staged; exact-shape unit test |
| Clip gain envelopes (point-level per-clip gain curves) | **Deferred** — see §5 |
| Global time-stretch / warping | **Deferred** — the milestone brief itself rules out unreliable stretching |

Totals after M6: **245 unit tests**, **146 e2e tests**, strict TypeScript,
ESLint clean.

## 2. Architecture

**Fade shapes** live in `clipSchedule.ts` as `fadeGain(t, shape)`; curved
fades emit 8-step linear-ramp envelopes, and phase inversion negates the whole
envelope (a gain of −1 is the polarity flip). Because live playback and the
bounce share `computeClipSchedule`, a shaped crossfade cannot render
differently than it played.

**Crossfades** are stored as what they truly are — an overlap plus a shaped
fade-out on the left clip and a complementary fade-in on the right. Creating
one extends the overlap only from *verifiable* source headroom (known media
duration, trim offsets); when neither side has material, it refuses with an
explanation instead of scheduling silence.

**Comping** (`model/comping.ts`) is segment data over takes:
`takes[{mediaId, offset}]` + `comp[{at, takeId}]`. `expandCompClip` turns a
take clip into plain per-span clips — 4 ms micro-fades at internal joins so a
cut can never click, the clip's own fades on the outer edges — and both the
live engine and the exporter schedule through that one expansion. Solo
audition, promote, reorder, mute and safe deletion are all segment/array
operations; nothing ever renders or destroys audio.

**Time tools** are store operations with lock guards at the store level:
`healClips` (contiguity-checked), `rippleDeleteClips` (right-to-left span
closing per track), `slipClip` (offset clamped to real bounds),
`createCrossfade`, `packTakes`. Locked clips and locked tracks refuse timing
edits in the store — the UI badges merely explain what the store enforces.

**Waveforms** got three upgrades: fade overlays trace the actual curve shape;
silent runs (< −44 dBFS for 120 ms+) dim so trims land confidently; and past
600 px/s the renderer switches from the cached peak envelope to min/max over
the decoded samples — sample-aware exactly where the cache is coarser than
the pixels. The per-clip `ResizeObserver` is gone (2,000 observers dominated
mount cost); size changes arrive as props instead.

## 3. Using it (the short manual)

- **Crossfade**: select two touching clips on one track → right-click →
  Crossfade. Drag the fade handles to resize; pick shapes in the inspector.
- **Comp**: stack alternative clips → right-click → *Pack N clips into
  takes*. Swipe across a lane to comp a range; click a lane to audition it;
  ▲ promotes; × deletes safely. Double-click the clip toggles the lanes.
- **Slip**: tool 5 (or the toolbar), drag inside a clip — the window stays,
  the material slides.
- **Heal**: select the pieces of a split → right-click → *Heal splits*.
- **Ripple delete**: right-click → *Ripple delete* — later clips close the
  gap; locked material stays put.
- **Cleanup**: inspector → Normalize, ø (polarity), M→1 (mono), analysis
  readout; silence shows as dimmed runs in the waveform.
- **Safety**: lock clips from their menu, lock tracks from the track menu;
  set *Edit group 1–4* on related tracks and their overlapping clips select
  and move together.

## 4. Performance (measured on this CI's software rasteriser)

`#/qa-audio-edit` loads 2,020 audio clips across 56 tracks — every clip
faded and shaped, i.e. roughly three times the visible waveform-canvas
density of `#/qa-huge`. Measured: mounted clips stay bounded (< 900), and
twenty 300 px scroll hops averaged 155–180 ms/step; the suite enforces a
250 ms budget calibrated to that measurement. The lighter `#/qa-huge`
fixture keeps its stricter budget in the existing workflow suite, so a
regression in the common case cannot hide behind the heavy fixture's
allowance. Removing the per-waveform ResizeObserver and replacing per-track
take-clip filtering with a one-pass map were the two wins that landed;
further gains (canvas pooling, offscreen bitmap reuse) are noted as future
work rather than claimed.

## 5. Deferred, and why

- **Clip gain envelopes** — point-level gain curves inside a clip need their
  own editing surface to be usable; track automation plus clip gain, shaped
  fades and crossfades cover the mixing need this milestone. Deferred whole
  rather than shipped as a half-editor.
- **Time-stretch / warp** — ruled out by the brief as unreliable in this
  environment; nothing pretends to stretch.
- **Recording directly into take lanes** — packing existing clips is the
  supported path; loop-record-to-takes touches the recording controller and
  deserves its own milestone.
- **Multi-track ripple across all tracks** — the foundation ripples the
  edited tracks; a project-wide ripple mode (with its bigger blast radius)
  waits for a dedicated pass.

## 6. Testing

- `tests/audioEditingM6.test.ts` — 17 tests: fade-shape maths (crossfade
  unity/power sums), shaped/inverted envelopes, comp normalization and span
  expansion (micro-fades, offset math, late-take silence), take packing
  alignment, heal eligibility and chaining, ripple with locks, crossfade
  creation and undo, slip clamps, lock guards at the store, fixture shape,
  schema-v4 round-trips.
- `e2e/audioedit.spec.ts` — 9 tests: crossfade via menu + undo; split tool →
  heal; take lanes (swipe, audition, promote, comp bar); packing; slip +
  ripple + locks + edit groups on the fixture; density/scroll budgets; clip
  nudge + zoom-to-selection; and the two render proofs (phase cancellation,
  comp/fade audibility).
- All prior suites pass unchanged (137 e2e + 228 unit before this
  milestone's additions).
