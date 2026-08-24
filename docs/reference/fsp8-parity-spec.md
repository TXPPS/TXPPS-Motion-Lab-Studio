# FSP8 parity spec

Directive 09 §1. The acceptance standard for Directive 09 §2 (recording) and §3
(UI and windows).

The reference is the **Fender Studio Pro 8 user manual** — 687 pages, read cover
to cover, not sampled. Every behaviour below was taken from the manual itself,
not from search-engine extracts, which is what makes this document different
from `docs/REFERENCE-FSP8.md` and is why that file's `[U]` and `[R]` claims are
now correctable against it. §6 lists the places where it turned out to be wrong.

## IP boundary

This is a reference document and nothing more. The reference product is named
here because provenance has to be citable. **No trademarked name — the host
product's, its manufacturer's, its bundled instruments', its effects', its file
formats' or its licensed third-party engines' — may appear in MotionLab or
Motion Wave UI strings, code identifiers, type names, filenames, preset names or
copy.** Where a behaviour is worth having, these documents name the _behaviour_;
the MotionLab name for it is invented fresh. Quotations are short, attributed,
and used only where the exact wording carries a rule or a number. See
`LEGAL_NOTES.md`.

The manual PDF itself is deliberately **not tracked** (`.gitignore`). It is a
vendor document this repository may not redistribute; these notes are the
tracked record of what it says.

## The chapters

| Document                                                     | Covers                                                                                                                                                                                                                                   | Manual lines             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [`fsp8-parity-setup.md`](fsp8-parity-setup.md)               | Audio device, **I/O channel mapping**, sample rate, buffer, MIDI devices, every option in General / Additional / Recovery / Advanced                                                                                                     | 719–2090                 |
| [`fsp8-parity-fundamentals.md`](fsp8-parity-fundamentals.md) | Transport controls, undo/redo, PDC, dropout protection, drag-and-drop, view options, performance monitor, retrospective recording, the Start page, Quick Switch                                                                          | 2091–3131                |
| [`fsp8-parity-shortcuts.md`](fsp8-parity-shortcuts.md)       | The key-command system and **204 harvested shortcuts**, swept from the whole manual, with MotionLab's current binding for each                                                                                                           | whole file               |
| [`fsp8-parity-recording.md`](fsp8-parity-recording.md)       | Arming, input selection, **mono vs stereo**, input gain and metering, **every monitoring mode**, latency compensation, cue mixes, take layers, loop record, punch, count-in, metronome, recording format                                 | 3132–4087                |
| [`fsp8-parity-editing.md`](fsp8-parity-editing.md)           | Mouse tools, snap and the grid, quantize, split/trim/fade/move/duplicate, undo semantics, comping, transients, freeze, inspectors, note editor, sound variations, patterns, macro toolbar                                                | 4088–8150                |
| [`fsp8-parity-windows.md`](fsp8-parity-windows.md)           | **A complete inventory of 113 FSP8 panels** — how each opens, resizes, docks, floats, collapses, and whether it is modal — beside an inventory of **111 MotionLab panes** with their file paths. Plus the Browser and Arranging chapters | 8905–11914 + sweep       |
| [`fsp8-parity-mixing.md`](fsp8-parity-mixing.md)             | Console strip order, sends, buses, groups, VCAs, the listen bus, metering, **pan law**, solo/mute including implicit mute, PDC, mixdown, and all of Automation                                                                           | 11793–14093, 15544–15957 |

## What the read changed about the plan

### The P0 diagnosis was confirmed from the manual, independently

The Recording chapter states in five separate recipes that a take ends on the
space bar or the Stop button. MotionLab's did not: `engine.stop()` never told
the recorder, so six routes to a stopped transport left MediaRecorder capturing.
That is Directive 09 §2.1, and it is **closed** — see `src/audio/transportStop.ts`
and `tests/transportStop.test.ts`.

### The three §2 items the manual makes concrete

1. **Input channels are a layer MotionLab does not have.** FSP8 interposes
   named, portable software channels between the hardware and the tracks, stored
   per computer and per driver, created explicitly as mono or stereo, with a
   default set of one stereo and two mono channels over the same hardware pair.
   MotionLab stores a raw browser `deviceId` on the track — origin-scoped,
   machine-specific, and silently unresolvable on another machine.
2. **Monitoring follows record-arm, by default, with a named switch.** FSP8 has
   four such switches (audio and instrument, monitoring-follows-arm and
   input-follows-selection). MotionLab has none, and arming a track today has
   _no audible or visible consequence at all_ — not even a moving meter — until
   the user finds a second button.
3. **What a mono input produces is undefined in MotionLab.** `inputManager`
   asks for `channelCount: { ideal: 1 }` — a hint, not a constraint — and
   nothing checks what came back or shows the user what was recorded.

### The §3 work list is now enumerated

113 reference panels against 111 MotionLab panes, and the near-equality is the
most misleading number in the audit: FSP8's are weighted toward windows (13
detachable, 8 documented for a second monitor, 17 keyboard-addressable),
MotionLab's toward inline strips and disclosures inside four fixed panes. The
gap is structural. The cheapest high-value item is that **no keyboard shortcut
opens any pane**, while `workspaceStore`'s `toggle`/`reveal`/`setMaximized` API
already exists and is already correct.

## §6 — where the manual corrects `docs/REFERENCE-FSP8.md`

That file was assembled from search-engine extracts because the manual was not
fetchable from the previous environment, and it marks its own uncertainty. Now
that the manual has been read, six of its claims are wrong and one is wrong
about our own code. They are listed in
[`fsp8-parity-mixing.md` §14.1](fsp8-parity-mixing.md); the load-bearing ones:

- The channel strip's I/O selectors are at the **top**, not the bottom.
  MotionLab currently follows the error.
- The metering scales are **exactly three** — K-20, K-14, K-12. No True Peak, no
  R128.
- The Main Out does **not** have a second post-fader insert rack; the only
  post-fader rack belongs to the listen bus.
- Gain-reduction metering on the channel strip is not described anywhere in
  Mixing or Metering.

One genuine parity win the read confirmed rather than assumed: the manual states
a **−3 dB pan law**, and Web Audio's `StereoPannerNode` is spec-defined
constant-power, −3.01 dB at centre. MotionLab inherited it rather than choosing
it, which is recorded here so that nobody later "fixes" it.

## Gap vocabulary

Every behaviour in the chapter documents carries exactly one:

- **`PARITY`** — MotionLab does what the reference does.
- **`PARTIAL`** — some of it, or on a different control.
- **`MISSING`** — absent, with the grep that established it named.
- **`DIVERGENT-BY-DESIGN`** — deliberately different, with the reason. Usually
  the browser cannot perform the native mechanism, in which case the benchmark
  is functional parity of the _workflow_, per `docs/REFERENCE-FSP8.md` §0.
