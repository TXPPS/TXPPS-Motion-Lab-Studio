# Parity spec — FSP8 "Editing" chapter vs MotionLab Studio

**Directive 09 §1 · Research Analyst chapter deliverable**

- **Source:** Fender Studio Pro 8 user manual, chapter *Editing*, extracted text
  lines 4088–8095 (`scratchpad/fsp8.txt`). Read cover to cover.
- **Target:** MotionLab Studio web DAW, `src/` on branch
  `claude/motionlab-studio-poc-3l1gwa`.
- **Gap key:** `PARITY` · `PARTIAL` · `MISSING` · `DIVERGENT-BY-DESIGN`.

**IP boundary.** This is a reference document. Quotations are attributed to the
FSP8 manual and used only where a paraphrase would lose a number or a rule. No
trademarked name in this document — the host product's name, its bundled
instrument and effect names, its file-format names, or the names of third-party
engines it licenses — may be carried into MotionLab UI strings, type names,
symbol names, preset names or filenames. Where a behaviour is worth having, this
document names the *behaviour*; any MotionLab name for it must be invented
fresh. See `LEGAL_NOTES.md`.

---

## 1. Events

### 1.1 Event taxonomy

1. **FSP8 does.** Three material objects on the timeline. *Audio Events*
   (waveform, audio tracks only); *Audio Parts* — "Events that contain multiple
   Audio Events"; *Instrument Parts* (note data, instrument tracks only).
   Collectively "Events". Editing happens in both Arrange view and Edit view.
2. **MotionLab does.** `src/model/types.ts` defines `Clip = AudioClip | MidiClip`
   over a shared `ClipBase` (`id`, `trackId`, `name`, `start`, `length`, `muted`,
   `locked?`, `color?`, `eventFx?`). Track types are
   `audio | instrument | drum | bus | fx | folder | vca`. There is **no container
   clip** — nothing holds several audio clips as one object. Grepped
   `audioPart`, `consolidate`: no hits in `src/`.
3. **Gap.** `PARTIAL` — the two leaf kinds exist and are first-class; the
   composite (Audio Part) does not. Consequences propagate into §5.9, §5.12,
   §11.14, §12.9.

### 1.2 Event contextual menu

1. **FSP8 does.** Right-click any Event opens a menu grouping "all related
   Editing actions, logically grouped", headed by the editable Event name and a
   colour bar, and carrying a **Recent Items** list of "the five most-recently
   used actions". Menu contents differ for Audio Events vs Instrument Parts.
2. **MotionLab does.** `src/components/arrangement/ClipView.tsx` builds a
   context menu with: Open in Piano Roll, Rename…, Copy, Cut, Duplicate, Split at
   playhead, Clip gain…, Clear fades, Mute/unmute, Crossfade (equal power),
   Crossfade (linear), Pack N clips into takes, Heal splits, Normalize to
   −0.3 dB, Strip silence, Phase invert, Mono sum, Show/Hide take lanes, Ripple
   delete, Delete. Items are conditioned on clip type and selection size. Long
   press opens it on touch.
3. **Gap.** `PARTIAL` — type-conditioned menu with a comparable action set; no
   MRU list, no inline colour bar, no inline name field (rename is a dialog).

### 1.3 Event naming

1. **FSP8 does.** Double-click the name in the context menu to rename. Renaming
   a **Track** and holding `[Shift]` while pressing `[Enter]` renames **all
   Events on that track**.
2. **MotionLab does.** `Rename…` opens a prompt dialog. Track rename in
   `src/components/arrangement/TrackHeader.tsx` renames only the track.
3. **Gap.** `PARTIAL` — per-event rename yes; the Shift+Enter cascade is absent.

### 1.4 Event colour

1. **FSP8 does.** Click the colour bar next to the Event name and pick, or
   scroll the mouse wheel through colours.
2. **MotionLab does.** `ClipBase.color?` exists and `ClipView` renders it —
   `--clip-bg` mixes the clip colour, falling back to the track colour. No UI
   writes it; grepped `setClip` + `color` across `src/components/`: no hit.
3. **Gap.** `PARTIAL` — model and renderer done, control missing. Cheapest gap
   in the chapter.

### 1.5 Tool and Event snapping — **directive focus**

1. **FSP8 does.** Snap is on by default; the Snap to Grid button disengages it;
   holding `[Shift]` while moving the mouse temporarily defeats it. **Four base
   modes:**
   - **Adaptive** (default) — "snapping occurs at the nearest logical subdivision
     of the current Timebase, based on the current timeline zoom level."
   - **Bar** — nearest musical bar line.
   - **Quantize** — nearest subdivision of the current Quantize Setting.
   - **Frames** — nearest frame subdivision.

   **Six optional behaviours**, combinable with any of the four:
   - *Snap to Cursor and Loop* — snap to the playback cursor and loop locators.
   - *Snap to Events* — snap relative to Events in the arrangement.
   - *Snap to Zero Crossings* — "ensures that the audio data in an Event will
     snap to a zero crossing point… help avoid an unnatural click".
   - *Snap to Grid* — engaged by default.
   - *Snap Event End* — "enables snapping on both the start and end of the moved
     Event. (When disabled, only the event start snaps.)"
   - *Relative Grid* — "maintains the time relationship relative to the grid …
     the snap position maintains the original position relative to the grid,
     instead of snapping directly to the grid."

   The Audio Editor adds **Snap to Event Hotspots** (bend markers) and keeps its
   own Snap and Timebase, independent of the Arrange view.
2. **MotionLab does.** `src/model/snap.ts` — a five-value union
   `SnapMode = 'off' | 'grid' | 'events' | 'zeroCrossing' | 'adaptive'`, all
   pure, plus a separate grid size in beats in `uiStore.snap`. The
   `Arrangement.tsx` toolbar exposes **four** of the five (grid, adaptive,
   events, off — `zeroCrossing` is implemented and unexposed) plus a grid segment
   Bar / 1/4 / 1/8 / 1/16 / Off, where Bar comes from the tempo map.
   `adaptiveGridBeats()` walks note steps `[0.25, 0.5, 1, 2]` beats then bar
   steps `[1, 2, 4, 8]` bars and returns the finest at least
   `MIN_SNAP_PX = 12` px wide; bars come from `beatsPerBarAt`, so "a 3/4 section
   snaps to three-beat bars while the 4/4 around it snaps to four".
   `EVENT_SNAP_PX = 10` sets the event pull. `snapSecondsToZeroCrossing` searches
   ±`searchMs` (default 10 ms) for the nearest **rising** crossing and returns
   the input unchanged on failure. Modes lacking their input return the position
   unchanged rather than silently falling back to the grid. Shift bypasses snap,
   re-checked per pointer move so it "can be pressed and released mid-drag".
3. **Gap.** `PARTIAL`, and the richest single gap in the chapter.
   - **Equal:** off, grid, adaptive, events, zero-crossing, Shift bypass,
     tempo-map-aware bar, adaptive-from-zoom.
   - **Structurally different:** FSP8 is 4 modes × 6 orthogonal toggles;
     MotionLab is 5 mutually exclusive modes. Zero-crossing therefore cannot be
     combined with the grid — the combination that matters most.
   - **Missing:** Frames timebase; Snap to Cursor and Loop; **Snap Event End**;
     **Relative Grid**; Snap to Event Hotspots; per-editor independent snap
     *mode* (the piano roll has its own grid `prSnap` but not its own mode).
   - **Missing exposure:** `zeroCrossing` is unreachable from the toolbar.

### 1.6 Spot

1. **FSP8 does.** Context-menu numeric relocation. Timebase selectable from
   **Samples, Seconds, Bars, Frames** regardless of the session timebase. Fields
   for **Start, Sync Point, End**; click to type or click-drag to scrub. A
   multi-selection keeps its internal relative positions (earliest start /
   latest end anchor). Imported files with timestamps restore via an "Original
   Position" icon. `[Alt+Shift]` on drag-import spots on import.
2. **MotionLab does.** Absent. Grepped `Spot`, `originalPosition`: the only
   `Spot` hits are unrelated substring matches. The inspector also has no numeric
   Start/End for clips (§14.2).
3. **Gap.** `MISSING`.

### 1.7 Detect Tempo / Extract to Tempo Track

1. **FSP8 does.** *Detect Tempo* analyses the file and aligns its timing to the
   session tempo (requires timestretch enabled in the Track Inspector); a marker
   lands on the first detected downbeat and **becomes the event's sync point**,
   so moving the event snaps that downbeat to the grid. *Extract to Tempo Track*
   applies the file's timing variation to the session tempo map so the session
   follows the performance's feel.
2. **MotionLab does.** `src/model/transients.ts` — `estimateTempo()`,
   `analyseTransients()` (`MIN_DETECT_BPM = 60`, `MAX_DETECT_BPM = 200`,
   `snapTempoPhase()`), driven from
   `src/components/inspector/TimePitchPanel.tsx`: one analysis pass writes
   `clip.transients` and, at `confidence > 0.3`, `clip.sourceBpm`; the toast
   reports count, BPM and confidence or "tempo unclear". `WarpTool.tsx` has a
   `Detect` button doing the same for the warp map. Nothing writes detected
   variation into the project tempo map — `setTempoEvent` / `moveTempoEvent`
   exist on the store but no clip analysis calls them.
3. **Gap.** Detect Tempo → `PARTIAL` (detects and stores clip tempo; no downbeat
   marker, no sync point). Extract to Tempo Track → `MISSING`.

### 1.8 Extract Note / Extract Drum

1. **FSP8 does.** *Extract Note* creates a new instrument event with a bundled
   synth preloaded with a chord-preview preset; *Extract Drum* the same into a
   bundled drum instrument with a drum preset. Dragging an Audio Event onto an
   Instrument Track raises a dialog asking Drums or Notes.
2. **MotionLab does.** `src/model/audioToMidi.ts` — `audioToNotes()` with
   `AudioToNotesMode = 'mono' | 'poly'`, `analysePitchTrack()`,
   `detectedNotesToNotes()`; driven from `AudioEditor.tsx` (`tool === 'notes'`)
   with a quantize grid applied on extraction, and UI copy separating "One voice
   at a time: a vocal, a bass, a lead line" from "Chords and simple polyphony —
   not a dense mix".
3. **Gap.** `PARTIAL` — note extraction present and arguably deeper (mono/poly
   plus quantize-on-extract). Missing: drum-specific extraction, auto-loaded
   instrument + preset, and the drag-onto-instrument-track gesture with its
   Drums/Notes dialog.

### 1.9 Stretching Parts from the edge

1. **FSP8 does.** Hold `[Alt]` and drag either edge of an **Instrument Part** to
   stretch it; automation inside stretches with it unless *Select Part Automation
   with Notes* is off. The same gesture on an **Audio Event** timestretches (§10).
2. **MotionLab does.** Edge drags in `ClipView.tsx` (`dragLeft`, `dragRight`)
   **trim**, never stretch: audio via `trimClipStart` / `trimClipEnd`, MIDI via
   `resizeClip`. No `altKey` branch on either handle. MIDI stretch exists only as
   a piano-roll command (`stretchNotes` behind "Double length (×2)" / "Half
   length (÷2)").
3. **Gap.** `MISSING` for the gesture, on both clip types.

### 1.10 Sync Points

1. **FSP8 does.** A per-Event marker used as the snap reference instead of the
   event's start/end — for a percussion loop with a mid-loop transient, or a
   riser that must land near but not at its end. Set via *Events → Set Sync Point
   to Cursor*; a white vertical line with a yellow diamond on hover; drag the
   diamond to move it. Zoomed out, "Sync Points will automatically snap to
   transients when moving. Zoom in to bypass this behavior", or disable snap
   `[N]`, or hold Shift. *Toggle Sync Point* enables/disables it. Sync points are
   "non-destructive and flexible, meaning a Sync Point's position is maintained
   if an Event is Reversed or Bounced", participate in event-to-event snapping
   under *Snap To Events*, obey the Snap dropdown mode, and redirect *Cursor
   Follows Edit Position* to the sync point rather than the clip start.
2. **MotionLab does.** Absent. Grepped `syncPoint`, `hotspot`: no hits. The
   nearest concept is a warp marker (`WarpMarker`, `src/model/warp.ts`), which
   pins source time to musical time for stretching — a different job.
3. **Gap.** `MISSING`. Note the dependency: the sync point is the anchor several
   other FSP8 behaviours reference, so it is a prerequisite, not a leaf.

### 1.11 Event icons

1. **FSP8 does.** Badges at an Event's bottom-left:
   - **Gear** — timestretch enabled, *or* clip sample rate ≠ session rate, *or*
     transpose/tune changed.
   - **Mute** — muted; `[M]` mutes, `[Shift]+[M]` unmutes.
   - **Time Lock** (circle-slash clock) / **Edit Lock** (circle-slash pencil);
     both together → a padlock.
   - **Event FX** — an effect on this event alone; the same icon marks an ARA
     effect.
   - **Chain** — audio events consolidated into a nested unit (`[G]`).
   - **Ghost** — shared duplicates; edits propagate. `[Shift]+[D]`.
   - **Folder** — the event belongs to a folder track (*Pack Folder*).
   - **Layer** — several recorded takes, or several pattern variations.
2. **MotionLab does.** `ClipView.tsx` renders inside `.clip-name`: `🔒` locked,
   `◇` muted, `▤{n}` take count, `ø` polarity invert, `M` mono sum — plus a
   `.clip-comp-bar` strip showing comp segmentation coloured per take.
3. **Gap.** `PARTIAL` — five badges vs eight, overlapping only on mute, lock and
   layer. No gear (stretch/transpose state is invisible on the clip), no
   event-FX badge although `eventFx` exists, no chain, no ghost, no folder.
   MotionLab adds two FSP8 lacks (polarity, mono sum) and the comp bar, which is
   more informative than a layer badge.

---

## 2. Arrange View Mouse Tools — **directive focus**

FSP8: right-click empty space in Arrange or Edit view lists the tools; middle
click / scroll-wheel click shows an expanded list "including all of the Paint
tool shapes". Number keys select tools in toolbar order.

### 2.0 Link button

1. **FSP8 does.** A bracket-shaped button left of the toolbar combines the Arrow
   and Range tools: above the event's horizontal centre line the pointer is the
   Range tool, below it the Arrow tool. "This combination of tools is available
   at track heights of Normal or higher."
2. **MotionLab does.** Absent as a mode, but the behaviour is partly built in
   unconditionally: `Arrangement.tsx` hit-tests `tool === 'range'` explicitly,
   and the pointer tool marquee-selects clips on empty lane space. There is no
   half-height split of a clip's own body between range and arrow, and no toggle.
3. **Gap.** `MISSING`.

### 2.1 Arrow tool `[1]`

**Move.** FSP8: click anywhere on the event and drag left/right (time) or
up/down (to another track of the same type; "If the Event is dragged to a
position where no Track currently exists, Fender Studio Pro creates a new Track
of the same type"). Holding `[Space Bar]` while dragging past the viewport
speeds the scroll. Cross-track drags are constrained to the same time position
inside an automatic snapping range; Shift defeats that.
MotionLab: `ClipView.dragMove` — single clip moves freely in both axes via
`moveClip(id, beats, targetTrack?.id)` where `laneAt(e.clientY)` resolves the
lane; a multi-clip selection moves by one shared beat delta through
`moveClipsBy`, clamped so "the earliest clip cannot cross zero — the group
compresses nowhere, it just stops at the wall together", and lane changes are
deliberately single-clip only ("moving many clips across heterogeneous track
types has no predictable meaning"). Edge auto-scroll exists (`onEdgeScroll`,
`EDGE_ZONE = 48`, `EDGE_MAX = 22`).
→ `PARTIAL`: no track auto-creation on drop past the last lane, no vertical snap
lock with Shift release, no spacebar scroll accelerator; group vertical movement
is intentionally refused.

**Size.** FSP8: hover an edge to reveal the Sizing tool; drag; nondestructive and
repeatable. Two adjacent events can be sized together from the junction "where
you can see the sizing icon with both left and right arrows illuminated", so no
gap opens. `[Alt]` + right-edge size = free timestretch.
MotionLab: `.clip-edge l` / `.clip-edge r` handles, hidden when locked; audio
trims consume source, MIDI resizes. Minimum length is `snap || 0.25` beats. No
junction handle, no Alt-stretch.
→ `PARTIAL`.

**Audio Event volume envelope + fades.** FSP8: every Audio Event carries a
volume envelope — a fade-in flag, a fade-out flag and a constant level box
between them, applied "at the front end of the audio signal path". Drag a Fade
Flag for a linear fade; drag the Fade **Curve** box up/down to shape it;
`[Shift]` while editing edits length and curve at once (vertical = curve,
horizontal = length). A whole crossfade can be dragged: hover its centre for the
Hand icon, drag left/right to move the fade (extending/shortening the two
events), up/down to alter its shape. Drag the centre volume box up/down for
overall event gain, and "the audio waveform is redrawn to approximate the effect
of the adjustment". Adjusting one of several selected events normally applies to
all; `[Alt]` isolates one without losing the selection.
MotionLab: `.fade-handle in` / `.fade-handle out` drag handles on audio clips
(hidden when locked) writing `setClipFades`; shape is a discrete enum
`FadeShape = 'linear' | 'equalPower' | 'equalGain' | 's'` set from a menu, with
the crossfade-summing property documented on the type ("linear, equalGain and s
sum to constant amplitude; equalPower (sin/cos) sums to constant power (−3 dB at
the midpoint)"). Clip gain is a scalar `gain` set from a "Clip gain…" dialog or
`Normalize to −0.3 dB`. `Waveform.tsx` receives `gain`, `fadeIn`, `fadeOut`,
`fadeInShape`, `fadeOutShape` and redraws accordingly — the picture is drawn
from the same values the audio uses. Keyboard: `,` / `.` shorten/lengthen fade
in, `Shift+,` / `Shift+.` fade out.
→ `PARTIAL`: fades, shapes, gain and the redrawn waveform are all present and
the shape set is better specified than FSP8's free curve. Missing: continuous
curve dragging, Shift-combined length+curve editing, whole-crossfade drag with
the Hand cursor, and Alt-isolate within a multi-selection.

**Select multiple.** FSP8 lists five gestures: marquee from empty space;
`[Shift]`+click to add; `[Alt]+[Shift]+[Home]` / *Edit/Select/Select from Start
to Event* (all tracks) and `[Shift]+[Home]` (current track); the End variants;
and `[Shift]`+double-click a track's timeline to select every event on it.
MotionLab: marquee from empty lane space; Shift/Ctrl/Cmd click toggles
(`toggleClipSelection`); `Ctrl+A` selects all clips. No select-to-start,
select-to-end, or select-all-on-track.
→ `PARTIAL`.

**Select a range with the Arrow tool.** FSP8: hover the upper half of a track,
the cursor becomes a crosshair, drag to select a range — enabled/disabled by the
Link button.
MotionLab: requires switching to the Range tool `[2]`.
→ `MISSING` (see §2.0).

**Alternate uses.** FSP8: `[Ctrl]/[Cmd]` = Alternative Tool (a user-chosen one of
Range, Split, Eraser, Paint, Mute, Bend, Listen, picked from a dropdown under
the Arrow tool or cycled by repeatedly pressing `[1]`; "The currently-active
Alternative Tool is highlighted with a blue underline"). `[Ctrl]+[Alt]` over an
event = Slip. `[Ctrl]+[Alt]` over an event **edge** = Define Tempo.
MotionLab: `Ctrl`/`Cmd` on a clip is *add to selection*, not a tool modifier.
Slip is a separate tool `[6]`. Define Tempo has no gesture.
→ `MISSING` for all three, and the Ctrl binding is already taken by a different
meaning, which is a design decision to make rather than a hole to fill.

### 2.2 Range tool `[2]`

1. **FSP8 does.** Drag to select an area within events; "The range you have
   selected is now treated as a single, consolidated Event." A single click moves
   the play cursor. Hovering a selected range temporarily gives the Arrow tool.
   `[Shift]` collects multiple non-contiguous ranges, and the manual spells out
   the compound gesture: "if you press and hold [Ctrl], you get the Range tool.
   Press and hold [Ctrl] and [Shift] to select multiple ranges, then continue to
   hold [Shift] but release [Ctrl]; now you have the Arrow tool and can select
   whole Events. All of your selections remain selected." Double-click splits an
   event in half at that point; double-clicking a selected range splits at both
   borders. Range selections snap under Snap to Grid; Shift reverses it.
   Selected ranges are resizable from their edges. *Split Range* =
   `[Ctrl]+[Alt]+X`. `[Alt]` temporarily gives the Arrow tool.
2. **MotionLab does.** `uiStore.range = { fromBeat, toBeat, trackIds }` — kept
   beside `selectedClipIds` because "a range covers whatever is inside it,
   including parts of clips". `src/model/rangeEdits.ts` is a complete pure
   range-edit module: `splitClipsAtRange` (the primitive — "Once both edges are
   cut, the range is covered by whole clips, and delete / crop / duplicate / fade
   are all 'keep or drop or move these whole clips', which is why they agree with
   each other at the boundaries"), `deleteRange` (with ripple),
   `insertSilence`, `copyRange`, `pasteRangeAt`, `duplicateRange`, `cropToRange`,
   `fadeRange`, `stripSilence`. Every function is total and reports locked
   material rather than editing it (`lockedClipIds`, `lockedTrackIds`). The range
   context menu offers: Split at the edges · Clear · Delete and close the gap ·
   Insert silence · Copy · Cut · Paste here · Duplicate · Crop the song to this
   range · Fade in across the range · Fade out across the range.
3. **Gap.** `PARITY` on the *operations* — MotionLab's range-edit set is at least
   as complete and is better factored. `PARTIAL` on the *gestures*: no
   multi-range selection, no hover-to-Arrow, no double-click split, no
   resize-from-edge, no click-to-locate, no Alt-to-Arrow, no Ctrl-to-Range from
   the Arrow tool.

### 2.3 Split tool `[3]`

1. **FSP8 does.** Draws a vertical line at the cursor time and a horizontal line
   underscoring the target track. Obeys Snap. Click splits at that position;
   with several events selected across tracks it splits all of them the same way.
   `[Alt]+[X]` splits the selection at the timeline cursor without the tool, and
   with a time range selected `[Alt]+[X]` splits the range into a new event.
   **Splitting Instrument Parts:** notes crossing the split are truncated and
   "no longer play in the newly created Part to the right"; hold `[Alt]/[Opt]`
   while splitting to **split the notes** rather than truncate them. `[Alt]`
   temporarily gives the Arrow tool.
2. **MotionLab does.** Tool `split` (`[3]`), acting on pointer-down at the
   snapped position under the cursor via `splitClip(id, at)`; a failed split
   toasts "Click inside the clip, away from its edges." Keyboard `Ctrl+E` splits
   the selected clip at the playhead; the clip menu has "Split at playhead". The
   range menu has "Split at the edges" (`rangeSplit`), which is the `[Alt]+[X]`
   range behaviour. Locked clips refuse and toast.
3. **Gap.** `PARTIAL` — split at cursor, at playhead and at range edges are all
   present; multi-clip split with the tool, the crosshair guide lines, and the
   `[Alt]` note-splitting variant are not.

### 2.4 Eraser tool `[4]`

1. **FSP8 does.** Click an event to delete it; clicking one of several selected
   events erases all of them; **click and drag across events to erase each one
   you touch**. `[Alt]` gives the Arrow tool.
2. **MotionLab does.** Tool `erase` (`[4]`): pointer-down calls
   `deleteClip(clip.id)` — one clip, no drag sweep, no multi-selection
   propagation, and it acts on the clip under the pointer rather than on the
   selection.
3. **Gap.** `PARTIAL`.

### 2.5 Paint tool `[5]`

1. **FSP8 does.** Two jobs in Arrange view. (a) Create an empty Instrument Part:
   click-drag an empty instrument lane; a plain click makes one "that varies in
   length according to the current timebase setting". (b) Create/edit an Audio
   Event **Gain Curve**. The menu arrow under the icon reveals eight shapes:
   **Freehand, Line, Parabola, Square, Triangle, Saw, Sine, Transform**. While
   drawing a waveform shape, `[Alt]` adjusts its frequency, `[Ctrl]` varies
   amplitude and polarity, `[Ctrl]+[Alt]` slides the shape along the timeline.
   Drawing new points overwrites existing ones.
2. **MotionLab does.** Tool `paint` (`[7]` in MotionLab's order): drags an empty
   instrument or drum lane to draw a MIDI clip. `src/model/arrangeTools.ts`
   `paintSpan()` computes the clip a gesture asks for, snapping **both** ends
   through the caller's snap function rather than rounding locally — "a paint
   drag has to land exactly where a clip drag would land, or the tool is lying
   about the grid" — with `clickLength` for a gesture that never moved and
   `minLength` so "a twitch cannot make a zero-length one". Painting onto an
   existing clip toasts "Paint draws on empty lane space — there is a clip here."
   No shapes, no gain curve.
3. **Gap.** `PARTIAL` for (a) — the part-drawing half is present and its snap
   discipline is stronger than the manual describes. `MISSING` for (b) and for
   the whole shape palette. (Shapes do exist elsewhere: automation lanes have a
   curve system, `src/model/automation.ts` `CurveShape`.)

### 2.6 Mute tool `[6]`

1. **FSP8 does.** Click to mute/unmute an Audio Event, Audio Part or Instrument
   Part; muted events grey out with an "m" badge. Click and drag to mute several;
   clicking one of a multi-selection mutes all of them. *Edit/Select/Select Muted
   Events* then Delete clears unused material. `[Alt]` gives the Arrow tool.
2. **MotionLab does.** Tool `mute` (`[5]` in MotionLab's order): pointer-down
   toggles `setClip(id, { muted: !clip.muted })` on the clip under the pointer.
   Muted clips render `◇` and a dimmed style. No drag sweep, no selection
   propagation, no Select Muted Events.
3. **Gap.** `PARTIAL`.

### 2.7 Bend tool

1. **FSP8 does.** Manipulates, adds and removes Bend Markers in the arrangement
   (full behaviour in §12).
2. **MotionLab does.** No arrangement-level bend tool. Warp marker editing lives
   in the Audio Editor's Bend/Warp tool (`src/components/audioeditor/WarpTool.tsx`),
   reached by opening a clip in the editor.
3. **Gap.** `PARTIAL` — the capability exists one level down; the arrangement
   gesture does not.

### 2.8 Listen tool

1. **FSP8 does.** Click and hold any track to instantly solo it and start
   playback from the point clicked; playback continues while held; release stops
   it and un-solos.
2. **MotionLab does.** Tool `listen` (`[8]`): `listenHold` in `ClipView` calls
   `engine.previewClip(clip.id, beatUnderPointer)` on press and
   `engine.stopPreview()` on release. Deliberately different: "The preview runs
   beside the transport — it never seeks and never starts or stops playback — so
   pressing a clip while the song is running adds it to what is already sounding
   rather than taking the song over." Works on locked clips, since "Listening is
   not editing". `pointerup`, `pointercancel` and window-blur all reach `onEnd`.
3. **Gap.** `DIVERGENT-BY-DESIGN` — preview-beside-transport instead of
   solo-and-transport-takeover. The MotionLab comment states the reasoning and it
   is the better behaviour for a web app where the transport may be shared with a
   recording pass. Worth recording as a deliberate divergence rather than closing.

### 2.9 Zoom tool — MotionLab-only

1. **FSP8 does.** No dedicated zoom mouse tool; zoom is keyboard and
   timeline-drag (§24).
2. **MotionLab does.** Tool `zoom` (`[9]`): "drag across to zoom, down for taller
   tracks, click to step in". `arrangeTools.ts` gives it exact maths:
   `zoomFactorFromDrag(dx) = 2^(dx / 220)` so "every ZOOM_DRAG_PX to the right
   doubles, every ZOOM_DRAG_PX to the left halves"; `laneScaleFromDrag` uses 260
   px per doubling clamped to `MIN_LANE_SCALE 0.6 … MAX_LANE_SCALE 2.5`;
   `nextPxPerBeat` clamps to `MIN_PX_PER_BEAT 6 … MAX_PX_PER_BEAT 120` and
   quantises to a tenth of a pixel per beat "so repeated small steps cannot
   accumulate a value that renders at a fractional pixel and shimmers";
   `zoomAnchorScroll` keeps the beat under the anchor under the anchor.
   `ZOOM_STEP = 1.25`. The zoom tool deliberately falls through clip hit-testing
   so it works over a busy arrangement, and its double-click and right-click do
   not open the clip editor or menu.
3. **Gap.** MotionLab ahead. Record as an addition, not a gap.

### 2.10 Tool set comparison

| FSP8 tool | Key | MotionLab tool | Key | Notes |
|---|---|---|---|---|
| Link (Arrow+Range) | — | — | — | MISSING |
| Arrow | 1 | pointer | 1 | move/size/fade/select; no alt-tool modifiers |
| Range | 2 | range | 2 | ops at parity, gestures thinner |
| Split | 3 | split | 3 | no multi-clip, no Alt note-split |
| Eraser | 4 | erase | 4 | no drag sweep |
| Paint | 5 | paint | **7** | MIDI clips only; no shapes, no gain curve |
| Mute | 6 | mute | **5** | no drag sweep |
| Bend | — | (warp, in editor) | — | not an arrangement tool |
| Listen | — | listen | 8 | divergent by design |
| — | — | slip | 6 | FSP8 has this as Arrow+Ctrl+Alt |
| — | — | zoom | 9 | MotionLab addition |

**Note the numbering collision:** MotionLab's `ARRANGE_TOOLS` order is
`pointer, range, split, erase, mute, slip, paint, listen, zoom`, so `5` is Mute
and `7` is Paint — the inverse of FSP8, where `5` is Paint and `6` is Mute. Any
convergence work must decide this deliberately; muscle memory is the whole point
of number keys. MotionLab's own comment justifies keeping one list: "a tool that
the toolbar offers and the keyboard has never heard of is a shortcut list that
lies, which is how `range` ended up unbound."

**Cursors.** FSP8 documents distinct cursors per tool and per hover zone
(crosshair for range-from-arrow, sizing arrows, both-arrows at a junction, Hand
over a crossfade, Trim in a gain curve's upper half, Slip icon). MotionLab
carries `data-tool={tool}` on the arrangement root and styles from CSS; the
per-hover-zone cursor vocabulary is thinner. `PARTIAL`.

---

## 3. Clips and Clip Gain Curves

### 3.1 The Clip abstraction

1. **FSP8 does.** A *Clip* is a representation of an audio file plus **metadata
   describing its processing** — "its Gain Curve, bend markers, Melodyne edit
   state, chord data, and more" — so one file can sound many ways across many
   Events without bouncing. Clips live in the Browser's **Pool**; files live in
   the session's Media folder or as external files. "Edits made to a single Clip
   will ordinarily affect every instance of the clip in a Session."
2. **MotionLab does.** `MediaRef` (`src/model/media.ts`) + `mediaId` on
   `AudioClip`, with `src/audio/mediaLibrary.ts` decoding and caching, and a Pool
   browser tab (`BrowserTab` includes `'pool'`). But the processing metadata
   lives on the **clip**, not on the media: `gain`, `fadeIn/Out`, `transients`,
   `warp`, `stretch`, `transpose`, `eventFx` are all per-clip fields. Two clips
   over one media file are fully independent.
3. **Gap.** `DIVERGENT-BY-DESIGN`, and worth stating as such rather than as a
   hole. FSP8's shared-metadata model is the reason it then needs Clip Versions;
   MotionLab's per-clip model gets independence for free and needs a *shared*
   mechanism instead (see §5.8). Neither is strictly better; the MotionLab
   choice is simpler and should be defended explicitly in an ADR.

### 3.2 Clip Versions / Separate Shared Copies

1. **FSP8 does.** A Clip Version is "a completely separate copy of a Clip with
   its own, independent metadata". Created by right-click → Audio → *New Clip
   Version*. *Separate Shared Copies* (`[Alt]+[C]`) makes one new version per
   version used by the selection, and "Groups of Events sharing a Clip Version
   will still share the new Version". Versions are numbered in the Pool and
   badged on the event. "Note that clip versions cannot have individual tempos."
   Drag a version from the Pool with `[Alt]` held to replace a clip with it.
2. **MotionLab does.** Not applicable — see §3.1; every clip is already
   independent.
3. **Gap.** `DIVERGENT-BY-DESIGN` (need does not arise).

### 3.3 Clip Gain Curve

1. **FSP8 does.** A per-clip gain envelope, shown as a white line through the
   waveform's zero point, enabled from the event context menu. Clip-based, so it
   affects all shared copies. Editing:
   - **Arrow tool** — click the line to add a point; with one point, dragging it
     changes the whole event's gain; with more, only part. Points move in both
     axes (vertical = value, horizontal = time). The value indicator shows
     position, current value and delta. Points snap to the grid on release if
     Snap is on. Right-click a point to type a value. `[Alt]` + wheel over a
     point nudges it. `[Shift]` fine-tunes. Dragging past other points pushes
     them; originals are remembered until release, duplicates at a position are
     deleted, and undo restores them. Left/right arrow keys select points;
     `[Shift]` or `[Option]` selects ranges of points. `[Delete]` or right-click
     → Delete removes.
   - **Segment curve** — hover a segment for a curve handle; drag up/down; right
     click for numeric value and curve type.
   - **Paint tool** — draws a series of points in one action, anywhere inside the
     event, with the eight shapes; drawing overwrites existing points.
   - **Transform** — drag a selection box around a region, then scale via eight
     handles (four sides, four corners).
   - **Range tool** — hover the upper half of a segment (or of a selected range)
     for the **Trim** cursor; drag up/down to trim that segment or that whole
     range of segments.
   - **Bypass** — right-click below the zero point and hit Bypass to compare
     without resetting; the state is saved with the session.
   - **Reset Gain Curve** from the Audio Operations menu.
   - The curve travels with the event and with slipped audio, because it is
     clip-based.
2. **MotionLab does.** Absent. Clip gain is a **scalar** `AudioClip.gain`
   (linear), set from a "Clip gain…" dialog, `Normalize to −0.3 dB`
   (`normalizeClip` in `src/app/audioEditActions.ts`, which toasts
   `Normalized: gain N×` and refuses on silence or an undecoded buffer), and
   `fadeRange` for range-scoped fades. Grepped `gainCurve`: no hits.
   The equivalent machinery exists for **track automation**
   (`src/model/automation.ts`: `AutomationPoint`, `CurveShape`,
   `laneValueAt`, `normalizeLanePoints`; `AutomationLanes.tsx` has marquee,
   multi-select, Shift-fine, Alt-no-snap, copy/paste/duplicate, per-point curve
   shapes and keyboard editing) — so the interaction vocabulary is already
   written, one object away.
3. **Gap.** `MISSING`, and it is the largest single missing *feature* in the
   chapter measured by manual page count. Mitigating: a per-clip volume
   automation lane would deliver most of it by reusing `automation.ts`, and
   MotionLab's per-clip independence (§3.1) removes the shared-copy hazard the
   manual spends two paragraphs on.

---

## 4. The Grid — **directive focus**

### 4.1 Timebase

1. **FSP8 does.** The grid is the timeline ticks and their vertical lines,
   driven by the **Timebase**: **Seconds, Samples, Bars, Frames**. The timebase
   determines event and tool snapping behaviour and can be changed at any time
   without affecting the arrangement. With Bars, the grid comes from the Quantize
   panel.
2. **MotionLab does.** Bars/beats only. `prefsStore.primaryTimeDisplay` is
   `'bbt' | 'clock'` — a *display* choice for the transport readout, not a grid
   timebase. `formatPosition(clip.start, timeSig)` labels clips in bars. No
   samples timebase, no frames timebase.
3. **Gap.** `PARTIAL` — bars are complete and tempo-map-aware; seconds exists as
   a readout but not as a grid; samples and frames are absent. Frames matters
   only with video, which is out of scope for MotionLab today.

### 4.2 Quantize panel — every parameter

1. **FSP8 does.** Opened from the toolbar or *View/Additional Views/Quantize*;
   detachable. Left to right: **Grid or Groove mode**; **note-value selection**;
   **note grouping and Swing amount**; **Start, End, Velocity and Range
   percentages**; **preset management**.
   - **Rhythmic values (Grid mode):** any note value from **whole notes to 64th
     notes**, in groupings **Straight** (with a Swing percentage), **Triplet**
     (3 in the space of 2), **Quintuplet** (5 in the space of 4), **Septuplet**
     (7 in the space of 8). These also drive the look and behaviour of the
     Arrange view grid.
   - **Swing:** off-beats move forward relative to on-beats. "at 100% Swing, with
     16th-note quantize selected, a pattern of 16th notes play at a 2:1 ratio;
     On-beat notes play on beat, and offbeats play as though they were the final
     16th-note triplet in a group of three." Range **0 %–100 %**.
   - **Start %** (default **100 %**) — quantize strength for note/event/transient
     starts; less than 100 % moves proportionally toward the grid.
   - **End %** — notes in Instrument Parts only; quantizes note ends, making
     notes shorter or longer.
   - **Velocity %** — "lets you tie Quantize strength to note velocity, to the
     degree that you specify"; in Groove mode it also adjusts velocity from the
     extracted groove.
   - **Range %** — "sets the relative range from grid lines within which notes,
     Events, or transients are quantized"; anything beyond is untouched. "As
     there is no display indicating the Range, quantizing several times while
     adjusting this setting may lead to the best results."
   - **Presets:** up to **five** quick slots, plus store/recall like any preset.
   - **Independent panels** for Arrangement, Note Editor and Audio Editor.
2. **MotionLab does.** `src/model/midiTools.ts`:
   ```ts
   export const QUANT_GRIDS = [
     { label: '1/1',   beats: 4 },     { label: '1/2',  beats: 2 },
     { label: '1/4',   beats: 1 },     { label: '1/8',  beats: 0.5 },
     { label: '1/16',  beats: 0.25 },  { label: '1/32', beats: 0.125 },
     { label: '1/4T',  beats: 2/3 },   { label: '1/8T', beats: 1/3 },
     { label: '1/16T', beats: 1/6 },
   ] as const;
   ```
   `QuantizeOptions = { grid, strength (0..1), swing (0..1), lengths?: boolean }`.
   `nearestSwungSlot()` displaces odd slots late by `swing × grid / 2` and picks
   the nearest of the three candidate slots, so "strength interpolates toward the
   *swung* grid". The piano-roll toolbar exposes **Q** (grid), **Str** (0–100 %),
   **Sw** (0–100 %) and a Quantize button whose title reads
   `Quantize ${selection ? 'selection' : 'all notes'}`; the audio editor and warp
   panel each have their own grid + strength.
3. **Gap.** `PARTIAL`, itemised:
   - **Present:** grid values 1/1→1/32, triplets, strength, swing, note-end
     quantize (`lengths`), per-view grid settings.
   - **Missing values:** 1/64; **dotted** variants; **quintuplet**; **septuplet**.
   - **Missing parameters:** **Velocity %** (velocity-weighted strength);
     **Range %** (a quantize window); **Start %** is present as `strength` but is
     not separable from End % — `lengths` is a boolean, not a second percentage.
   - **Missing plumbing:** no Quantize *panel* object, so the settings are local
     component state ("it is a tool setting, not project data") and are not
     stored, presettable, or shared with the arrangement grid. FSP8's arrangement
     **grid is drawn from the quantize value**; MotionLab's arrangement grid
     (`uiStore.snap`) and its quantize grid (`qGrid`) are unrelated numbers that
     can silently disagree.
   - **Missing:** the five preset slots and preset store/recall.

### 4.3 Groove mode / Groove Extraction

1. **FSP8 does.** Switch the Quantize panel to **Groove** mode, drag an Audio
   Event or Instrument Part into the Groove panel to extract its groove, then
   quantize anything to it. "When you extract the groove from an Audio Event or
   Instrument Part, the grid in the arrangement is then based on that groove."
   The groove can be dragged **out** to an Instrument Track, rendering "a series
   of notes, one for each hit in the groove, even tweaking note velocity
   according to the relative level of the hits."
2. **MotionLab does.** `src/model/groove.ts` — `Groove`, `GrooveEvent`,
   `applyGroove()`, `extractGroove()`, `grooveFromNotes()`, `straightGroove()`,
   `swingGroove()`, `BUILTIN_GROOVES`, `grooveByName()`, `normalizeGroove(s)`,
   `MAX_SAVED_GROOVES = 24`, `grooveBeatsPerBar()`. Store actions
   `applyGrooveToClip(clipId, groove, strength)`, `saveGroove`, `removeGroove`;
   grooves persist in the project (`ProjectData.grooves`, validated in
   `projectRepo.ts`). UI is `src/components/inspector/GroovePanel.tsx`.
3. **Gap.** `PARTIAL` — extraction, application at a strength, built-ins, saving
   with the song and a bounded library are all present, and persisting grooves in
   the project is better than FSP8 documents. Missing: extraction **from audio
   transients** (grooves come from notes), the arrangement grid following an
   extracted groove, and groove-out-to-notes.

---

## 5. Common Editing Actions

### 5.1 Cut, Copy, Paste

1. **FSP8 does.** `[Ctrl]+[X]` cut, `[Ctrl]+[C]` copy, `[Ctrl]+[P]` paste
   (note: P, not V) — pasted "on the selected Track, at the current playback
   cursor position"; a multi-track copy pastes into the appropriate tracks
   relative to the first selected track. **Paste at Original Position** is
   `[Ctrl]+[Shift]+[V]`, for moving events between sessions at their original
   timeline location.
2. **MotionLab does.** `src/app/clipboardActions.ts` — an in-memory buffer
   ("clip data references media ids that only mean something inside this
   project's storage, so exporting them as OS clipboard text would produce
   something that pastes nowhere"), deep-cloned at copy time.
   `copySelection` / `cutSelection` / `pasteAtPlayhead`, bound to `Ctrl+C`,
   `Ctrl+X`, **`Ctrl+V`**. Paste lands the block at
   `snapBeatFloor(engine.getPositionBeats(), max(snap, 0.25))`, on the clips' own
   tracks, spacing preserved; clips whose track was deleted are skipped with an
   explicit toast rather than guessed onto another track. Range-scoped
   copy/cut/paste exists separately (`rangeCopy`, `rangeCut`, `rangePaste` with
   an `insert` flag).
3. **Gap.** `PARITY` on behaviour, with a **key divergence**: `Ctrl+V` vs FSP8's
   `Ctrl+P`. MotionLab's is the platform convention and should stay.
   `MISSING`: Paste at Original Position (which needs cross-project paste to be
   meaningful; `src/app/projectMerge.ts` is the nearest thing).

### 5.2 Audio Event Slip

1. **FSP8 does.** Move the audio inside a fixed event window without changing
   length or envelope. Arrow tool + `[Ctrl]+[Alt]` hovering an Audio Event
   reveals the Slip icon; drag left/right. Works across a multi-selection and
   across tracks. "An Audio Event can be slipped only as far as the length of the
   audio clip it contains."
2. **MotionLab does.** A dedicated tool, `slip` `[6]`. `dragSlip` in `ClipView`
   → `slipClip(id, deltaSec, maxOffset?)`; `maxSlipOffset(clip)` in
   `audioEditActions.ts` caps against media length. Non-audio clips toast "Slip
   works on audio clips." Locked clips refuse.
3. **Gap.** `PARTIAL` — the operation and its bound are at parity; it is a tool
   rather than an Arrow-tool modifier, and it is single-clip.

### 5.3 Audio Event Transpose and Tune

1. **FSP8 does.** Inspector fields. **Transpose −24 … +24 semitones**;
   **Tune −100 … +100 cents**. Both share the timestretch algorithms. Any number
   of events can be set at once, "but note that this change is not relative to
   the current setting of each Event. All selected Events are transposed or tuned
   to the same chosen value."
2. **MotionLab does.** `AudioClip.transpose?` — semitones, applied "by resampling
   (or by the stretcher)". `TimePitchPanel.tsx` exposes it with `min={-24}`
   `max={24}`, matching FSP8 exactly, alongside `stretch` (0.25–4),
   `sourceBpm` (20–999), `followTempo` and `preservePitch` ("Off resamples like
   tape: faster is higher. On renders through the stretcher and keeps the
   pitch."). There is **no cents/tune field** on audio clips; per-**note** detune
   exists (`Note.detune`, ±100 cents).
3. **Gap.** `PARTIAL` — transpose at exact parity including range; tune (cents)
   missing for audio; multi-select set-to-same-value not implemented.

### 5.4 Global Transpose

1. **FSP8 does.** A transport-bar control, **−12 … +12 semitones**, applying to
   both instrument and audio tracks that have *Follow Global Transpose* engaged
   in the Track Inspector. Right-click → *Freeze Global Transposition* resets it
   to 0 at the original pitch.
2. **MotionLab does.** Absent. Grepped `globalTranspose`, `followGlobalTranspose`:
   no hits. Per-track transpose is also absent (only per-clip and per-note).
3. **Gap.** `MISSING`.

### 5.5 Nudge

1. **FSP8 does.** `[Alt]+[→]` / `[Alt]+[←]` move an event or note by the current
   snap value; **with snap disabled, nudging adjusts in milliseconds**.
   `[Ctrl]+[Alt]+[→]` / `[←]` nudge by **one bar**. Any number of events or notes
   at once; also in the Edit menu.
2. **MotionLab does.** `clip-nudge`: `←`/`→` nudge selected clips by the grid,
   `Shift` for fine. Piano roll `pr-nudge`: `←`/`→` by the snap, `Shift` fine
   (`d = dir * (e.shiftKey ? step / 4 : step)` — a quarter-grid fine step, not
   milliseconds). No bar-nudge, and the binding is bare arrows rather than Alt.
3. **Gap.** `PARTIAL`.

### 5.6 Duplicate / Duplicate and Insert

1. **FSP8 does.** *Duplicate* (`[D]`) "combines the Copy and Paste actions and
   intelligently places the pasted selection based on the musical timing of the
   selection". The copy is always placed after the original and is automatically
   selected — so repeated `[D]` lays a loop across a section, and duplicating a
   short range gives the stutter effect. `[Alt]+[D]` = **Duplicate and Insert**,
   pushing existing material right to make room.
2. **MotionLab does.** `duplicateClips(ids)` — "Duplicate a selection as one
   block placed immediately after it, preserving internal spacing and track
   placement", returning the new ids, which `duplicateSelection` then selects, so
   repeated `Ctrl+D` chains exactly as FSP8 describes. Bound to `Ctrl+D`.
   Range-scoped `duplicateRange` = `copyRange` then `pasteRangeAt(r.to)`.
   Piano roll has its own `Ctrl+D` for notes; automation lanes too.
   Duplicate-and-insert exists only as the range-menu combination
   (`rangePaste(..., insert = true)` / `insertSilence`), not as a clip command.
3. **Gap.** `PARITY` for Duplicate (key differs: `Ctrl+D` vs `[D]`).
   `PARTIAL` for Duplicate and Insert.

### 5.7 Duplicate Shared / ghost copies

1. **FSP8 does.** `[Shift]+[D]` links duplicates to the original: "Any edits made
   to the original Part or a Shared copy are applied to all instances of that
   Part", flagged with a ghost icon. *Separate Shared Copies* from the Event menu
   breaks one out.
2. **MotionLab does.** Absent. Every duplicate is an independent deep clone
   (`duplicateClips`, `duplicateClip`, `insertClips` all `structuredClone` and
   re-id, including re-idding every note).
3. **Gap.** `MISSING`. This is the flip side of §3.1: MotionLab chose
   independence everywhere and therefore has no sharing mechanism at all. If
   linked repeats are wanted, the honest design is a first-class "linked clip"
   reference, not a metadata-sharing side effect.

### 5.8 Explode Pitches to Tracks

1. **FSP8 does.** Right-click an Instrument Part → *Explode Pitches to Tracks*:
   every pitch becomes its own Instrument Part on its own new track — "if you
   have a MIDI loop to use with a virtual drum instrument, you may want to have
   each piece of the drum kit on its own Instrument Track."
2. **MotionLab does.** Absent for note→track. The closest existing machinery is
   sampler slicing: `sliceToPads(trackId, zoneId)` turns a sliced zone into drum
   pads and `sliceToMidiClip` creates a MIDI clip triggering the slices in order.
3. **Gap.** `MISSING`.

### 5.9 Strip Silence

1. **FSP8 does.** A panel (toolbar button or *View/Additional Views*). Select
   events, set options, **Apply**; **Default** restores defaults. "The result …
   is similar to using a gate processor to only allow the desired signal to be
   heard, except that the Event is edited." A lit indicator beside **Apply**
   means re-applying auto-undoes the previous pass so settings can be dialled in;
   any selection change or other edit ends that state.
   - **Detection → Material:** *Lots of Silence* (clean single-drum recordings),
     *Little Silence* (minimal techno, ride, snare), *Noise Floor* (noisy
     overheads, drum mixes, loops), *Manual*.
   - **Open Threshold** −80 … 0.00 dB; **Threshold Link**; **Close Threshold**
     −80 … 0.00 dB.
   - **Events → Minimum Length** (s), **Pre-Roll** (s), **Post-Roll** (s),
     **Fade-In** (s), **Fade-Out** (s), **Link** (fade-in = pre-roll,
     fade-out = post-roll).
2. **MotionLab does.** `src/model/rangeEdits.ts`:
   ```ts
   export const DEFAULT_STRIP_SILENCE: StripSilenceOptions = {
     thresholdDb: -40, minSilenceSec: 0.25, minPartSec: 0.1,
     padBeforeSec: 0.02, padAfterSec: 0.05,
   };
   ```
   `stripSilence(clip, peaks, opts)` returns `KeptSpan[]` in source seconds.
   It decides from the **peak envelope**, not the samples: "it is already
   computed for drawing, one bucket is far finer than any musical silence, and
   using it means the parts the musician is shown are the parts they get." With
   no envelope the whole window is kept — "silence detection that cannot see the
   audio must never be the thing that deletes it." Invoked from the clip context
   menu ("Strip silence") via `stripSilenceFromClip(clipId)`; the caller turns
   spans into clips, "which is where locking, ids and undo belong."
3. **Gap.** `PARTIAL`. Present: threshold, minimum silence, minimum part, pre/post
   pad, one-step undoable application. Missing: **any UI for the options** (the
   defaults are the only settings a user can get), the four material presets, the
   separate open/close thresholds with link, per-part fade-in/out with link, and
   the auto-undo-on-reapply affordance. Diverges usefully: `minSilenceSec` (a
   hold time) is a parameter FSP8 lacks.

### 5.10 Audio Parts

1. **FSP8 does.** `[G]` merges selected Audio Events into an Audio Part —
   "appear and function as a single Event in the arrangement while also appearing
   and functioning as separate Events in the Editor". Supports shared/ghost
   copies except Event FX, which stay per instance. Two Event Inspector options:
   - **Play mode:** *Normal* (topmost only, overlaps not played) · *Overlaps*
     (overlapping audio plays mixed rather than cutting off — "This often happens
     if individual slices are have been quantized but not timestretched") ·
     *Slices* (optimised for sliced-loop files; short fades on slices, each slice
     triggered once, no overlaps).
   - **Stretch Events** — timestretch events inside the Part to session tempo.
   *Dissolve Audio Part* from the context menu.
2. **MotionLab does.** Absent (§1.1). The overlap question is handled per-track:
   `Track.playOverlaps` is documented in the FSP8 inspector list and MotionLab
   has an analogous scheduling decision in `src/audio/clipSchedule.ts`, but there
   is no container object.
3. **Gap.** `MISSING`.

### 5.11 Crossfade

1. **FSP8 does.** Select two or more overlapping events and press `[x]` for a
   linear crossfade over the overlap; or select a Range and press `[x]` to
   crossfade over exactly that range. "When possible, gaps between Events will be
   automatically closed when a crossfade is applied." Drag the centre node up or
   down for exponential shapes.
2. **MotionLab does.** `createCrossfade(leftId, rightId, lengthBeats, shape)` —
   "creates the overlap (using trim headroom on both sides where needed) and sets
   complementary fades of the given shape. One undo step." Exposed as two menu
   items on a two-clip selection: *Crossfade (equal power)* and *Crossfade
   (linear)*, plus `setFadeShape(id, 'in'|'out', shape)`. `crossfadeSelection`
   toasts "Select two audio clips on the same track to crossfade." if the
   selection is wrong.
3. **Gap.** `PARITY` on the operation, including the gap-closing behaviour
   (MotionLab's trim-headroom approach is the same idea stated more precisely).
   `PARTIAL` on the interface: no `[x]` key, no range-scoped crossfade, no
   node-drag shaping, and only two of the four shapes are reachable from the
   menu even though `FadeShape` has four.

### 5.12 Transport options that affect editing

| FSP8 option | Shortcut | MotionLab | Gap |
|---|---|---|---|
| **Loop Follows Selection** — loop markers snap around any edit selection; only while stopped | `Alt+Ctrl+P` | Absent; `setLoop` exists, nothing drives it from a selection | `MISSING` |
| **Enable Play Start Marker** — playback start separated from the edit selection, draggable in the timeline | `Alt+P` | Absent; playback starts from the playhead only | `MISSING` |
| **Return to Start Position on Stop** | `Alt+NumPad 0` | Absent as an option; `Enter` = "Return to start" is a manual command | `MISSING` |
| **Locate to the Mouse Cursor** | `Ctrl+Space` | Absent | `MISSING` |
| **Zoom to loop / selection** | `Shift+L` / `Shift+S` | `zoomToSelection()` on a toolbar button, toasts "Select clips first…" | `PARTIAL` |
| **Set loop around range** | `Shift+P` | Absent | `MISSING` |

### 5.13 Ripple Edit

1. **FSP8 does.** A toolbar mode. Deleting pulls later material left to close the
   gap. Beyond that it adds "displacement" behaviour: pasting inside a part
   splits the target and pushes it right rather than replacing or overlapping;
   moving a part onto another part's start makes the two **swap places**;
   trimming a part's end moves everything downstream to keep relative position.
   Extends to Crop to Content and Nudge/Nudge Back.
2. **MotionLab does.** Ripple is a **per-operation flag**, not a mode:
   `rippleDeleteClips(ids)` ("Delete and pull later clips on the same tracks left
   by the removed span"), `rangeDelete(range, ripple = true)` → "Delete and close
   the gap", `insertSilence`, and `RangeEditResult.ripple = { fromBeat,
   deltaBeats }` so the caller moves markers, sections, chords and tempo events
   by the same rule — a detail FSP8 does not discuss and MotionLab gets right.
   The clip menu offers "Ripple delete".
3. **Gap.** `PARTIAL` — ripple *delete* and *insert* are at parity or better
   (global-track propagation is a genuine MotionLab advantage). Missing: ripple as
   a persistent mode, ripple paste-displacement, part swapping, and ripple on
   trim and nudge.

### 5.14 Autoscroll and Cursor Follows Edit Position

1. **FSP8 does.** Autoscroll toggled with `[F]`, in three flavours: **Turn Over**
   (page when the cursor reaches the edge), **Continuous Center**, **Continuous
   Left**. Separately, **Cursor Follows Edit Position** jumps the playback cursor
   to the start of any event or group selected, any note selected or moved, or
   any marker moved — and, per §1.10, to an event's **sync point** rather than its
   start when one exists.
2. **MotionLab does.** `prefsStore.followPlayhead` (default `true`), a single
   boolean in the settings sheet, applied in `Arrangement.tsx` while the engine
   is playing. No mode choice, no cursor-follows-edit.
3. **Gap.** `PARTIAL`.

### 5.15 Loop Tool (event looping)

1. **FSP8 does.** Hover the **bottom-right corner** of an event for the loop
   tool, then drag along the grid to repeat the event by its own length; once
   looped the tool is available at any event height. Loop handles inside the
   event adjust the loop **end**; `[Opt]/[Alt]` + drag adjusts the loop **start**
   of each looped repeat. Looped Instrument Parts remain a single shared event,
   so edits carry across the repeats. Single loop sections can be moved and
   removed by option-clicking to set a range. Unchecking **Loop** in the event
   context menu removes all the duplicates at once. The Event Inspector exposes
   `Loop` with a **number of loops** field; "Enabling Loop state loops Event until
   next Event or the Session End Marker." Track height must be large enough for
   the handle to appear.
2. **MotionLab does.** Absent. `AudioClip`/`MidiClip` have no loop field; only
   `ProjectData.loop` (the transport loop region) exists. Repetition is achieved
   by duplication, which produces independent copies.
3. **Gap.** `MISSING`, and coupled to §5.7 — without shared copies, a loop that
   propagates edits has nothing to build on.

### 5.16 Set Bar / Second Offset to Cursor

1. **FSP8 does.** Right-click the timebase ruler (or the Session menu) →
   *Set Bar Offset to Cursor* / *Set Second Offset to Cursor*, to offset the
   session's bar or second numbering for lead-ins, imported stems and video sync.
2. **MotionLab does.** Absent.
3. **Gap.** `MISSING`.

---

## 6. Lock Tracks or Events

### 6.1 Track Lock

1. **FSP8 does.** Available for Audio, Instrument, Automation and Folder tracks;
   right-click the track name → *Lock Track* / *Unlock Track*. A locked track
   refuses addition or deletion of events, refuses recording and pasting into it,
   cannot be removed from the session, and cannot be used by the Arranger Track.
   Still allowed: Mute, Solo, reorder in the track list, colour change, rename —
   "every action that is not allowed will be greyed out and inaccessible".
2. **MotionLab does.** `Track.locked?` — "locked tracks refuse clip timing edits
   and deletion". `TrackHeader` menu: "Lock track (blocks clip edits)". The store
   gates through `editable(draft, c) = !c.locked && !trackById(draft, c.trackId)?.locked`.
   `rangeEdits.ts` reports `lockedTrackIds` for tracks that refused new material
   rather than silently dropping it. Mute/solo/rename/colour/reorder remain
   available, matching FSP8.
3. **Gap.** `PARITY` on the core, `PARTIAL` on reach — locked tracks are not
   protected from **track deletion** itself, and there is no arranger-track
   interaction to gate.

### 6.2 Time Lock vs Edit Lock

1. **FSP8 does.** Two independent per-event options from the context menu.
   **Time Lock** keeps the event from moving to a different time position; data
   inside can still be added, removed or altered; the event can be copied,
   pasted and duplicated anywhere, and "A time-locked Event that has been pasted
   or duplicated will also be time-locked"; the Arranger Track also may not
   relocate it. **Edit Lock** prevents the contents being altered in any way and
   also locks the Transpose and Velocity fields at the top of the menu. Both
   together show a padlock. Locking is undoable like any action, so the manual
   recommends *Save New Version* as a backup.
2. **MotionLab does.** One flag: `ClipBase.locked?` — "locked clips refuse timing
   edits and deletion until unlocked". `ClipView` hides the trim edges and fade
   handles, refuses tool actions with the toast "This clip is locked — unlock it
   to edit.", and renders `🔒`. Listen still works, deliberately.
3. **Gap.** `PARTIAL` — one lock where FSP8 has two orthogonal ones. MotionLab's
   single flag behaves closest to Edit Lock ∪ Time Lock. Splitting it is cheap
   and the semantics are already written down in the manual.

---

## 7. Convert a Part into a Pattern

1. **FSP8 does.** Right-click a Part → *Convert Part to Pattern* (also on the
   Event menu). The app picks Melodic or Drum mode from the instrument. Maximum
   pattern length is **64 steps**; "anything beyond that is truncated during the
   conversion". *Convert Pattern to Part* reverses it.
2. **MotionLab does.** Absent — there is no Pattern object (§21).
3. **Gap.** `MISSING` (both directions).

---

## 8. Audioloops and Musicloops

1. **FSP8 does.** Two proprietary formats.
   - **Audioloop** — "Audio Parts tagged with a tempo and Session key signature;
     rendered with lossless compression." Created by dragging an Audio Part to
     the File Browser; the browser then exposes its **Slices** under a disclosure
     arrow. The documented recipe: export a stem for the range → detect
     transients → apply **Slice** with **Merge** checked → drag the Audio Part to
     the browser. Alternatively drag the unsliced event to export a loop that
     stretches to session tempo.
   - **Musicloop** — "everything required to recreate a musical performance,
     including the virtual instrument preset, multichannel FX chain presets for
     the virtual instrument outputs, the music-performance file, Session key
     signature, and an Audioloop." Created by dragging an Instrument Part to the
     browser; `[Alt]` toggles between Musicloop and plain MIDI export. Dropping
     one into a session recreates the track, instrument and output effects;
     "the rendered audio can be used even if the instrument and effects used to
     create the Musicloop are not installed." *Show Package Contents* exposes the
     elements for individual drag-out. Channel volume, pan, send and bus details
     are **not** included. The session key signature must be set before export.
2. **MotionLab does.** No composite loop format. Adjacent capability:
   `src/app/exportActions.ts` (stem and mixdown export),
   `src/model/midiExport.ts` / `midiFile.ts` / `midiImport.ts` (MIDI in/out),
   `src/model/templates.ts` (session templates with tracks, routing, inserts and
   sends — the closest thing to a Musicloop's *setup* half),
   `src/model/presets.ts` and `effectPresets.ts` (instrument and effect presets),
   a Loops browser tab (`BrowserTab` includes `'loops'`), and
   `src/app/projectMerge.ts` (merging one project's material into another).
3. **Gap.** Audioloop → `MISSING`. Musicloop → `PARTIAL` in pieces (templates +
   presets + MIDI export cover the parts, nothing packages them), and the
   rendered-audio fallback is `MISSING`. Note: neither format name may be reused.

---

## 9. Edit Groups

1. **FSP8 does.** Group tracks so an edit on one is performed on all.
   - **Create:** select tracks → right-click → *Group Selected Tracks*, or
     `[Ctrl]+[G]`. Names are suggested from common track names ("Snare 1" and
     "Snare 2" → "Snare"), else "Group 1", "Group 2"… Rename from the group
     selection box.
   - **Add a track:** click the Edit Group box under the input selector, or
     right-click → *Group Assignment* (a check mark shows the current group).
   - **Behaviour:** selecting a grouped track selects all of them; edits on any
     event apply to all group members' events; a colour change applies to the
     whole group; faders and several console features are grouped too; an edit
     group can be made from a Folder Track; the Edit view shows a group icon when
     the event being edited belongs to one.
   - **Dissolve:** right-click → *Dissolve Group (n)*. Undoable.
   - **Suspend:** `[Alt]` while performing an action suspends the group for that
     action; `[Shift]+[G]` then the group's first letter or number suspends and
     reactivates the whole group.
2. **MotionLab does.** `Track.editGroup?: number` — "edit group (1..4): selecting
   a clip links time-overlapping clips across the group". `TrackHeader` menu
   lists four fixed slots, `● ` marking the current one. `ClipView.dragMove`
   implements the linkage: on selecting an unselected clip on a grouped track it
   collects every clip on tracks sharing the group whose span overlaps the
   clicked clip's span, selects them all, and keeps the clicked clip primary.
   Folder tracks (`groupTracks`, `ungroupFolder`, `folderId`, `folded`) and VCAs
   (`addVca`, `assignVca`, `vcaId`) exist separately for mixing.
3. **Gap.** `PARTIAL`, itemised:
   - **Present:** grouped selection, time-overlap linking, group-aware
     multi-clip drag, per-track assignment UI.
   - **Divergent:** four numbered slots rather than arbitrarily many named
     groups. Numbers are simpler and testable; names are what a drum kit wants.
   - **Missing:** `Ctrl+G` create-from-selection; auto-naming; rename; dissolve
     as a command (clearing four tracks one at a time is the only route);
     group-wide colour change; `[Alt]` per-action suspend and `[Shift]+[G]`
     whole-group suspend; the group badge in the editor; group-aware **comping**
     (§11.13) and **phase-coherent quantize** (§12.8), which are the two places
     the feature earns its keep.

---

## 10. Timestretching

### 10.1 Manual timestretch

1. **FSP8 does.** Arrow tool + `[Alt]` at an event edge reveals the Timestretch
   tool; drag to change length at constant pitch, using the **Speedup factor**.
   "Values greater than 1 decrease the length of the clip, while values less than
   1 make the clip longer." Speedup is also typeable in the Event Inspector. Only
   the selected event is affected. "manual timestretching can not be used on an
   Audio Event containing a sliced loop."
2. **MotionLab does.** `AudioClip.stretch?` — "Speed multiplier: 2 plays the
   material twice as fast (and half as long), 0.5 half as fast. Named for what
   the control does, not for what happens to the waveform, because 'stretch 2'
   reads both ways and speed does not." Exposed in `TimePitchPanel` at
   `min={0.25} max={4}`, same polarity as FSP8's Speedup. No edge gesture (§1.9).
3. **Gap.** `PARTIAL` — the parameter is at parity and better named; the gesture
   is missing.

### 10.2 Automatic timestretch / Tempo mode

1. **FSP8 does.** A per-track **Tempo mode** in the Track Inspector:
   - **Don't Follow** — events are independent of session tempo; never moved or
     stretched.
   - **Follow** — start positions are tied to the musical grid, so events move
     with tempo but are not stretched.
   - **Timestretch** — start positions follow *and* events are stretched to fit.
   Switching modes is nondestructive and reversible on the fly.
2. **MotionLab does.** Per-**clip**, not per-track: `followTempo?` ("the clip
   re-stretches when the tempo map changes") with `sourceBpm?` ("source tempo in
   bpm, used to derive `stretch` when following tempo") and `preservePitch?`.
   Clip starts are stored in beats, so *Follow* behaviour is unconditional and
   automatic — every clip's position moves with tempo, always.
3. **Gap.** `PARTIAL`/`DIVERGENT-BY-DESIGN`. MotionLab has Follow (always) and
   Timestretch (per clip). It has **no Don't Follow** — no way to pin an event to
   absolute seconds, which is the film-and-SFX case. FSP8's instrument-track
   **Timebase: Beats | Seconds** (§14.1) is the same missing axis.

### 10.3 Defining file tempo

1. **FSP8 does.** Two routes. (a) Arrow tool + `[Ctrl]+[Alt]` at an event edge
   gives the **Define Tempo** tool: drag to a musical length and the *original
   clip's* tempo is set from it, updating every event in the session that uses
   the clip. (b) Type into the Inspector's **File Tempo** box; with the track in
   Timestretch mode this restretches every event using that clip.
2. **MotionLab does.** `sourceBpm` typed into `TimePitchPanel` (20–999), or
   written by transient analysis at `confidence > 0.3`. Per **clip**, so it does
   not propagate to sibling clips over the same media. No Define Tempo gesture.
3. **Gap.** `PARTIAL`.

### 10.4 File Tempo Approval on Import

1. **FSP8 does.** If the tempo is unknown, it is deduced **from BPM text in the
   filename** ("SynthBass_120BPM.wav" → a probationary 120, shown in red) and the
   user approves, doubles or halves it from a dropdown. Failing that, it is
   deduced from file length assuming an evenly divisible number of bars.
   Unavailable for events containing more than one tempo.
2. **MotionLab does.** No filename BPM parse. `src/app/importActions.ts` and
   `src/audio/importAudio.ts` do not read BPM from names; tempo comes from
   `analyseTransients` when the user asks. No probationary/approval state, no
   double/halve control.
3. **Gap.** `MISSING`. Cheap and high-value: filename BPM parsing plus a
   double/halve control is a small amount of code with a large loop-library
   payoff.

### 10.5 Timestretching material modes

1. **FSP8 does.** Track Inspector → Timestretch menu, four modes tied to named
   third-party algorithms: **Drums**, **Sound** (general), **Solo** (monophonic,
   formant-preserving), and **Tape** — in which "the track audio follows the
   Session tempo by changing the sample playback rate", so pitch moves with
   tempo. In Tape mode "the Speedup, Transpose, and Tune settings in the
   Inspector are linked - editing one setting will affect them all", and tempo
   automation causing pitch change is deliberately not reflected in Transpose or
   Tune. Some modes do not support precision timing changes, in which case bend
   marker manipulation slices and repositions rather than stretching.
2. **MotionLab does.** One stretcher (`src/audio/timestretch.ts`) plus resampling.
   `preservePitch` is the two-way switch: off = tape-style resampling ("Off
   resamples like tape: faster is higher"), on = stretcher. No material-specific
   algorithms; no formant handling; `stretchCache.ts` caches stretched renders,
   and `warpRender.ts` renders warp maps.
3. **Gap.** `PARTIAL` — Tape and a general Sound mode exist as one boolean; the
   Drums and Solo optimisations do not. **The algorithm names in the manual are
   third-party trademarks and must never appear in MotionLab.** If material modes
   are added, name them for the material, never for the engine.

### 10.6 Timestretch cache

1. **FSP8 does.** *Use Cache for Timestretched Audio Files*, on by default
   (Options → Advanced → Audio Engine). Renders a correct-tempo cache file so
   stretching does not happen during playback, and lets the app use a
   higher-quality setting than realtime allows. Costs disk; disable if space or
   performance is a problem.
2. **MotionLab does.** `src/audio/stretchCache.ts` exists and is used
   unconditionally; no preference exposed.
3. **Gap.** `PARITY` on the mechanism, `PARTIAL` on control (no toggle, no
   quality tier).

### 10.7 Default tempo mode for new tracks

1. **FSP8 does.** A **Stretch Audio Files to Session Tempo** checkbox in the New
   Session dialog; when set, new tracks default to Timestretch mode and imports
   are stretched to session tempo. Otherwise the default is Follow.
2. **MotionLab does.** No such session-level default. New clips get
   `followTempo` unset.
3. **Gap.** `MISSING`.

### 10.8 Tap Tempo

1. **FSP8 does.** Click the word "Tempo" in the transport once per beat; the
   session tempo is derived from the click timing. The manual warns to set the
   audio track's Tempo mode to Don't Follow first, "otherwise, the Events are
   stretched or moved while you are using the Tap Tempo function, making it
   impossible to find a consistent tempo."
2. **MotionLab does.** Absent. Grepped `tapTempo`: no hits.
3. **Gap.** `MISSING`.

---

## 11. Comping — **directive focus**

### 11.1 Takes and Layers model

1. **FSP8 does.** *Layers* are lanes beneath a track. With **Record Takes To
   Layers** on (Record panel, `[Shift]+[Alt]+[R]`), every recording after the
   first goes to its own layer, one layer per take, revealed when recording
   stops; the last take is placed on the track. "If only one take is recorded, no
   Layers will be created." Applies to Instrument Parts too. Layers can be added
   manually (right-click track → *Add Layer*) and parts dragged into them — but
   "once an Event has been dragged to a layer, it cannot be moved or copied to
   another location". Layer content is renamable ("great", "not good",
   "brilliant") for organising takes.
2. **MotionLab does.** Takes live **on the clip**, not on the track:
   `AudioClip.takes?: Take[]` where `Take = { id, name, mediaId, offset, muted? }`
   — "offset: seconds into the take's media that aligns with the clip's start" —
   plus `takesOpen?` and `soloTakeId?`. Take lanes render beneath the clip
   (`TakeLanes.tsx`, `TAKE_LANE_H = 36`). Takes are created by
   `packTakes(ids)` / `buildTakeClip(clips, secondsPerBeat)` from overlapping
   audio clips, or by loop recording.
3. **Gap.** `PARTIAL` / `DIVERGENT-BY-DESIGN`. Clip-scoped takes are a cleaner
   model than track-scoped layers and avoid FSP8's "cannot be moved once dragged
   to a layer" wart. Missing: **MIDI takes** (`takes` is on `AudioClip` only),
   manual layer creation, and dragging arbitrary material into a lane.

### 11.2 Comp assembly — the core gesture

1. **FSP8 does.** "With the Arrow tool selected, floating the mouse over any
   layer switches to a special Range tool… Click-and-drag with this tool to
   instantly promote any range of a take to the Track." Once promoted the range
   is highlighted in the track colour "so that you can always be sure where
   material on the Track is coming from". Where a newly copied range overlaps an
   existing one, **an automatic crossfade is applied** "to help avoid clicks or
   other undesirable artifacts", and that crossfade is editable and removable.
   Any selected range on a layer can be resized from its edge, altering the track
   accordingly.
2. **MotionLab does.** `TakeLaneRow.dragSwipe` — press to anchor a beat
   (snapped), drag, and each move calls
   `setCompRange(clip.id, anchorBeat, beat, take.id)`. The whole swipe is one
   gesture (`beginGesture` / `endGesture`) and therefore one undo step. Snap
   applies unless `e.altKey`. A plain click (no movement) toggles
   `setSoloTake` — audition that take alone, click again to return to the comp.
   The comp is `CompSegment[] = { at, takeId }[]`, "Always sorted, first segment
   at 0", normalised by `normalizeComp` (drops unresolvable ids, clamps to the
   clip, collapses zero-length and same-take runs, falls back to the first take).
   `compSpans(clip)` resolves it to spans; the clip renders `.clip-comp-bar` with
   one coloured segment per span, and each take lane shows only its own spans.
   `expandCompClip(clip, secondsPerBeat)` turns the comp into schedulable clips,
   applying `COMP_JOIN_FADE_SEC = 0.004` at every internal join and the clip's own
   fades at the outer ends — "Live playback and the offline render both expand
   through here, so a comp cannot sound different in a bounce than it did on the
   timeline."
3. **Gap.** `PARITY`, and in two respects ahead: the automatic join fade is a
   documented constant rather than an editable object that can be forgotten, and
   the shared expansion path guarantees bounce parity. Missing relative to FSP8:
   the promoted range's crossfade is not individually editable or removable, and
   promoted ranges cannot be resized from their edges after the fact (only
   re-swiped).

### 11.3 Range-tool comping without promotion

1. **FSP8 does.** The Range tool selects within layers **without** promoting;
   the *Copy Ranges to Track* arrow in the layer's controls then promotes the
   selection. Useful with keyboard navigation.
2. **MotionLab does.** Absent — a swipe promotes immediately.
3. **Gap.** `MISSING`.

### 11.4 Auditioning takes

1. **FSP8 does.** The Listen tool suits layers: click anywhere on a layer to hear
   it from that point. With a range selected on a layer, `[Shift]`+click inside
   it solos the layer and loops the selection; `[Shift]`+click outside the
   selection loops the whole layer. Layer solo buttons, or select a layer and
   press `[S]`; only one layer of a track may be soloed at a time. Track solo is
   independent, so takes can be heard in or out of context.
2. **MotionLab does.** Click a take lane to solo-audition it
   (`setSoloTake`, "Audition one take (null returns to the comp)", explicitly
   non-undoable UI state); `soloTakeId` short-circuits `compSpans` to that take
   across the whole clip. A per-lane solo button ("Audition this take alone") and
   a mute button ("Mute this take (skipped by audition)"). Track solo is separate.
3. **Gap.** `PARITY` on the essentials. Missing: loop-the-selection auditioning
   and the `[S]` key.

### 11.5 Layer / take controls

1. **FSP8 does.** Per-layer: **Solo**, **Activate** (places that layer on the
   track and pushes the track's current contents down to a new layer under it),
   **Duplicate**, **Remove**. Also colour-coding per layer via a picker next to
   solo, and per-layer naming (double-click; layers keep their original names
   even when reordered, "to avoid confusion").
2. **MotionLab does.** Per-take row buttons: mute, audition alone,
   **Promote** ("the whole clip plays this take"), move up (`moveTake`), delete
   ("Delete take (safe: comp falls back)"). Take colours are automatic —
   `takeColor(index) = TRACK_COLORS[index % TRACK_COLORS.length]` — and are the
   colours the comp bar uses, so lane and comp bar always agree.
3. **Gap.** `PARTIAL` — promote ≈ activate (without the swap-down), reorder,
   delete, mute all present. Missing: duplicate a take, rename a take, choose a
   take colour.

### 11.6 Switching between layers

1. **FSP8 does.** Three routes: the arrow between track name and layer name plus
   the 4-way arrow keys; the *Activate Layer* up-arrow on an expanded layer; the
   Inspector's Layers field.
2. **MotionLab does.** Promote button per lane. No keyboard route.
3. **Gap.** `PARTIAL`.

### 11.7 Takes and Layers menu on the event

1. **FSP8 does.** A layered event's badge opens a menu with **Select Layer
   Content** (layers containing events in the selected event's range; choosing
   one copies those events to the track) and **Select Take** (the loop-recording
   passes; choosing one changes the event range to that pass).
2. **MotionLab does.** The `▤{n}` badge is decorative; double-clicking an audio
   clip with takes toggles the lanes open. No per-section take menu.
3. **Gap.** `MISSING`.

### 11.8 Quick-switching content on the main track

1. **FSP8 does.** Each comped section on the main track carries a menu button at
   its bottom offering every available layer for that section. Faster still:
   hover the section and hold `[Alt]` while scrolling the wheel, or press `[G]`
   (up) / `[D]` (down).
2. **MotionLab does.** Absent — switching a section means re-swiping it from the
   desired lane.
3. **Gap.** `MISSING`. This is the single highest-leverage comping gap: it is
   the fast path a comping session actually lives in.

### 11.9 Comping keyboard navigation

1. **FSP8 does.** `[↑]`/`[↓]` navigate vertically through the layer stack;
   `[←]`/`[→]` move the range selection to the previous/following range "as
   determined by the chosen Event ranges on the main track"; `[Shift]`+`[←]`/`[→]`
   extends the selection. An extended selection can then be moved with the arrows
   like the original.
2. **MotionLab does.** Absent — comping is pointer-only.
3. **Gap.** `MISSING`.

### 11.10 Layer editing with the other tools

1. **FSP8 does.** Range, Eraser, Paint, Mute and Bend all work on layers.
   The Bend tool can affect several layers at once when takes were recorded to
   layers with a loop. Deleting part of a layer requires the **Range** tool —
   "selecting with the Arrow tool and deleting will delete a section from your
   Comped Audio Event, not your Layer." Layers move horizontally and vertically
   with `[Ctrl]/[Cmd]` + drag from the centre, and trim with `[Ctrl]/[Cmd]` +
   drag from a border.
2. **MotionLab does.** Take lanes accept only the swipe gesture and the row
   buttons. No tool acts on a take.
3. **Gap.** `MISSING`.

### 11.11 Layers Follow Events

1. **FSP8 does.** An Inspector option per track: layers follow the track event
   when it is moved or duplicated. Disabled, "moving an Event with one or more
   Layers beneath it detaches that Event from the layers below, making it a
   permanent part of the primary Layer." Also *Enable 'Layers Follow Events for
   New Tracks'* in Advanced Options, which additionally renames the track and its
   channel to the active layer's name.
2. **MotionLab does.** Structurally unnecessary — takes are fields of the clip,
   so they move with it by construction and cannot detach.
3. **Gap.** `DIVERGENT-BY-DESIGN` — the option exists because FSP8's layers are
   track-scoped. MotionLab's model removes the failure mode rather than adding a
   switch for it. Worth recording as a deliberate simplification.

### 11.12 Layer naming and colour

Covered in §11.5. `PARTIAL` (auto colours, no names).

### 11.13 Comping with groups

1. **FSP8 does.** "If one or more Tracks are in a Group, and comping is performed
   on any of those Tracks, identical edits are performed on the other Tracks in
   the Group" — including soloing, activating and removing layers. Comping across
   grouped tracks with differing layer counts is possible but discouraged; layer
   positions determine the behaviour.
2. **MotionLab does.** Edit groups link clip **drags** (§9) but not comping.
   `setCompRange` takes a single `clipId`.
3. **Gap.** `MISSING`. Together with §12.8 this is what makes edit groups worth
   having on a drum kit.

### 11.14 After comping — consolidate or merge

1. **FSP8 does.** `[Ctrl]+[B]` bounces the selected Audio Events into one
   continuous event, rendering a new file at the correct position. "A more
   flexible way is to merge the separate Audio Events into an Audio Part
   ([G])… Any comping performed under the range of the Audio part results in the
   comps being copied directly into the Audio part."
2. **MotionLab does.** No clip-level bounce-in-place. `healClips(ids)` heals
   adjacent splits ("Audio requires the same media with contiguous offsets; MIDI
   merges notes. Returns how many joins happened"), which is a different
   operation. Track freeze (§13) bounces a whole track. Export bounces the mix or
   stems.
3. **Gap.** `MISSING` for consolidate-selection-to-one-clip; `MISSING` for Audio
   Part merge (§5.10).

---

## 12. Transient Detection and Editing

### 12.1 Detect Transients

1. **FSP8 does.** Select an Audio Event → Bend panel → **Analyze**, or
   right-click → Audio/Audio Bend → *Detect Transients*. Progress shows as a
   percentage in the event's lower left. After detection the event becomes
   slightly translucent and blue **Bend Markers** — full-height vertical lines —
   sit at every transient. Two detection modes, **Standard** (default) and
   **Sensitive**. "If you intend to quantize or slice the Audio Event, you don't
   need to detect transients first; you can go straight to the Action area…
   Any applied action detects transients."
2. **MotionLab does.** `src/model/transients.ts` — `analyseTransients()`,
   `detectTransients()`, with `OnsetMethod = 'spectral' | 'energy'`
   (`spectralFluxEnvelope`, `energyEnvelope`, `spectralFlatness`),
   `TransientOptions`, `OnsetEnvelope`, `TransientAnalysis`. Results land in
   `AudioClip.transients` (seconds into the source, rounded to ms). Two entry
   points: `TimePitchPanel`'s analyse button (which also estimates tempo from the
   same onsets) and the warp panel's **Detect** button, which shows a busy state
   ("Listening…") via a deliberate task boundary "so the button paints its busy
   state before the analysis".
3. **Gap.** `PARITY` on detection, with two methods where FSP8 has two modes.
   `PARTIAL` on presentation: no percentage progress, no translucency, and
   markers are shown in the audio editor rather than on the arrangement clip.
   `MISSING`: implicit detect-on-action.

### 12.2 Tab to Transient

1. **FSP8 does.** `[Tab]` moves the playback cursor to the next transient, in
   both Arrange view and the Audio Editor, "even if transients have not yet been
   detected for the Event". `[Ctrl]+[Backspace]` previous;
   `[Shift]+[Tab]` creates or expands a range selection between transients;
   `[Shift]+[Ctrl]+[Backspace]` shortens it.
2. **MotionLab does.** Absent. `Tab` is browser focus traversal and is used for
   keyboard navigation across clips, notes and automation points — a genuine
   conflict, since MotionLab's keyboard-editing model is built on roving focus.
3. **Gap.** `MISSING`, with a real design constraint: the binding is not
   available and an alternative must be chosen.

### 12.3 Bend Markers

1. **FSP8 does.** Markers stretch audio inside an event without slicing. Placed
   by detection at a default **Threshold of 80 %** (adjustable at the top of the
   event context menu or in the Inspector, range 0–100 %), and insertable
   manually before or after detection. *Show Bend Markers* toggles visibility.
   A detected marker is preceded by "a very short, highlighted range" — the
   distance from onset to peak — and the two are used differently: "When cutting,
   the onset of the transient is used, so as to encompass the whole transient.
   When quantizing or snapping a Bend Marker, the peaks of the transient are
   referenced, for better rhythmic accuracy." Markers are **properties of the
   audio clip**, so duplicated events sharing a clip share markers; bounce first
   to vary them independently.
2. **MotionLab does.** `WarpMarker { sourceSec, beat }` in a `WarpMap`
   (`normalizeWarpMap`, `createWarpMap`, `resetWarp`, `sourceToBeat`,
   `beatToSource`, `stretchRatioAt`, `warpedBeatLength`, `warpFromTransients`,
   `quantizeWarp`) plus edit helpers in `warpEdit.ts` (`warpMarkerNear`,
   `nearestTransient`, `moveWarpMarker`, `addWarpMarker`, `removeWarpMarker`,
   `MIN_MARKER_GAP_SEC = 0.02`). Markers are per **clip**, not per media, so
   duplicates are independent by construction (§3.1). `Transient` carries a
   strength, but there is no user-facing threshold slider filtering which
   transients become markers, and no onset-vs-peak distinction.
3. **Gap.** `PARTIAL`. Missing: the Threshold control; the onset/peak
   double-reference (a real accuracy difference, and cheap to add given
   `analyseTransients` already computes envelopes); a show/hide toggle.
   Divergent and better: per-clip markers.

### 12.4 Editing Bend Markers

1. **FSP8 does.** With the Bend tool: click to insert; double-click to remove
   ("any effect the Marker had on the audio is undone"); drag to stretch or
   compress the surrounding audio, with a directional flag on the marker and the
   waveform coloured **red where stretched, green where compressed**, intensity
   rising with the amount. Snap applies, `[Shift]` inverts it. `[Alt]`+drag
   relocates a marker **without** stretching. At least one other marker must
   exist to the left or right to stretch against, else the clip's own ends are
   used — "if you want to change the rhythmic phrasing of a word in a vocal part,
   add a Bend Marker to the left and right of the word you want to alter".
   `[Shift]`+click selects multiple markers; `[Alt]` selects a group.
   Right-click → *Reset Bend Marker*, on one or many.
2. **MotionLab does.** `WarpLane` in `WarpTool.tsx`: markers are buttons on a
   lane above the waveform, "drawn on the recording's own timeline… so a marker
   sits on the sound it pins". Drag previews locally and commits on release —
   "one undo step per drag, and one warp render per drag rather than one per
   pointer event". While dragging, the marker snaps to the nearest **transient**
   within `SNAP_PX = 6` px unless Shift is held ("Onsets are what a marker wants
   to be on; shift lets a musician say no"). `HIT_PX = 7` for hit-testing,
   `NUDGE_SEC = 0.002` for arrow-key nudging, `MAX_GRID_LINES = 400` because
   "a dense grid over a long clip is a grey wash, not a guide". The beat grid is
   drawn where the map currently puts each beat, so warping walks the grid onto
   the transients — the picture that says whether the map is right. Marker
   tooltips report the pinned beat and the local ratio
   (`${ratio.toFixed(2)}× from here`). `resetWarp(map)` resets all.
3. **Gap.** `PARTIAL`. Present and arguably better: transient-magnet dragging,
   per-drag undo, ratio readout, the grid-walks-onto-the-audio picture, keyboard
   nudge. Missing: **red/green stretch colouring of the waveform** (a genuinely
   useful at-a-glance signal), multi-marker selection, per-marker reset,
   `[Alt]`-relocate-without-stretching, and the whole gesture set at the
   arrangement level.

### 12.5 The Bend panel

1. **FSP8 does.** Sections: **Detection** (Standard/Sensitive); **Bend Marker**
   (Remove All, Restore All, Threshold slider); **Track** (timestretch mode for
   the track; Guide Tracks when grouped); **Action** (Quantize with a Strength
   slider, or Slice). A lit indicator by **Apply** means a re-apply auto-undoes
   the previous pass so settings can be dialled in without manual undo.
2. **MotionLab does.** `WarpPanel` — warp grid selector, quantize **strength**
   slider ("0 leaves the performance alone; 1 puts every marker exactly on its
   slot"), **Detect**, plus reset/clear buttons.
3. **Gap.** `PARTIAL` — grid, strength, detect and reset present. Missing:
   detection mode choice in the panel, threshold, restore-all-markers, guide
   tracks, slice, and the auto-undo-on-reapply affordance.

### 12.6 Quantize vs Slice

1. **FSP8 does.** **Quantize** (default) uses the Strength slider, which "alters
   the Start percentage in the Quantize panel". **Slice** cuts the event at the
   markers into multiple events, with four options:
   - **Autofades** — a short fade-out per slice to avoid clicks.
   - **Autofill** — fills gaps between separated slices with realistic "tails,"
     emulating natural decay, and silences overlapping ends.
   - **Merge** — merge the resulting slices into an Audio Part.
   - **Quantize** — quantize the resulting events across the timeline at a set
     strength, with **no timestretching**: "a single continuous Event is sliced at
     its detected transients, and the resulting multiple Events themselves are
     quantized across the timeline."
2. **MotionLab does.** `quantizeWarp(map, strength, grid)` implements the
   quantize half. Slicing exists only in the **sampler**: `setZoneSlices`,
   `sliceToPads`, `sliceToMidiClip`. There is no arrangement-level slice-at-
   transients producing clips.
3. **Gap.** Quantize → `PARITY`. Slice → `MISSING`, along with all four options.

### 12.7 Quantize Audio keys

1. **FSP8 does.** `[Q]` quantizes selected audio (detecting transients if
   needed); `[Alt]+[Q]` quantizes at **50 % strength**; `[Shift]+[Q]` restores
   original timing. The same keys serve Instrument Parts. The Audio Editor's
   Quantize panel is independent of the Note Editor's and the arrangement's.
2. **MotionLab does.** No `Q` binding anywhere (`shortcuts.ts` has no quantize
   entry). Quantize is a button in the piano-roll toolbar and a strength slider +
   apply in the warp panel. Restore-timing is not implemented at all — the only
   route back is undo.
3. **Gap.** `PARTIAL`/`MISSING` — no keys, and **no Restore Timing**, which is
   the more important half (see §17.9).

### 12.8 Phase-coherent multitrack quantization

1. **FSP8 does.** Group the tracks (`[Ctrl]+[G]`) and the app preserves phase
   relationships automatically: "where there is a snare hit, the first transient
   found (within the range of the snare hit) in the Tracks from top to bottom is
   used as the basis for quantization for all four Tracks; the other Tracks
   simply maintain their existing phase relationships to the quantized Track."
   Bend Marker Ranges across tracks are adjusted to a common start time. A
   **Guides** dropdown in the Bend panel lets tracks be excluded from analysis
   (e.g. quantize a whole kit from kick and snare only). Manual bend edits on
   grouped tracks behave the same way.
2. **MotionLab does.** Absent. Warp maps are per clip and nothing coordinates
   across tracks.
3. **Gap.** `MISSING`. For multitrack drum recording this is the difference
   between a usable and an unusable editor, and it is the strongest argument for
   finishing edit groups (§9).

### 12.9 Elastique / engine attribution

The manual names the third-party stretch engine used to stretch each region
between bend markers. **That name must not appear anywhere under MotionLab or
`motionwave/`.** MotionLab uses its own stretcher (`src/audio/timestretch.ts`).
No gap; recorded here only as an IP boundary marker.

---

## 13. Track Freeze

### 13.1 Audio Track Freeze

1. **FSP8 does.** Right-click the track → *Freeze to Rendered Audio*. Inserts and
   mix automation are rendered into the audio; the original track is replaced by
   a new audio track of the same name with no inserts. Options: **Preserve
   Realtime State** (to be able to freeze back), **Auto Tail** with a **Max
   Length**, or a fixed tail — "Auto Tail is useful if there is a reverb or other
   effect that you want to render beyond the Event length… may not work well with
   lengthy delays or extremely long reverbs, as it works by detecting a range of
   silence at which to cut off and fade out". Volume and pan (and their
   automation) are applied and reset to defaults on the new track; sends, bus
   assignments and other mix parameters are retained. *Freeze to Realtime Audio*
   reverses it. Bounced files go to the Pool and stay until cleared. Multiple
   tracks can be frozen at once, rendered simultaneously.
2. **MotionLab does.** `src/model/freeze.ts` + `src/audio/freeze.ts`.
   `Track.freeze = { mediaId, renderedAt }`; `isFrozen`, `isFreezableType`,
   `freezeClipFor`, `freezeRenderProject`, `freezeRefusal` (a reason string when
   a track cannot be frozen), `freezeRenderSignature` and `staleFreezeTrackIds`.
   Freeze is **reversible by construction** — the track keeps its instrument and
   inserts and simply plays a rendered file instead — so "Preserve Realtime
   State" is unconditional. `sidechainChain(p, track)` resolves what must be
   rendered alongside. `TrackHeader` offers freeze/unfreeze.
   The invalidation rule is the interesting part: `releaseStaleFreezes` in
   `projectStore.ts` runs on **every** `update()` and drops any print the edit
   made untrue, deleting the orphaned media only when the last track referencing
   it lets go, and toasting "That edit released the freeze on X — the instrument
   is playing again." The comment states why refusing the edit instead would be
   wrong: "it could not be enforced honestly anyway: every path into the project
   comes through `update`… The one thing that must never happen is a frozen track
   quietly playing audio of something it no longer is."
3. **Gap.** `PARITY` on the core and **ahead** on invalidation, which FSP8 does
   not describe at all. Missing: tail control (auto or fixed), multi-track
   freeze in one action, and a Pool view of freeze prints with
   remove/delete/remove-unused commands.

### 13.2 Instrument Track Freeze

1. **FSP8 does.** *Freeze to Audio Track* with options: **Render All Channels**
   (when the instrument has multiple outputs), **Render Inserts**, **Preserve
   Instrument Track State**, **Remove Instrument** (to reclaim CPU), **Auto
   Tail**. Produces a new audio track whose send configuration and output routing
   match the original.
2. **MotionLab does.** One freeze path over `isFreezableType`, no per-freeze
   options; the instrument is kept (not removed) because freeze is reversible.
3. **Gap.** `PARTIAL`.

### 13.3 External instrument freeze / bus freeze / quick-convert

1. **FSP8 does.** External hardware instruments freeze in **real time**;
   non-destructive, with the aux channel removed and restored alongside.
   Buses can be frozen too. And: "you can drag Instrument Parts directly from the
   related Instrument Track onto any Audio Track… The Instrument Part is rendered
   to audio, and placed in the location you've chosen."
2. **MotionLab does.** No external hardware instruments (web platform). Bus
   freeze: `isFreezableType` governs; `AUDIO_TRACK_TYPES` includes `bus` and `fx`.
   No drag-part-to-audio-track render.
3. **Gap.** External → not applicable. Bus freeze → `PARITY` (verify against
   `isFreezableType`). Quick-convert → `MISSING`.

---

## 14. Track and Event Inspectors

Toggle: `[F4]` or the "i" button. Two sub-toggles: **Show Event Inspector** and
**Show Channel Fader** (fader, inserts and sends inline).

### 14.1 Track Inspector — audio

| FSP8 field | Range / values | MotionLab | Gap |
|---|---|---|---|
| Tempo (Mode) | Don't Follow / Follow / Timestretch | per-clip `followTempo`; no Don't Follow | `PARTIAL` (§10.2) |
| Timestretch (Mode) | Drums / Sound / Solo / Tape | `preservePitch` boolean | `PARTIAL` (§10.5) |
| Group | assign to a track group | `editGroup` 1–4 | `PARTIAL` (§9) |
| Layers | add / duplicate / rename / remove, choose active | per-clip takes | `PARTIAL` (§11) |
| Layers Follow Events | on/off | n/a by construction | `DIVERGENT` (§11.11) |
| Play Overlaps | on/off | scheduling decision, no control | `PARTIAL` |
| Follow Chords | mode vs the Chord Track | chord track exists (`ChordEvent`, `src/model/chords.ts`, `chordAssistant.ts`); no per-track follow mode | `PARTIAL` |
| Delay | **−1000 … +1000 ms** | absent | `MISSING` |
| Follow Global Transpose | on/off | absent | `MISSING` (§5.4) |
| Tune Mode | algorithm per material | absent | `MISSING` |
| Automation | mode + per-parameter enable | `automationMode` (`read`/`touch`/`latch`/`off`), lanes with enable, `AutomationLanes.tsx` | `PARITY` |
| Parameter (routing/mix) | duplicate of the channel strip | mixer components; inspector shows some | `PARTIAL` |
| Edit Note | track notes window | `Track.notes?` — "free-form per-track note shown in the inspector" | `PARITY` |

### 14.2 Track Inspector — instrument

Additional FSP8 fields: **Timebase** (Beats | Seconds — the film-sync axis,
absent in MotionLab, see §10.2); **Transpose −64 … +64 semitones** (absent per
track); **Velocity −100 % … +100 %** (absent per track); **Retrospective
Recording** (absent — grepped `retrospective`: no hits); **Program** (MIDI
program/bank; MotionLab has `midiChannel?` but no program change);
**Note FX** — present and strong (`Track.noteFx?: NoteFx[]`,
`src/model/noteFx.ts`, `NoteFxRack.tsx`, store ops `addNoteFx`/`removeNoteFx`/
`setNoteFxParam`/`setNoteFxBypass`/`moveNoteFx`/`setNoteFxList`) → `PARITY`.
MotionLab adds `macros` (up to `MAX_MACROS = 8` assignable knobs with per-target
ranges), which FSP8's track inspector has no equivalent for.

### 14.3 Event Inspector — audio event

| FSP8 field | Range | MotionLab | Gap |
|---|---|---|---|
| Event FX | insert rack per event | `ClipBase.eventFx?` + `addEventFx`/`removeEventFx`/`setEventFxParam`/`setEventFxBypass`/`moveEventFx` | `PARITY` |
| Start / End | numeric | absent (drag only) | `MISSING` |
| File Tempo | bpm | `sourceBpm` 20–999 | `PARITY` |
| Speedup | multiplier | `stretch` 0.25–4 | `PARITY` |
| Transpose | **−24 … +24 st** | `transpose` −24…+24 | `PARITY` |
| Tune | **−100 … +100 cents** | absent for clips | `MISSING` |
| Normalize | peak to 0 dBFS, `[Alt]+[N]` | `Normalize to −0.3 dB` (menu) | `PARTIAL` — different target, no key |
| Gain | **−40 … +24 dB** | `gain` (linear) via dialog | `PARTIAL` — no stated range |
| Fade-In / Fade-Out | ms, 0 = none | `fadeIn`/`fadeOut` seconds + shapes | `PARITY` |
| Bend Marker | show | warp lane in the editor | `PARTIAL` |
| Threshold | **0–100 %, default 80 %** | absent | `MISSING` |
| Gain Curve | bypass + show | absent | `MISSING` (§3.3) |
| Time Lock / Edit Lock | two flags | one `locked` | `PARTIAL` (§6.2) |

### 14.4 Event Inspector — instrument part

FSP8: Start/End, **Transpose −24…+24**, **Velocity 0–100 % scaling**, **Loop**
(enable + loop count), Time Lock, Edit Lock. MotionLab: none of Start/End,
transpose, velocity-scale or loop exist per MIDI clip — transpose and velocity
are note-level operations in the piano roll (`transposeNotes`,
`scaleVelocities`), which is a different (destructive) thing.
→ `PARTIAL`, with **Loop** the notable miss (§5.15).

### 14.5 Event Effects

1. **FSP8 does.** Insert effects on one event rather than the whole channel:
   Inspector → Event FX → **Enable** opens an Insert Device Rack; or right-click
   → Event FX → Add Effect. Processing is real-time and in context. A **Tail**
   checkbox processes volume envelopes *after* the effects, since "Event Effects
   may alter the relative volume of an Event, thereby skewing existing volume
   fade envelopes". Effects can be dragged from the Browser onto all selected
   events. **Render** collapses the rack, replaces the event with rendered audio
   and relabels the button **Restore**; the Tail value specifies how far past the
   event end to render, with a volume fade applied across the tail. Rendered
   files go to the Pool.
2. **MotionLab does.** `eventFx` on every clip, with the full store surface, and
   `effectChain.ts` builds it. No Tail, no Render/Restore, no drag-from-browser
   onto a selection.
3. **Gap.** `PARTIAL` — the capability is at parity; the workflow around it
   (render to reclaim CPU, tail handling) is missing.

### 14.6 ARA effects

1. **FSP8 does.** Drag an ARA effect from the Event Editor folder onto an event
   to apply it as Event FX; `[Alt]` applies it as a channel insert instead.
   "adding a second ARA … to an Event will replace the previous Effect with the
   second." ARA effects are highlighted blue in the Event FX section.
2. **MotionLab does.** No ARA — not a plugin-host concept on the web. Third-party
   plugins arrive as Web Audio Modules (`EffectKind` gained `'wam'` in schema v7,
   `src/audio/wam/`), which are ordinary inserts, not analysis-hosting effects.
3. **Gap.** Not applicable / `DIVERGENT-BY-DESIGN`.

---

## 15. Track Presets

1. **FSP8 does.** Save and recall track + channel configurations: inputs,
   settings, routing, names, instruments, pan, levels, "any variables that can be
   set in the Inspector". Stored by right-clicking the track header →
   *Store Track Preset* (with subfolder support) or by dragging a track header to
   the browser; recalled by *Load Track Preset*, *Apply Track Preset* on a
   channel, or browser drag-and-drop, including multi-select drag. Track presets
   **also work with folder tracks**, so a whole group with its buses and FX
   channels is one preset. Loading multiple presets containing identical FX
   channels creates a **single shared instance** rather than duplicates.
   Explicitly **not** stored: Note Events, Audio Clips, Event FX, Automation.
2. **MotionLab does.** `src/model/templates.ts` — session templates (`Template`,
   `TemplateTrack` with `name`, `type`, `color`, `preset`, `output`, `armed`,
   `inserts`, `sendTo`, `folder`), a pure data + builder module that "never
   touch[es] the store or the audio engine". `src/model/presets.ts` covers
   instrument presets and `effectPresets.ts` FX chains. `duplicateTrack` copies a
   track wholesale within a session. There is no per-track preset that survives
   between sessions.
3. **Gap.** `PARTIAL` — the *shape* is defined (`TemplateTrack` is very nearly a
   track preset) but it is session-scoped and not user-authorable. `MISSING`:
   store/load a single track, folder-track presets, FX-channel deduplication on
   load, multi-preset drag.

---

## 16. Edit View Event Editing

1. **FSP8 does.** `[F2]`, the Editor button, double-click an event, or
   View → Editor. Audio Events open the Audio Editor, Instrument Parts the Note
   Editor. The Edit view has its own timeline, zoomed further in by default, and
   its own Snap and Timebase — "the Snap and Timebase settings are not shared
   between the Arrange view and Editor; they remain independent." While open,
   `[Alt]`+double-click an event in the Arrange view zooms the editor to contain
   it (requires *Synchronize Editor to Arrangement* off). The editor detaches to
   its own resizable window and can be pinned, allowing several side by side, and
   any track can be chosen from a dropdown. An **[Action]** button gives quick
   access to the Audio/Musical Functions submenus.
   The **Audio Editor** adds an amplitude scale to the left of the waveform,
   draggable to zoom the waveform vertically, right-clickable for percentage or
   dB scaling, and mirrored by a **Data Zoom** control. Every Arrange tool works
   there except **Paint**.
2. **MotionLab does.** A bottom editor panel (`src/components/shell/BottomEditor.tsx`)
   with tabs from `src/app/editors.ts`:
   `mixer | piano | drums | score | audio | chords | synth | diagnostics`.
   `openEditorFor(clipId, phone?)` opens the right one; double-clicking a MIDI
   clip opens the piano roll. Each editor keeps its own zoom (`prPxPerBeat`) and
   grid (`prSnap`). `MaximizeButton.tsx` expands the panel.
   `AudioEditor.tsx` has its own tool axis — `'notes' | 'tune' | 'stems' | 'warp'`
   — which is a **different kind of tool** from the arrangement's mouse tools:
   these are analysis/processing modes, not pointer behaviours.
3. **Gap.** `PARTIAL`. Present: per-editor open, per-editor zoom and grid, a
   maximise affordance, more editors than FSP8 lists (chords, synth,
   diagnostics). Missing: `[F2]`; detach to a separate window and pin (a real
   constraint on the web, though `window.open` + a portal is possible); several
   editors side by side; Alt+double-click zoom-to-event; a track dropdown inside
   the editor; **independent snap mode** per editor; the amplitude scale and Data
   Zoom in the audio editor; the Action button (partially — see §20).

---

## 17. Note Editor — **directive focus**

### 17.1 Views

1. **FSP8 does.** Three view buttons on the Note Editor toolbar: **Piano**
   (piano-roll with a vertical keyboard that also triggers notes), **Drum**
   (keyboard removed, horizontal room for sample names per note row), **Score**
   (staff notation with musical symbols that also affect playback).
2. **MotionLab does.** Three separate editor tabs rather than three views of one
   editor: `piano` (`PianoRoll.tsx`), `drums` (`DrumEditor.tsx` + `DrumGrid.tsx`),
   `score` (`ScoreView.tsx` + `Glyphs.tsx`, over `src/model/notation.ts` and
   `scoreEdit.ts`). `notation.ts` is substantial: key signatures and enharmonic
   spelling (`spellPitch`, `keyAlterOf`, `detectKey`), clef choice
   (`chooseClef` incl. grand staff), metric trees, duration fitting
   (`fitDuration`), beaming (`beamGroupStarts`, `beamCount`), and a full
   `Score`/`ScoreMeasure`/`ScoreVoice`/`ScoreElement` model.
3. **Gap.** `PARITY` on the three surfaces existing; `PARTIAL` on integration —
   they are sibling tabs rather than views sharing one toolbar, selection and
   track list.

### 17.2 Select-all scope

1. **FSP8 does.** `[Ctrl]+[A]` selects all notes in the focused Part;
   `[Ctrl]+[Shift]+[A]` selects all notes in all Parts **on the track**.
   Full selection actions live under Edit → Select.
2. **MotionLab does.** `pr-select-all` = `Ctrl+A` for the open clip only.
3. **Gap.** `PARTIAL`.

### 17.3 Arrow tools — Extended vs Basic

1. **FSP8 does.** Two arrow tools, toggled by clicking the icon or pressing `[1]`.
   The **Extended** arrow is context-sensitive at high zoom, dividing the note
   body into zones:
   - **Edit Velocity** — click-drag vertically from the **upper** area.
   - **Mute** — `[Alt]`+click in the upper area.
   - **Cut** — click at the **lower** area to split the note.
   - **Cut Deep** — `[Alt]`+click at the lower area of a stack of same-pitch
     notes to split them all.
   - **Glue** — click at the lower area **between** two adjacent same-pitch notes
     to join them.
   The **Basic** arrow disables all of that, leaving move and endpoint trim.
2. **MotionLab does.** One note pointer behaviour. Velocity is edited from a
   velocity lane, a toolbar slider ("Vel", 1–127, applied to the selection), or
   focus + `↑`/`↓` (`Shift` = ±10). Mute is `M` on the selection, `Alt`+click on
   one note, or the note context menu. There is no in-place cut or glue on a note.
3. **Gap.** `PARTIAL` — every *capability* exists; the zoned, tool-free gesture
   set does not, and neither does the Extended/Basic switch.

### 17.4 Moving, creating, deleting, resizing notes

1. **FSP8 does.** Drag to move (left/right = time, up/down = pitch, with the
   vertical keyboard showing the interval). **Double-click empty space creates a
   note** at the current Quantize length; **double-click a note deletes it**.
   Hover an edge for the Sizing tool; a Part can be sized the same way from near
   its top. `[Alt]`+hover near a note edge enables **Resize Adjacent Notes** mode.
   With several notes selected and one being dragged from its end:
   - `[Ctrl]`+drag snaps **all** note lengths to the clicked note's length.
   - `[Alt]`+drag **stretches** the notes across the time grid (indefinitely from
     an outer edge; inner edges eventually pile the middle notes onto the ends).
   - `[Alt]`+`[Ctrl]`+drag the **right** edge makes all notes end together; the
     **left** edge makes all notes start together.
   **Duplicating:** `[Alt]`+click-drag a selection duplicates it to the drop
   position.
   Temporary tools: `[Ctrl]` = Eraser, `[Ctrl]+[Shift]` = Split.
   With multiple Parts visible only one is active for editing; click a note or
   empty space inside a Part to activate it.
2. **MotionLab does.** `PianoRoll.tsx`: drag to move with
   `start: Math.max(0, e.shiftKey ? o.start + dBeats : snapBeat(o.start + dBeats, snap))`
   — Shift bypasses snap, checked per move. Resize handles clamp to
   `Math.max(snap || 0.0625, ...)`. Double-click a note deletes it. Adding a note
   is a click on the grid (or `Enter` at the keyboard cursor via `pr-grid-add`,
   which also removes an existing note there). `Alt`+click toggles mute on one
   note. Keyboard: `←`/`→` nudge (Shift fine), `↑`/`↓` transpose ±1 (Shift ±12,
   scale-lock steps in scale), `Alt`+`←`/`→` resize the focused note by the snap,
   `Ctrl+D` duplicate selection after itself, `Ctrl+A` select all, `Delete`.
   `pr-grid-cursor` gives a roving keyboard cursor over the grid.
3. **Gap.** `PARTIAL`. Missing: double-click-to-create, `Alt`+drag duplicate,
   Resize Adjacent Notes, and all three multi-note resize modifiers
   (`Ctrl` = same length, `Alt` = stretch, `Alt+Ctrl` = align ends/starts). The
   keyboard editing model is **ahead** of FSP8, which documents none of it.

### 17.5 Strums

1. **FSP8 does.** Select a group of notes, click and hold the topmost or
   bottommost, drag left or right and press `[Cmd]+[Opt]` / `[Ctrl]+[Alt]` to
   arrange them into a strum. Strums obey Snap; the manual suggests turning snap
   off (`N`) "For a more humanistic sound".
2. **MotionLab does.** Absent as a gesture. `src/model/chords.ts` has voicing
   operations (invert up/down, drop-2, spread, octave double, chordify at a
   quantize value) exposed in the piano-roll menu, but no time-offset strum.
   `humanizeNotes` can displace timing randomly, which is not the same shape.
3. **Gap.** `MISSING`.

### 17.6 Split tool and Split at Grid

1. **FSP8 does.** In Piano view the Split tool splits a note into two at the
   click; with several selected it splits all of them; `[Alt]` additionally
   splits the **Part**. `[Ctrl]` temporarily gives the Arrow tool. **Split at
   Grid** (Musical Functions) splits selected notes at the current Quantize
   setting, "with splitting occurring only up to the next bar line after the note
   start time", and also applies to whole Instrument Parts and Audio Events.
2. **MotionLab does.** No note-level split at all. Clip split exists (§2.3).
3. **Gap.** `MISSING`.

### 17.7 Paint tool in the Note Editor

1. **FSP8 does.** Click to draw a note at the default length (set in the Note
   Editor Inspector); click again to delete. Drag right while drawing to set
   length; drag up/down after clicking to set velocity. `[Ctrl]` temporarily
   gives the Arrow tool. Click-drag empty editor timeline to create a new **Part**;
   the Sizing tool appears near a Part's top edge.
   In **Piano view** the tool snaps both horizontally (Quantize) and vertically
   (Scale), and the vertical keyboard highlights the hovered note value.
   In **Drum view** it snaps horizontally only, the Pitch Names list highlights,
   and `[Alt]`+drag draws a **line of notes** at the Quantize value.
   `[Alt]` with the Paint tool is **Line Drawing mode**, for notes and for
   automation envelopes; it also works when Paint has been temporarily invoked
   with `[Ctrl]`.
2. **MotionLab does.** Piano roll: click the grid to add a note at the current
   grid length and default velocity; drag to size. `prScaleLock` snaps added and
   dragged pitches to the scale ("Snap added and dragged notes to the scale"),
   with `prKey`/`prScale` and a suggested-scale button ("Suggested from the notes
   in this clip"). Drum editor: `DrumGrid` paints hits at the step resolution
   from `STEPS` (1/4, 1/8, 1/16, 1/32, 1/8T, 1/16T) with a chosen velocity from
   `VELOCITY_PRESETS` (Ghost 36, Soft 72, Normal 100, Accent 122) and a "Velocity
   given to hits you paint" control; the context menu adds **Flam** and
   **Roll ×N**, and a "Show only the lanes this clip plays" filter.
3. **Gap.** `PARTIAL`. Present: painting in both views, horizontal snap, vertical
   scale snap (better specified than FSP8's), a paint velocity default.
   MotionLab adds flam and roll, which FSP8 has no equivalent for. Missing:
   drag-up/down velocity while drawing, Line Drawing mode, drawing a new Part in
   the editor timeline, and Part sizing from inside the editor.

### 17.8 Transform tool for velocity

1. **FSP8 does.** Chosen from the triangle at the edge of the Paint tool. Select
   a range of velocity values in the velocity display, then scale them smoothly
   by dragging handles at the top or bottom, or drag the **corner** handles to
   scale with a sloping action, "mak[ing] it easy to create smooth changes in
   velocity across a range of notes."
2. **MotionLab does.** Velocity editing is per note (drag a bar, focus + arrows)
   or per selection (the "Vel" slider sets one value for all; `scaleVelocities`
   multiplies). No box selection with scale handles, no slope.
3. **Gap.** `PARTIAL` — the *scale* operation exists as a command; the direct
   manipulation with corner-handle slope does not. Note the automation lanes
   already have marquee + multi-point drag, so the interaction exists in the
   codebase for a different object.

### 17.9 Quantizing notes

1. **FSP8 does.** `[Q]` on a selected Part or on selected notes. With **Auto**
   engaged (the `[IQ]` toggle beside the Quantize value), changing the Quantize
   value re-quantizes the selection immediately. **Quantize End** adjusts Note Off
   times. **Restore Timing** (`[Shift]+[Q]`) returns notes to their original
   positions. **Freeze Quantize** makes quantized positions permanent so the next
   quantize works from them — "You cannot Restore Timing for these notes, as the
   newly quantized positions effectively become the original positions."
   **Input Quantize** (Record panel) quantizes while recording and is undoable.
   Grooves can be extracted from an Instrument Part by dragging it into the
   Groove section.
2. **MotionLab does.** `quantizeNotes(notes, { grid, strength, swing, lengths })`
   committed through `transformNotes(clipId, next)` — "Replace the listed notes
   with transformed versions in ONE undoable step… This is how every
   quantize/humanize/transform commits, so each is one Ctrl+Z." Toolbar Q / Str /
   Sw / Quantize button. `lengths` covers Quantize End. Input quantize exists in
   `src/audio/midiRecorder.ts` (grep hit on `quantize` and `swing`).
   `applyGrooveToClip` covers groove quantize.
3. **Gap.** `PARTIAL`. Missing: `[Q]` and `[Shift]+[Q]` keys, **auto-quantize on
   value change** (the `[IQ]` toggle), and — most importantly — **Restore
   Timing**. MotionLab's model is destructive-with-undo: `quantizeNotes` writes
   new starts and the original timing is gone once the undo stack rolls past it
   (`MAX_UNDO = 60`). FSP8 keeps the original positions until Freeze Quantize
   discards them. That is a real modelling difference, not a missing button.

### 17.10 Humanize

1. **FSP8 does.** *Humanize* alters note start and end times and velocity "within
   a very small threshold, based on rules modeled on common human performance
   patterns… Note that the exact results cannot be directly controlled."
   *Humanize Less* uses gentler rules.
2. **MotionLab does.** `humanizeNotes(notes, opts)` with
   `HumanizeOptions = { seed, timing, velocity, length, probability, pitch? }`,
   built on a **deterministic** mulberry32 PRNG: "Humanise must be reproducible:
   the same seed gives the same performance, so a preview equals the committed
   result and a test can assert exact output." `probability` is "chance each note
   KEEPS sounding; below the roll, the note is muted". Menu item
   `Humanize (${scope})`.
3. **Gap.** `PARITY` and **ahead** — parameterised, seeded and reproducible where
   FSP8 is explicitly not controllable. Record as a divergence worth keeping.

### 17.11 Note Editor Inspector

1. **FSP8 does.** For a selected note: start, end, length, pitch, velocity, mute,
   all editable in place, all edited **relatively** across a multi-selection
   except velocity, which snaps every note to the new value. Mouse-wheel over a
   parameter edits it. Plus: track name selector, Mute/Solo/Device Editor buttons,
   **Audition Notes**, **No overlap** ("prevent notes from overlapping. Notes that
   are overlapped completely will be removed. Party [sic] overlapping Note Events
   will be truncated accordingly"), **Default Velocity** (for drawn and recorded
   notes), **Length** (default drawn length, optionally following the quantize
   value), **Q**, **Scale** (root, preset, snap), **Input Chord** (what is being
   played on the controller) and **Selected Chord**.
2. **MotionLab does.** Toolbar controls rather than an inspector panel: grid,
   Vel slider (which **snaps all selected notes to one value** — matching FSP8's
   velocity exception exactly), Q/Str/Sw, Key + Scale + scale-lock + suggest,
   loop-this-clip, zoom. `deleteOverlaps(notes)` implements No-overlap as a
   command ("Remove same-pitch overlaps by shortening the earlier note, never
   deleting. Chords (different pitches) are untouched") rather than a live mode —
   and note it is *safer* than FSP8, which removes fully-overlapped notes.
   Chord detection exists (`src/model/chords.ts`, `chordAssistant.ts`, a chords
   editor tab). No numeric note start/end/length/pitch fields; no audition-notes
   toggle (audition is unconditional); no default-length control separate from
   the grid.
3. **Gap.** `PARTIAL`.

### 17.12 Multitrack note editing

1. **FSP8 does.** `[Shift]`-select Instrument Parts on different tracks to view
   and edit several at once; add more at any time. Double-click a Part to make its
   track the only one shown. The Note Editor has its own **Track List** with
   per-track show/hide and a per-track **Edit Active** pencil — "If a Track is
   shown and Edit Active is not engaged, the Track's notes are not selectable.
   This allows it to be viewed as a reference, and keeps it safe from an
   accidental alteration." Notes are coloured by track and audition through their
   own tracks; selected notes render white. **Transfer Notes** (context menu)
   moves selected notes from one displayed Part to another. **Lock Track List**
   preserves the selection across arrangement track changes; Piano and Drum views
   share a list, Score has its own.
2. **MotionLab does.** One clip at a time — `uiStore.editClipId` is a single id.
3. **Gap.** `MISSING`, entirely. This is the largest structural gap in the note
   editor: reference-track editing is how keyboard and orchestral parts get
   written.

### 17.13 Note colour

1. **FSP8 does.** Four exclusive modes — **Part**, **Pitch**, **Velocity**
   ("from purple for low Velocity to red for high"), **Scale** ("blue for
   in-scale, red for out-of-scale") — plus three independent toggles:
   **Velocity Bar** (a length-coded indicator at each note's left),
   **Black Selection**, **Note Controller** (a stripe through notes carrying a
   controller).
2. **MotionLab does.** Notes are drawn in the clip/track colour with a velocity
   indication and a scale-aware background from `prScale`/`prKey`. No mode
   selector.
3. **Gap.** `PARTIAL`.

### 17.14 Select Part Automation with Notes

1. **FSP8 does.** With it enabled, selecting notes also selects any **visible**
   Part Automation in the note range, so position edits — manual, Quantize, and
   cut/copy/paste/duplicate/delete — apply to that automation too. Automation not
   currently visible is unaffected. It is also the switch that keeps Sound
   Variations attached to notes (§18) and that governs whether automation
   stretches with an Alt-stretched Part (§1.9).
2. **MotionLab does.** Absent. Automation is track-scoped
   (`Track.automation: AutomationLane[]`), not part-scoped, so there is no
   part automation for note edits to carry.
3. **Gap.** `MISSING`, and it depends on **Instrument Part Automation** existing
   at all, which is a larger absence than the option itself.

### 17.15 Scale editor and pitch visibility

1. **FSP8 does.** Piano view only. Choose a root and a scale; in-scale keys get a
   thin blue line, root keys two lines. Custom scales: toggle keys on the
   one-octave display, `[Alt]`+click to change the root ("changing the root key
   also shifts the 'in scale' keys accordingly so that the scale type remains
   intact"), then store/update/rename/delete presets, which are saved to disk.
   **Apply Scale** (Action menu) conforms existing selected notes to the scale.
   **Snap to Scale** highlights the scale in the editor background.
   **Pitch visibility:** **All** (default), **In Scale** (only scale notes, with
   piano keys replaced by interval step labels), **Used** (only recorded notes,
   labelled with octave position).
2. **MotionLab does.** `prKey` (0–11) + `prScale` (id, `'chromatic'` = off) +
   `prScaleLock` ("Snap added and dragged notes to the scale") from
   `src/model/scales.ts`, with a "Suggested from the notes in this clip" button.
   Arrow-key transpose steps *in scale* when scale-lock is on. Scale-aware
   background shading. No custom scale authoring, no presets, no Apply Scale to
   existing notes, no pitch-visibility folding.
3. **Gap.** `PARTIAL`. The **Used**/**In Scale** row folding is the notable miss
   — it is what makes a 128-row grid usable on a phone, which matters more for
   MotionLab than for a desktop DAW.

### 17.16 Drum view specifics

1. **FSP8 does.** Notes as triggers, since "the start of each note the most
   important part". Paint drags across the grid to enter strings of notes at the
   quantize value. **Drum Map** editing behind a wrench button: reorder lanes by
   dragging a handle, hide a lane with its dot, rename in place, colour per lane,
   then **Store Preset**. A **General MIDI** map is provided; maps can be
   **imported** by dragging a map file onto the pitch-names column, and downloaded
   from the vendor's exchange. With the bundled drum instrument, only loaded
   sounds appear as rows, named and colour-coded, unused notes hidden. An
   **in-place instrument editor** (Pad Controls) opens beside the grid with pads,
   sample editor and envelopes, plus a button to open the instrument's own window.
2. **MotionLab does.** `DrumEditor.tsx` + `DrumGrid.tsx` over
   `src/model/drumMap.ts`; step resolutions and velocity presets as in §17.7;
   "Show only the lanes this clip plays" (≈ Hide Unused); flam and roll commands.
   Sampler/drum-rack editing lives in `src/components/sampler/SamplerPanel.tsx`
   with `assignPad`, `makePadZone`, `DRUM_PAD_BASE`, `buildDrumKit`,
   `sliceToPads`.
3. **Gap.** `PARTIAL`. Missing: user-editable drum maps (reorder, rename, hide,
   colour), map presets, GM map, map import, and the in-place instrument editor
   beside the grid.

### 17.17 Note Chase and Cut Long Notes

1. **FSP8 does.** Two Advanced/MIDI options. **Chase Long Notes** — play back a
   long note even when playback starts after its Note On, "effectively treating
   the playback position as the Note On", for drones. **Cut Long Notes at Part
   End** — stop a note if its Part ends before its Note Off.
2. **MotionLab does.** `src/audio/heldNotes.ts` exists and
   `src/audio/scheduler.ts` handles note lifetime; neither is exposed as a
   preference. Whether chase happens on mid-note transport start needs a
   behavioural test rather than a grep to settle.
3. **Gap.** `PARTIAL` — flagged for verification rather than asserted.

### 17.18 Step Record

1. **FSP8 does.** Note-by-note entry: specify a rhythmic value, press keys on a
   MIDI controller to enter notes and chords.
2. **MotionLab does.** Not found in the piano roll. `src/audio/midiRecorder.ts`
   is realtime. `src/components/recording/` holds the recording UI.
3. **Gap.** `MISSING` (see also §21.5, where FSP8's pattern step-record lives).

---

## 18. Sound Variations

1. **FSP8 does.** An articulation system, evolved from Key Switches with full
   backward compatibility. Summarised, because the whole subsystem is absent in
   MotionLab:
   - **Concept.** Input side: MIDI notes (key switches) from a controller.
     Output side: an **Activation Sequence** sent to the instrument, which may
     combine Note On/Off, Note On, Note Off, MIDI CC, Program Change, Bank
     Change and Channel Change steps — because "sophisticated virtual instruments
     require complex multi-input activation sequences… If these libraries used a
     single Key Switch for each articulation available, there would be no keys
     left to play music on!"
   - **Placement.** Sound Variations live in an **Automation Lane**, not among
     the notes: right-click a note → *Apply Sound Variation* (with a "Used" list
     of the last ten); paint them into the Sound Variation lane; or select notes
     and hit `[+]` in the Note Event Inspector to *Apply Active Variation* (with
     no selection, it applies at the playback cursor). "Sound Variations will be
     applied to all coincident Notes", so a chord cannot carry two articulations.
     An entry "remain[s] in effect until another Sound Variation is entered".
   - **Global modes:** *Enable Key Switches* · *Disable Key Switches* ·
     *Use Activation Sequence*.
   - **Editor.** Per-variation Colour, Name, Input Pitch, Score Symbols,
     Default Score Variation, and **Momentary** ("controls if the instrument will
     return to the previous Sound Variation after the Note Off"). Folders. Its
     **own undo/redo, independent of the main history**. Actions: Reload Map from
     Instrument · Assign Default Key Switches · Assign Key Switches Chromatic ·
     Assign Key Switches White Keys · Shift Key Switches (±1 octave / ±1 note) ·
     Clear All Key Switches. Presets: load / Store / Update, saved with the
     session, with instrument presets, or standalone.
   - **Score Setup.** Assign traditional **Musical Symbols** to trigger
     variations, with a **Process** flag deciding whether the host also applies
     its own interpretation (shorter notes for staccato, alternating notes for a
     trill) — undesirable when the library already samples that technique.
     **Dynamics markings** pppp→ffff map to MIDI velocities, "Default values are
     distributed from 13-127", behind a **Process Dynamics** flag. Action menu:
     Load Default · Store as Default (per instrument) · Copy From · Auto Assign
     Symbol Map · Clear Map.
   - **Musical Symbols lane.** *Articulations* are note-based (click to select
     coincident notes, click again for the list, click a third time to apply;
     multiple articulations can apply at once). *Directions* are range-based,
     painted or inserted at the cursor. "Musical Symbols will out-prioritize
     Sound Variations… where one of each is placed in the same position".
   - **Isolation.** Key switches "are filtered and excluded from any type of
     playback processing", ignore transposition, are not triggered by Note FX,
     do not appear in the Score, and survive chord-track following.
   - **Dynamic Mapping.** Qualifying instruments expose their own mapping, which
     is imported automatically and is then read-only but still triggerable.
   - **Alternative triggers.** Twenty Sound Variation slots plus a *Find and
     Apply Variation* command, bindable to keyboard shortcuts, macros, MIDI
     hardware (right-click a mapped control → Assign Command) and the companion
     remote app.
2. **MotionLab does.** Absent, in every part. Grepped `soundVariation`,
   `keySwitch`, `keyswitch`, `articulation` across `src/`: the only `articulation`
   hits are `src/model/audioToMidi.ts` and `src/model/presets.ts`, both unrelated
   prose. The adjacent existing pieces are: `Track.noteFx` (which FSP8 explicitly
   excludes key switches from), track automation lanes (the right host for a
   variation lane), and `src/model/notation.ts` + `Glyphs.tsx` (which already
   draw musical symbols, so the score half has a foundation).
3. **Gap.** `MISSING` — eight of eight sub-behaviours. This is the single largest
   untouched subsystem in the chapter. It is also the one most tied to hosting
   third-party sample libraries, which is not where MotionLab's instrument story
   is today, so its priority is a product decision rather than an obvious debt.
   **Naming caution:** the manual's example library and instrument names, and the
   term used for its remote app, are trademarks; none may appear in MotionLab.

---

## 19. Stem Separation

1. **FSP8 does.** An **extension** (separately installed) that separates any
   stereo or mono track into four stems — **vocals, bass, drums, and "other"**.
   Triggered by `[Ctrl]+[U]` or right-click → Audio/Audio Processing → *Separate
   Stems*. A dialog selects which stems to separate and offers **Consolidate**,
   which merges the selected stems into a new track — "helpful if you would like
   to remove certain stems, but maintain everything else as a single Event."
   Last-used settings are remembered. A progress window follows; "Depending on
   the length of the source material, the process… may take a few minutes."
   Generated tracks are named `{source event name} + {stem type}` and placed in a
   **new folder track** beneath the original, whose track is then **muted**.
2. **MotionLab does.** `src/model/stemSeparation.ts` — `separateStems(channels,
   rate, opts)` returning `Stems = Record<StemName, Float32Array[]>` over
   `STEM_NAMES = ['vocals', 'drums', 'bass', 'other']` (the same four),
   `sumStems(stems)`, and a stated invariant
   `RECONSTRUCTION_TOLERANCE_DB = -80` — the stems must sum back to the original
   within that. Driven from `AudioEditor.tsx` `runStems()`: renders each stem to a
   new media id (`newId('stem-…')`, `source: 'stem separation'`) and adds four
   tracks, toasting "Four stems added; the original is muted, not replaced." UI
   copy warns "a dense one only partly, and the four stems always sum back to the
   original." No extension to install — it is in the app.
3. **Gap.** `PARITY` on the core, and the sum-back-to-original guarantee is a
   stronger claim than FSP8 makes. `PARTIAL`: no per-stem selection, no
   **Consolidate**, no folder track for the results (they are four loose tracks),
   no remembered settings, no `Ctrl+U`, and no progress indication beyond a busy
   label. Naming: the four stem names are generic and safe.

---

## 20. Action Menu (Note Editor)

FSP8 groups the Action menu into **Global, Pitch, Velocity, Quantize, Time,
Mute and Process**. Item by item:

| FSP8 action | What it does | MotionLab | Gap |
|---|---|---|---|
| **Apply Scale** | conform selected notes to the chosen scale | `prScaleLock` snaps *new/dragged* notes only | `PARTIAL` |
| **Quantize Notes** | a full parameter set applied to a selection: grid resolution, type (Triplet/Quintuplet…), Swing, Strength, Range, note starts and/or ends | `quantizeNotes` with grid/strength/swing/lengths | `PARTIAL` (§4.2) |
| **Distribute Notes** | distribute a selection equally, at a variable **Amount** strength | absent | `MISSING` |
| **Repeat Notes to Part End** | repeat a selection as many times as fills the Part | `repeatNotes(notes, times)` — fixed ×2 in the menu | `PARTIAL` |
| **Mirror Notes** | mirror horizontally, vertically, or both, about the **first, middle, last, or a custom note within ±10 octaves** | `mirrorNotes` (pitch, about the selection's own centre) + `reverseNotes` (time, within the selection's span) | `PARTIAL` — both axes exist, no focal-point choice, no combined mode |
| **Randomize Notes** | variable pitch / velocity / length randomisation, original or custom pitch range, original-pitches-only, optionally applying a new Scale | `humanizeNotes` (seeded; timing, velocity, length, pitch, probability) | `PARTIAL` — no pitch-range constraint, no scale application |
| **Thin out Notes** — *Simplify* | delete a percentage, "starting with notes that are less aligned to the grid… a note located on the first beat of a measure is only deleted if all notes that are not on the first beat… have already been deleted" | absent | `MISSING` |
| **Thin out Notes** — *Randomly* | delete a percentage with equal probability | `humanizeNotes.probability` mutes rather than deletes | `PARTIAL` |
| **Thin out Notes** — *Grid* | remove all notes not starting on a grid position | absent | `MISSING` |
| **Fill with Notes** | generate notes to fill a range or Part, optionally applying a scale, filling between two selected notes, at a set length, optionally reusing only existing pitches; pitches enterable from a controller | absent | `MISSING` |

**MotionLab's own note menu** additionally offers, with no FSP8 counterpart:
Transpose ±12, Double/Half length, **Legato**, **Delete overlaps**,
**Chordify** at a quantize value, and four voicing operations (invert up/down,
drop-2, spread, octave double) from `src/model/chords.ts`. Every one commits
through `transformNotes`, so each is one undo step.

→ Net: MotionLab has a comparable *number* of note actions with a different
selection. The generative half (Fill, Distribute, Thin/Simplify) is the gap;
the harmonic half is MotionLab's addition.

---

## 21. Patterns

1. **FSP8 does.** A step-sequencer object that coexists with Instrument Parts on
   the same track, "even sitting right on top of them", making patterns "perfect
   for peppering your more traditional sequences with fills, turnarounds, and
   other flourishes." Two modes: **Melodic** and **Drum**.
   - **Create:** convert a Part (§7), or *Event → Insert Pattern* /
     `[Ctrl]+[Shift]+[P]` for an empty one.
   - **Globals:** **Steps** 2–64 (default 16); **Resolution** 1/2 → 1/64 with
     triplet (T) and dotted (D) variants (default 1/16); **Swing** default 0 %;
     **Gate** default 100 %, range down to very short and up to **200 %**, where
     "changing the Gate value of a tied note only affects the duration of the
     final tied step"; **Accent** default **30 %**.
   - **Entry:** pencil click to add, click again to erase, `[Shift]`+erase across
     lanes/pitches, drag across a row to add multiple (Drum) or set length
     (Melodic), `[Ctrl]` toggles accent. **Tied notes:** `[Shift]`+drag across
     steps; `[Shift]`+drag left shortens; `[Shift]`+drag left inside the first
     step resets to one step. **Chords** (Melodic): same-length notes on one step;
     `[Ctrl]+[Shift]`+drag resizes the chord.
   - **Step Recording:** click a step number to position, play notes on a
     controller; holding lets several land on one step; releasing advances.
     *Insert Rest* button; clicking it before releasing enters a tie.
   - **Realtime recording** into a pattern (or a variation) under loop.
   - **Pattern operations** (both modes): Copy · Paste · **Duplicate**
     (copies the first half onto the second when empty — the manual's worked
     example: a note on step 1 duplicates to step 5; adding step 7 then gives 9,
     13, 15) · Clear Pattern · **Double Resolution** (steps double, up to 64) ·
     **Half Resolution**.
   - **Drum lane operations:** Copy Lane · Paste · Duplicate Steps · Fill Lane ·
     Clear Lane · Set Every 2nd/4th Step · **Shift Lane** (right by one step,
     wrapping) · Double/Half **Lane** Resolution. Toolbar shortcut buttons for
     most of these.
   - **Per-lane** mute and solo, and **per-lane pattern length and resolution**,
     "allow[ing] for intricate polyrhythms" — in both Drum and Melodic modes.
   - **Drum maps** as in §17.16, with Hide Unused · Show Default · Show All ·
     Reset Order · Remove All · Store Preset · Store as Default Preset.
   - **Variations:** unlimited per pattern, each with its own note data, step
     length and resolution; add/delete/rename/reorder/duplicate from the Pattern
     Inspector; double-click a variation (or use the dropdown) to substitute it
     on the timeline.
   - **Step automation:** Velocity · **Repeat** (equidistant within the step —
     "a value of 4 repeats on a note in a pattern with 1/16th-note resolution
     results in four 1/64th-notes") · **Delay** (±50 %, "it isn't possible to use
     a negative delay on the first step") · **Probability** · plus any
     automatable parameter added through the "…" picker, each becoming another
     lane; lanes added and collapsed with +/−.
   - **Inspector:** Audition Notes, **Editor Follows Cursor**.
   - **Management:** Store/Load Pattern Preset with name, description and
     subfolder; drag to/from the browser as a `.pattern` or (with `[Alt]`) a
     music-loop file.
2. **MotionLab does.** No Pattern object. The nearest surface is the **drum
   editor** (`DrumEditor.tsx`/`DrumGrid.tsx`), which is a step-resolution grid
   over an ordinary `MidiClip` — real notes on a real clip, not a pattern with
   variations. It has: step resolutions (1/4…1/16T), velocity presets, a paint
   velocity, flam, roll, per-lane filtering ("Show only the lanes this clip
   plays"), loop-this-clip and zoom. `Note` has `muted`, `pan` and `detune` but
   no repeat, delay or probability. `src/model/hugeMidiProject.ts` and
   `groove.ts` use the word "pattern" in prose only.
3. **Gap.** `MISSING` — eleven of twelve sub-behaviours, with only "a drum grid
   at a step resolution" overlapping. Ranked by value if this is ever built:
   **per-step probability, repeat and delay** first (they are the reason
   pattern sequencing exists and they are cheap on top of `Note`), then
   **variations**, then per-lane length/resolution polyrhythms, then the
   pattern-as-an-object plumbing. Note that `Note.muted`, the deterministic
   `seededRandom` and `applyGroove` already give MotionLab most of the machinery
   probability and delay would need.

---

## 22. Pitch Correction (third-party integration)

1. **FSP8 does.** Deep integration with a licensed third-party pitch editor,
   bundled at its entry tier. `[Ctrl]+[M]` or right-click → *Edit With Melodyne*
   inserts it into the event's Event FX rack and opens its view where the audio
   and note editors live. The audio is analysed automatically and detected notes
   are shown ready to edit; the view maximises and detaches like the other
   editors, and `[F2]` switches back to the Audio Editor. **Detection
   algorithms:** *Melodic* for monophonic lines, *Percussive* for non-pitched
   signals, *Universal* for polyphonic material. It **runs in real time by
   default**, with **Render** to reclaim CPU and the pre-render state stored so
   editing can resume; removing it from the rack loses all edits. It extracts a
   **tempo map** which can be applied to the Tempo Track via a nine-step
   procedure the manual spells out (set timebase to Bars, timestretch to Don't
   Follow, trim to the first downbeat, align to a bar, open in Universal mode,
   use Note Assignment / Tempo Options, drag beat marker 1 to the downbeat, close
   the tempo map, drag the event onto the Tempo Track). And: once analysed, the
   **Audio Event can be dragged to an Instrument Track** to extract notes and
   velocities from the analysis.
2. **MotionLab does.** Its own pitch correction, no third-party host.
   `src/model/vocalTune.ts` — `analyzeVocal()`, `VocalFrame`, `VocalNote`,
   `VocalAnalysis`, `targetPitch(pitch, opts)`, `tuningCurve()`,
   `correctedTrack()`, `noteErrorsCents()`, with `TuneOptions` covering strength
   and retune speed (UI copy: "0 is the hard, obviously-processed snap; tens of
   milliseconds keeps the scoop a singer actually sang"). Exposed as the
   `tune` tool in `AudioEditor.tsx`, with a per-note cents-error display
   (`±N cents` tooltips). Note extraction is the separate `notes` tool (§1.8),
   which reaches an Instrument track by command rather than by drag.
   `src/model/pitch.ts` holds the pitch tracker.
3. **Gap.** `PARITY` on the core job (monophonic pitch correction with strength
   and retune speed) and `PARITY` on note extraction from analysis.
   `DIVERGENT-BY-DESIGN` on architecture: MotionLab owns the algorithm rather
   than hosting a plugin, which is the only option on the web and is the better
   IP position. `PARTIAL`: no polyphonic or percussive detection modes, no
   note-level pitch/timing editing of the detected notes (the correction is a
   curve, not an editable note grid), no tempo-map extraction (§1.7).
   `MISSING`: the render/restore CPU workflow.
   **Naming caution:** the third-party editor's name, its vendor's name, and the
   alignment plugin named alongside it must never appear in MotionLab.

---

## 23. Undo History — **directive focus**

1. **FSP8 does.** Edit → **History** opens a menu that "enables you to view and
   step through virtually every editing or mixing function that has occurred
   since a document was opened. Simply click on any edit in the list to instantly
   roll the document back to the point where that edit was made." The history is
   **cleared when a document is closed** but "remains intact when the document is
   saved and kept open". No depth limit is stated. Locking a track or event is
   explicitly undoable, and the manual recommends *Save New Version* as an
   additional backup around important locks. Input quantize is undoable. The
   Strip Silence and Bend panels each carry an **auto-undo-on-reapply**
   indicator. The Sound Variations Editor keeps its **own** undo/redo, "not
   affected by Fender Studio Pro's main Undo/Redo functionality".
2. **MotionLab does.** `src/state/projectStore.ts`.
   - **Model:** whole-project snapshots. `undoStack: ProjectData[]`,
     `redoStack: ProjectData[]`, `MAX_UNDO = 60`. The stacks hold project
     **objects**, not JSON: "The outgoing project is never mutated again
     (`update()` always works on a fresh clone), so pushing the reference is safe
     and skips a full serialization per edit — measured at ~138 ms per edit on a
     50,000-clip project."
   - **Entry point:** every mutation goes through `update(mutator, { undoable })`,
     which clones, mutates, stamps `modifiedAt`, runs `releaseStaleFreezes`, and
     pushes the *previous* project when undoable and no gesture is open. `undo()`
     and `redo()` swap between the stacks, both bounded at 60.
   - **Gestures:** `beginGesture` / `endGesture` / `flushGestures` collapse a
     continuous drag into **one** undo step. Calls nest with a depth counter —
     "two simultaneous touch drags on a tablet open depth 2, and only the last
     release commits, so neither drag can close the other's undo window and
     strand the rest of the session as non-undoable." `flushGestures` is called
     after every pointer release as a backstop "a drag whose element was
     destroyed mid-gesture must never leave the undo system wedged open", and
     detects whether anything changed by reference identity, which is "an exact
     (and free) change check".
   - **What is deliberately NOT undoable:** continuous UI/tool state — automation
     point drags mid-gesture (`updateAutomationPoints`), touch/latch capture
     (`writeAutomationAt`, "the surrounding control gesture owns the undo step"),
     trim capture (`trimAutomationAt`), sampler slider moves
     (`setSamplerParams`), zone drag edits (`updateSamplerZones`), lane height
     (`setAutomationLane` — "enabled is undoable; height is a continuous UI
     adjustment and is not"), take audition (`setSoloTake`), take-lane
     open/closed (`setClipView`), and project notes ("Not undoable: typing is a
     continuous gesture"). Selection, tool, zoom, snap and editor tab live in
     `uiStore` and are outside the undo system entirely.
   - **What clears it:** `setProject` resets both stacks and the gesture state —
     so opening or importing a project drops the history, matching FSP8.
     Saving does **not** clear it (`markSaved` only touches `dirty` and
     `lastSavedAt`), also matching FSP8.
   - **Bindings:** `Ctrl+Z` / `Ctrl+Shift+Z`; `TopBar.tsx` reads
     `undoStack.length > 0` to enable its button.
3. **Gap.**
   - **`PARITY`:** everything material is undoable through one funnel; locking is
     undoable (it is a `setTrack`/`setClip`); saving preserves history; opening
     clears it.
   - **`PARITY` and ahead:** the gesture-coalescing rules, the nesting guarantee
     and the explicit non-undoable list are more rigorous than anything the
     manual states.
   - **`MISSING`: the history list itself.** There is no browsable list and no
     click-to-roll-back-to-a-point. The data is right there — `undoStack` is an
     array of complete projects — so the gap is a panel plus a label per entry,
     and the labels are the real work (`update()` takes no description today).
   - **`PARTIAL`: depth.** `MAX_UNDO = 60` snapshots vs FSP8's unbounded
     "virtually every… function… since a document was opened". Sixty
     whole-project clones is a memory-driven ceiling; the tradeoff is defensible
     but it is a divergence, and it is the reason Restore Timing (§17.9) cannot
     lean on undo.
   - **`MISSING`:** per-panel auto-undo-on-reapply (§5.9, §12.5), and a
     sub-editor with its own independent history.

---

## 24. Navigating with Zoom

| FSP8 command | Key / gesture | MotionLab | Gap |
|---|---|---|---|
| Zoom in/out horizontally | drag vertically in the timeline | timeline drag not bound; **Zoom tool `[9]`** drags horizontally to zoom | `PARTIAL` (axis differs) |
| Zoom in/out horizontally | scrollwheel over the timeline | `Ctrl`/`Cmd` + wheel zooms (`Arrangement.tsx` line ~484) | `PARTIAL` |
| Zoom In / Out | `[E]` / `[W]` | toolbar buttons `zoomBy(1/0.8)`; no keys | `PARTIAL` |
| Zoom vertically | `Shift+E` / `Shift+W` | zoom tool vertical drag → `laneScale` (0.6–2.5) | `PARTIAL` |
| Zoom vertically | `Ctrl` + wheel | `Shift` + wheel when |ΔY|>|ΔX| | `PARTIAL` |
| Zoom to Loop | `Shift+L` | absent | `MISSING` |
| Zoom to Selection (H+V) | `Shift+S` | `zoomToSelection()` button, horizontal only | `PARTIAL` |
| Zoom to Selection (H) | `Alt+S` | as above | `PARTIAL` |
| Zoom by Selecting | `Alt+Shift`+draw; `Alt+Shift`+click returns | absent | `MISSING` |
| Zoom Full | `Alt+Z` | absent | `MISSING` |
| Track-height key commands | assignable | `Track.height?` per track + `laneScale` global | `PARTIAL` |
| **Zoom History** | Undo Zoom `Alt+W`, Redo Zoom `Alt+E` | absent | `MISSING` |
| **Toggle Zoom** | `[Z]` swaps current with a stored state | `[Z]` is **keyboard octave down** in MotionLab | `MISSING` + conflict |
| **Store Zoom State** | `Shift+Z` | absent | `MISSING` |
| **Auto Zoom** | vertical / horizontal / full; re-zooms on window resize and on adding, duplicating or deleting events; disabled by any manual zoom; mutually exclusive with Synchronize Editor to Arrangement | absent | `MISSING` |
| Link Horizontal and Vertical Zoom | lock icon in drum mode | absent | `MISSING` |

MotionLab's zoom **maths** is stronger than FSP8's documented behaviour — see
§2.9 for the exact constants, the anchor-preserving scroll and the shimmer-
avoiding quantisation. What is missing is the *command vocabulary*: history,
toggle, store, auto and zoom-to-loop. `Z` and `X` are already bound to keyboard
octave, so any convergence must rebind rather than assume.

---

## 25. Macro Toolbar

1. **FSP8 does.** A fully customisable command panel, docked to the top by
   default and detachable (with vertical or horizontal orientation), with
   **independent toolbars for the Arrangement, Note Editor and Audio Editor**.
   - **Macros** string multiple commands into one action. The manual's worked
     example — *Select Parts in Between Selection* — "selects all events, splits
     them at the left and right locator locations, then merges the events that
     are still selected (those within the loop range)". Commands execute in list
     order and can be reordered with Up/Down.
   - **Macro Organizer** (gear menu, or the app menu): browse, search, sort by
     column, New / Edit / Duplicate.
   - **Arguments.** Some commands take arguments — `Track|Expand Layers` takes
     `Expand` = 0 or 1; `Edit Volume` takes `Level` (dB) and `Relative` (0/1) "to
     either set the event volume to the absolute dB value or to add/subtract it
     from the current level."
   - **Toolbar structure.** Pages → Groups → Buttons / Menu Buttons. Right-click
     a group to rename, toggle **Compact**, remove, or add a group / menu button /
     button. Menu Buttons hold items, submenus and separators, all reorderable by
     drag. Buttons take custom **22×22 pixel PNG** icons. `[Ctrl]`+drag moves a
     button (even across groups) or a whole group.
   - **Binding.** Any macro can take a keyboard shortcut (from the Macro Editor's
     Shortcut column, or the Keyboard Shortcuts window) and can be mapped to MIDI
     hardware by right-clicking a control in its device map → Assign Command —
     "even control surfaces that are not natively supported can have commands
     assigned, so long as the desired controls transmit MIDI CC values."
   - **Storage.** One XML file per macro in a folder reachable from the
     Organizer, directly editable and portable for sharing.
   - **Settings.** Go to… · New Group · New Page · Rename Page · Import · Export
     · Macro Organizer · Reset Toolbar.
   - Also: a **Name** button that renames selected events from a customisable
     predefined list, edited as a plain text file with "a simple syntax to build
     the menu hierarchy".
2. **MotionLab does.** The word "macro" is taken by a different feature:
   `src/model/macros.ts` + `MacroPanel.tsx` are **per-track assignable knobs**
   (`MAX_MACROS = 8`, `createMacro`, `targetNorm`, `macroWrites`, `hasTarget`,
   `describeMacro`; store ops `addMacro`/`removeMacro`/`renameMacro`/
   `setMacroValue`/`assignMacroTarget`/`setMacroTargetRange`/
   `removeMacroTarget`) — a continuous multi-parameter controller, not a command
   sequence. The command-sequence idea has no counterpart. What exists nearby:
   a rebindable keyboard map (`src/state/keymapStore.ts`, persisting only
   overrides to `motionlab.keymap.v1`, translating a pressed combo to the
   action's default combo so "every existing handler keeps working", stealing a
   combo from whoever held it because "two actions on one key is never what the
   user meant, and silently ignoring the second is worse", and orphaning a
   displaced default so it stops firing) and a MIDI control-link system
   (`src/model/controlLink.ts`, `MAX_CONTROL_LINKS`, `createLink`, `sameSource`,
   `ControlSource`/`ControlTarget`) — but links target **parameters**, not
   commands.
3. **Gap.** `MISSING` for the macro toolbar as such (six of seven
   sub-behaviours), `PARTIAL` only in that rebinding and MIDI control exist for
   parameters. **Terminology hazard:** "Macro" already means something else in
   MotionLab, so a command-sequence feature must be named differently — and note
   the manual's own worked example is a *sequence of existing MotionLab store
   actions*, which is what makes it feasible: `selectClips` → `rangeSplit` →
   `healClips` is already three callable functions.

---

## 26. Editing Suggestions

1. **FSP8 does.** Two pieces of guidance. **Listen while editing** — loop the
   section being edited rather than trusting the waveform picture; the fast route
   is a Range selection then `[Shift]+[P]` to set the locators around it, then the
   Loop button or `[NumPad /]`; the Listen tool solos any element instantly.
   **Eliminating audible artifacts** — clicks and ticks "usually occur at the
   beginning or end of an audio Event that has been split or cut", and the fix is
   the per-event fade envelope. The manual also notes fades are applied
   automatically to punch-in recordings.
2. **MotionLab does.** The Listen tool (§2.8) covers instant audition. The
   artifact class is handled structurally rather than by advice: zero-crossing
   snap exists (§1.5, though unexposed), comp joins get `COMP_JOIN_FADE_SEC`
   automatically, `createCrossfade` builds the overlap for you, and every audio
   clip carries fades with four shapes whose summing behaviour is documented on
   the type. Set-loop-around-selection is missing (§5.12).
3. **Gap.** `PARITY` on the artifact story, and arguably ahead — MotionLab
   prevents several of the cases the manual advises the user to fix by hand.
   `PARTIAL` on the audition loop: no set-loop-to-selection command.

---

## 27. Gap register — ranked

**Tier 1 — structural absences that block a workflow**

1. **Clip Gain Curves** (§3.3) — a whole editing surface; `automation.ts` is the
   ready-made foundation.
2. **Patterns and Variations** (§7, §21) — including per-step probability,
   repeat and delay, the highest-value slice of it.
3. **Sound Variations / articulations** (§18) — eight of eight absent.
4. **Multitrack note editing with reference tracks** (§17.12).
5. **Phase-coherent multitrack quantize + group comping** (§9, §11.13, §12.8) —
   three gaps, one feature; without them edit groups are decorative.
6. **Slice at transients into clips** (§12.6) with autofade/autofill/merge.
7. **Macro / command sequences** (§25) — noting the terminology collision.
8. **Undo History list** (§23) — the data exists; the panel and per-edit labels
   do not.

**Tier 2 — real gaps with a clear, bounded fix**

9. Snap: **Snap Event End**, **Relative Grid**, snap-to-cursor/loop, and making
   the six behaviours orthogonal to the four modes rather than one exclusive
   union (§1.5); expose `zeroCrossing`.
10. **Sync Points** (§1.10) — a prerequisite for several other behaviours.
11. **Quantize: Velocity % and Range %**, dotted/quintuplet/septuplet values,
    a real Quantize panel that the arrangement grid reads from, and presets
    (§4.2).
12. **Restore Timing / Freeze Quantize** (§17.9) — a modelling change, not a
    button.
13. **Time Lock vs Edit Lock** as two flags (§6.2).
14. **Event looping** with a loop count (§5.15) — needs shared copies (§5.7).
15. **Audio Parts / consolidate selection** (§5.10, §11.14).
16. **Strip Silence UI** (§5.9) — the model is done, the panel is not.
17. **Numeric Start/End on clips**, and **Spot** (§1.6, §14.3).
18. **Track / per-clip Delay (±1000 ms)**, **Tune in cents**, **Global
    Transpose** (§5.4, §14).
19. **Quick-switch a comped section** between takes (§11.8) and **comping
    keyboard navigation** (§11.9).
20. **Zoom vocabulary:** history, toggle, store, auto-zoom, zoom-to-loop
    (§24) — resolving the `Z`/`X` collision.

**Tier 3 — cheap wins**

21. Clip **colour** control (§1.4) — model and renderer already done.
22. **Filename BPM parsing** on import with approve/double/halve (§10.4).
23. **Tap Tempo** (§10.8).
24. **Eraser and Mute drag-sweep**, and acting on the whole selection (§2.4,
    §2.6).
25. **Double-click to create a note**; **`Alt`+drag to duplicate notes** (§17.4).
26. **Red/green stretch colouring** on warped audio (§12.4).
27. Rename all events on a track (§1.3); Select Muted Events (§2.6);
    select-to-start / select-to-end (§2.1).
28. Set loop around the selection (§5.12, §26).
29. Bend **Threshold** control and onset-vs-peak referencing (§12.3).
30. Stem separation: per-stem selection, **Consolidate**, results in a folder
    track (§19).

**Deliberate divergences to record in an ADR rather than close**

- Per-clip metadata instead of shared clip metadata, which removes the need for
  Clip Versions and Separate Shared Copies (§3.1, §3.2).
- Clip-scoped takes instead of track-scoped layers, which removes the need for
  Layers Follow Events (§11.1, §11.11).
- Listen previews beside the transport instead of soloing and seizing it (§2.8).
- Seeded, parameterised humanise instead of an uncontrollable one (§17.10).
- Own pitch-correction algorithm instead of hosting a third-party editor (§22).
- Ripple as a per-operation flag with global-track propagation, instead of a
  persistent mode (§5.13).
- `Ctrl+V` paste and `Ctrl+D` duplicate instead of `Ctrl+P` and `[D]` (§5.1,
  §5.6).
- Bounded 60-step undo of whole-project snapshots (§23).

**IP boundary reminders.** Do not carry across: the host product's name; its
bundled instrument, effect and sampler names; its loop-format extensions; the
names of the third-party timestretch engine, pitch editor, vocal-alignment
plugin, or sample libraries the manual cites; its remote-app name; or its
content-exchange name. Behaviours are free; names are not.
