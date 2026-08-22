# Reference benchmark — Fender Studio Pro 8

TXPPS MotionLab Studio is benchmarked against **Fender Studio Pro 8** (the January 2026
rebrand of PreSonus Studio One Pro; version 8 is the first release under the Fender name).
This file is the single shared statement of what "professional, front to back" means for
this project. Every audit, gap list and milestone in `docs/` refers back to it.

MotionLab is a **browser-native** DAW. Where the reference depends on native-only
capability (VST/AU hosting, ASIO drivers, disc burning, hardware control surfaces over
proprietary protocols), the benchmark is _functional parity of the workflow_, not of the
mechanism — the feature must exist and be usable, implemented with web platform
primitives.

## 0. How to read this document

Sections 1–3 are the wide survey (what the product contains). **Section 4 is the console
build spec** and is the reason this file exists in its current form: our mixer strip shows
inserts as read-only chips that navigate away, and that is the gap being closed. Sections
5–8 cover the plug-in window, the instruments, third-party hosting, and the smaller things
that separate a professional tool from an amateur one. Section 9 is the gap list against
our own code. Section 10 lists sources; section 11 lists everything I could **not**
confirm.

Confidence markers used throughout:

- **[C]** confirmed against the vendor manual or a first-party/established-press source.
- **[R]** reported by a reputable secondary source (press, training vendor) but not
  cross-checked against the manual.
- **[U]** unconfirmed — plausible, commonly believed, or inferred. **Do not build to a [U]
  claim without checking it.** A spec that states a feature we then build wrong is worse
  than a gap.

Note on sourcing: `s1manual.presonus.com`, `soundonsound.com`, `sweetwater.com` and the
PDF manuals are **not directly fetchable from this environment** (egress proxy blocks
them). Everything below was gathered through search-engine extraction of those pages, so
the substance is the vendor's but the exact wording of any given sentence may be a
paraphrase. Where a distinction matters (exact menu-item names, exact ranges) it is marked
[U] unless the extract quoted it.

---

## 1. Product lineage

| Version                 | Ship         | What it added that matters to the console                                           |
| ----------------------- | ------------ | ----------------------------------------------------------------------------------- |
| Studio One 4            | 2018         | Channel Editor with FX Chains; pre- **and post-fader** insert racks on the Main Out |
| Studio One 5            | 2020         | Score view, Show page; Listen Bus; Auto-expand Selected Channel                     |
| Studio One 6            | 2022         | **Micro View** controls in the Insert Device Rack; expanded Channel Editor          |
| Studio One Pro 7        | Sept 2024    | Launcher, AI stem separation, Splice, Deep Flight One, global transpose             |
| **Fender Studio Pro 8** | **Jan 2026** | **Channel Overview**, Arrangement Overview, new visual design, Fender native FX     |
| Fender Studio Pro 8.1   | 2026         | Incremental                                                                         |

PreSonus has been part of Fender since November 2021; the January 2026 release drops the
PreSonus name from the DAW. **[C]**

Pro 8's console-relevant changes: a modernised UI, the new **Channel Overview**, and
improved handling of the divider between the Insert and Send device racks (a mouse-over
divider handle, and more room). **[R]**

Pro 8's new native effects: **Mustang Native** (guitar amp modelling), **Rumble Native**
(bass amp modelling), **Voice FX** (De-Tuner, Delay, Transformer, Filters, Ring Modulator,
Vocoder) and **Studio Verb** (algorithmic reverb inspired by the Lexicon 224, with
parameter sliders, a spectral display, and a "Ping" button that fires a noise burst through
the tail so you can hear/see the space without program material). **[R]** — see §11 for a
conflict in the reported amp-model counts.

---

## 2. Pages / top-level views

| Reference        | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| **Start page**   | Recent songs, templates, demos, setup, what's new                 |
| **Song page**    | The workstation: Arrange + Console + Browser + Inspector + Editor |
| **Project page** | Mastering: ordered track list, master chain, loudness, release    |
| **Show page**    | Live performance: setlists, players, patches, per-song setups     |

---

## 3. Song page anatomy

- **Transport**: play / stop / record / loop / return-to-zero / fast-forward, time display
  (bars·beats·ticks and h:m:s:frames), tempo, time signature, metronome + count-in,
  record mode (overwrite / mix / takes), pre-roll, punch in/out, performance meter.
- **Arrange view**: timeline ruler (bars, time, markers), track headers with
  colour/name/mute/solo/arm/monitor/inserts/sends, clip lanes, automation lanes,
  take lanes, folder tracks, zoom + scroll, **Arrangement Overview** (bird's-eye
  navigator with zoom / pan / highlight).
- **Global tracks**: Marker, Arranger (song sections), Chord, Tempo, Time-signature,
  Video.
- **Track types**: Audio, Instrument, Automation, Folder, Bus, FX channel, VCA.
- **Tools**: Arrow, Range, Split, Erase, Paint, Mute, Bend (time-warp), Listen/scrub,
  Zoom. Snap to grid / events / zero-crossing, adaptive snap, quantize panel.
- **Console (mixer)**: see §4 — this is the deep section.
- **Browser**: Instruments, Effects, Loops, Sounds, Files, Pool, Cloud — search,
  favourites, audition, drag to arrange. **The Browser is the primary source of devices:
  in the reference you add a plug-in by dragging it out of the Browser onto a channel.**
- **Inspector**: everything about the selected track/clip/event.
- **Editors**: Music (piano roll), Drum, Score/notation, Audio editor, Automation.

### 3.1 Editing and production capability

- Comping and take lanes; playlists; loop recording.
- Non-destructive audio editing: trim, split, heal, fades, crossfades, gain, normalize,
  phase invert, mono sum, strip silence, ripple edit, slip, nudge, insert silence.
- **Audio bend / warp**: transient detection, warp markers, timestretch, tempo-follow,
  groove extraction and groove quantize.
- **Melodyne-class pitch editing** → in MotionLab: **Vocal Tune**.
- **Audio → Note** (AI in the reference): convert audio to editable MIDI, mono and poly.
- **Stem separation** (AI in the reference): vocals / drums / bass / other.
- **Chord track + Chord Assistant**; **Arranger track + Scratch Pads**.
- **Note FX**: arpeggiator, chorder, repeater, input filter.
- **Event FX**: per-clip insert effects, render/transform to audio.
- **Automation**: read / touch / latch / write / off, curve shapes, tempo automation,
  automation of every effect and instrument parameter — including **FX Chain Macro
  Controls**.
- **Mixdown / export**: master mixdown, stems, per-track, loop range, formats, dithering,
  normalisation, metadata. **Import**: audio, MIDI file, project merge.
- **Macros, key commands, control link, themes, UI scaling.**

---

## 4. The console, device by device

> This is the priority section. Build from here.

### 4.1 Vocabulary — use these words, not invented ones

Our UI should speak the industry's language. The reference's exact terms:

| Reference term               | Means                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| **Console**                  | The mixer. Not "Mixer view", not "Board".                                            |
| **Channel**                  | One strip. Audio Channel, Instrument Channel, Bus Channel, FX Channel, VCA.          |
| **Main Out** / **Main**      | The master strip. (Also "Output Channel" generically.)                               |
| **Insert Device Rack**       | The vertical list of insert plug-ins on a channel.                                   |
| **Send Device Rack**         | The vertical list of sends on a channel.                                             |
| **Device**                   | Any plug-in occupying a rack slot (effect _or_ instrument).                          |
| **Insert**                   | One device in the Insert Device Rack.                                                |
| **Add Insert** / **+**       | The affordance at the top of the Insert Device Rack that opens the plug-in menu.     |
| **Micro View**               | The few key parameters a device slot reveals _in the rack_, as sliders.              |
| **Mini View**                | The knob-form version of the same idea shown in the **Channel Overview**.            |
| **Channel Editor**           | The per-channel window: Channel Overview / Routing / Macro Controls views.           |
| **Channel Overview**         | One channel laid out **horizontally** across the full width of the app.              |
| **Channel List**             | The console's left-hand list of channels, with filter and visibility icons.          |
| **Console options** (wrench) | The show/hide settings for **Channel Components**.                                   |
| **Small / Large Console**    | The two console density modes; Small hides the device racks.                         |
| **Expand**                   | Per-channel button that widens one channel to reveal its device racks.               |
| **FX Chain**                 | A saved, named chain of devices (with a Splitter it is an _Extended FX Chain_).      |
| **Splitter**                 | A device that splits the chain — serial / parallel / by channel / by frequency band. |
| **Macro Controls**           | 8 knobs, 8 buttons, 2 X/Y pads mapped to any parameters in the channel's devices.    |
| **Cue Mix**                  | A headphone/monitor mix built from per-channel cue sends.                            |
| **Listen Bus**               | Pro-only solo/PFL destination.                                                       |

Sources: PreSonus/Fender manual pages _The Console_, _Effects Signal Routing_, _Channel
Editor and Overview_, _Metering_; Sound On Sound _Using Studio One's Mixing Console_ and
_Studio Pro: The Channel Overview_. **[C]** for the term list; **[C]** for Micro View /
Mini View naming (the Mini/Micro distinction is stated explicitly by SOS's Pro 8 article).

### 4.2 Console-level anatomy (what wraps the strips)

- **Channel List** down the left. It has a **Filter** field near the bottom taking
  comma-separated terms (`bas, guit` shows only Bass and Guitar); an **X** clears it. Icons
  for each channel _type_ along the bottom toggle whole classes of channel visible/hidden.
  **[C]**
- The Channel List has its own **wrench Options** button with at least: _Link visibility of
  Track List and Console_, _Link expansion and visibility of Folder Tracks_, _Auto-expand
  Selected Channel_. **[C]**
- **Console options (wrench, top-left)** controls **Channel Components** — which rows of
  every strip are drawn at all. The Sends/Cue-mix row is one of these toggles. **[C]**
- **Small Console / Large Console.** In Small mode the Insert and Send device racks are
  hidden; in Large mode they are shown, and the **divider between the Insert rack and the
  Send rack can be dragged vertically** to give one more room than the other. Pro 8 added a
  mouse-over handle on that divider. **[C]** for the modes and the drag; **[R]** for the Pro 8
  handle.
- **Expand** (per channel): in Small mode, a button sitting above the Channel Editor button
  next to the fader expands _that_ channel to the right, revealing its racks and routing
  without switching the whole console to Large. With _Auto-expand Selected Channel_ on,
  selecting a channel expands it and collapses the previous one; **Alt/Option-click** keeps
  the previous one expanded too. **[C]**
- **Channel Editor button**: the small "pack of cards" icon at the bottom right of the
  fader opens the Channel Editor for that channel. **[R]**

**Design consequence for us:** the console is not a fixed grid of nine rows. It has a
density mode, a per-channel expand, a user-configurable set of visible rows, and a
resizable split between inserts and sends. Our `.strip` CSS grid with nine `auto` rows
(`src/styles/mixer.css`) encodes the opposite assumption.

### 4.3 Channel strip, top to bottom

The reference's own summary of a fully-populated strip, in order: **input gain (trim) and
polarity → insert effects → sends → pan → mute / solo → monitor / record enable → fader
with level metering → peak indicator → VCA assignment → track type, grouping, automation
mode → channel notes and track icon.** Every one of those is individually hideable via
Channel Components. **[C]**

Concretely, per channel type:

#### Audio Channel

1. **Colour strip / track icon / channel name** (double-click to rename).
2. **Input selector** — which hardware input feeds the channel; monitor button.
3. **Input gain (trim)** and **polarity invert (Ø)**.
4. **Insert Device Rack** (pre-fader).
5. **Send Device Rack** (each send pre/post switchable).
6. **Pan** (and Dual Pan / Binaural Pan available as devices for wider control).
7. **Fader + level meter**, with peak readout and peak-hold; **gain-reduction meter**
   fed by dynamics devices on the channel that report GR. **[C]** for GR reporting from
   VST3 dynamics plug-ins.
8. **Mute / Solo / Record arm / Monitor**.
9. **Output selector** (Main Out, a Bus, a Sub Out).
10. **VCA assignment**, **group** assignment, **automation mode**, **channel notes**.

#### Instrument Channel

Same skeleton, with these differences:

- The channel's **input is the instrument**, not a hardware input. In the console the
  Instrument Channel shows **Event (MIDI) inputs** where an Audio Channel shows audio
  inputs — the extract describes MIDI in/out ports at the left, a blue Monitor button, and
  an orange vertical meter showing MIDI activity. **[R]**
- **The instrument is not an entry in the Insert Device Rack.** It is a separate object:
  you select it in the **Track Inspector's "Out" field**, you open its editor with the
  **piano-key icon on the track header** (or the _Instrument Editor_ key command), and you
  **replace** it by dragging a different instrument from the Browser's Instruments tab onto
  the track. Dragging an instrument from the Browser **into the Console** creates a new
  Instrument Channel. **[C]**
- Instrument inserts sit _after_ the instrument in the signal path; the instrument is the
  head of the chain.

> **Decision for MotionLab:** the reference's split (instrument owned by the _track_, not
> the rack) is defensible but it is exactly the thing users complain about. Since our
> device rack is being built now, put the instrument in a **dedicated slot at the top of
> the rack, visually separated from the inserts by a rule** — same slot chrome, same
> open/bypass/replace verbs, but not reorderable and not removable (replaceable only).
> That is the Bitwig/Ableton convention and it makes the signal order visible, which is the
> whole point of the rack. Label it **Instrument**, not "Insert 0".

#### Bus Channel and FX Channel

- Identical strip to an Audio Channel minus the input stage and record arm.
- **FX Channel** is the reference's name for what other DAWs call an effects return / aux
  return: a channel that exists to be fed by **Sends** and to hold the wet effect in its
  Insert Device Rack. **[C]**
- **Bus Channel** is fed by **output routing** (channels choose it as their Output). A Bus
  sends its summed signal to the Main Out by default and can also be routed to Sub Outs.
  **[C]**
- Buses and FX channels can themselves have sends and inserts. (Our `SendRack` currently
  refuses sends on a bus — see §9.)

#### Main Out (master)

- **Two insert racks**, not one: **"Inserts"** (pre-fader — its output feeds the fader) and
  **"Post"** (post-fader — fed by the fader's output). Each has its own **`+`** to add a
  device. This lets you ride the master fader _into_ a processor, or keep a limiter safely
  after it. **[C]**
- No input stage, no record arm, no sends.
- **Metering differs**: Output channels use **Peak/RMS with K-System options** — the meter
  scale switches between **True Peak, K-20, K-14, K-12 and R128**. Plain Peak metering is
  _not_ offered on output channels. **[C]**
- The Main Out carries a **Clip Counter** above its Peak/RMS meter. **[C]**
- Mono-check / dim / listen-bus controls live around the monitor section rather than on the
  Main strip itself in the reference. **[U]** — our master's MONO/LIM/DIM buttons are a
  reasonable MotionLab-specific addition; keep them but do not claim parity.

### 4.4 Signal flow, and where the fader sits

```
input → trim → polarity → [ Insert Device Rack, in list order, top to bottom ]
      → pre-fader sends tap here
      → FADER → pan → post-fader sends tap here → output routing → bus / Main Out
```

- **Inserts on a normal channel are always pre-fader.** There is no per-insert pre/post
  switch on Audio/Instrument/Bus/FX channels; only the **Main Out** has a separate
  post-fader rack. This is a long-standing and much-requested distinction in the reference's
  own forums. **[C]** for Main Out having both; **[C]** for normal channels being pre-fader
  only (users request post-fader inserts on regular channels precisely because they do not
  exist).
- **Sends** are individually **pre/post fader** switchable. **[C]**
- Pre-fader _metering_ is a separate toggle on the meter's own context menu. **[C]**

### 4.5 The Insert Device Rack — the full behaviour spec

**Listing.** Devices are listed **vertically, in signal order, top to bottom**, one row per
device, inside a boxed rack with a header. The header carries the label (**Inserts**) and
the **`+` / Add Insert** affordance. The rack has **its own menu arrow** at the top which
includes _remove all inserts_. **[C]**

**How many are shown.** There is **no fixed slot count** — the rack shows as many devices
as it has, and the reference imposes no practical per-channel limit (reported as "several
dozen" slots, i.e. no hard cap that users hit). When the rack is taller than its space,
**arrows at the very top and bottom of the rack scroll it**. The rack's height against the
Send rack is set by the draggable divider. **[C]** for the scroll arrows and the divider;
**[R]** for "no hard limit".

> Ours is `MAX_INSERTS = 12` in `src/model/effects.ts`. That is a defensible engineering
> limit for a browser DSP graph — but the rack must _scroll_, not truncate at four with a
> "+N more" chip.

**Adding a device — every route the reference supports:**

| Route                                                                   | Result                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Click **`+` / Add Insert** at the top of the rack                       | Pop-up plug-in menu — behaves like a small Browser, with sorting, and **Favorites** and **Recent Plug-ins** lists **[C]**                                          |
| **Drag a device from the Browser** into the rack                        | Inserted at the drop position **[C]**                                                                                                                              |
| **Drag a device from the Browser onto a Track / Track Lane** in Arrange | Added to that track's channel **[C]**                                                                                                                              |
| **Drag a _preset_** from the Browser into the rack                      | Adds the device **with that preset already loaded** **[C]**                                                                                                        |
| **Drag a device from another channel's rack**                           | **Copies** it to this channel **[C]**                                                                                                                              |
| **Drag the rack header** from another channel                           | **Copies the whole chain** **[C]**                                                                                                                                 |
| Double-click on empty rack space                                        | **[U]** — commonly requested in the reference's forums, so probably _not_ supported there. Support it in ours anyway; it costs nothing and every other DAW has it. |

**Opening a device.** **Double-click the insert**, or use the insert's **menu arrow**, or
**right-click anywhere on the insert** → **Edit**. This opens the plug-in's own window.
**[C]**

**Micro View — what a slot shows when the plug-in window is closed.** A **single click** on
a device in the rack **expands a Micro View downward inside the slot**, revealing a handful
of that device's most-changed parameters as **sliders** — deliberately _not_ all of them.
Multiple Micro Views can be open at once, and the rack's top/bottom arrows scroll among
them. For a third-party plug-in, **right-click → Set Up Micro Edit Parameters** lets you
choose which parameters appear; the default is the plug-in's first five. **[C]**

This is the single most important idea in the reference's rack and the one our chips miss
completely: **a closed device is still a control surface.** A slot shows, at minimum:

- the device **name** (renameable),
- an **on/off (bypass) button** that is visibly a power state,
- a **menu caret** for the device menu,
- and, one click away and without leaving the console, **its key parameters as live
  sliders**.

**Device menu (menu arrow / right-click on the insert).** Extracted items: **Edit**,
**Expand** (open Micro View), **Rename**, **Bypass**, **Favorite** (tags it in the
Browser), **Store Preset**, **Remove**, **Set Up Micro Edit Parameters**. The manual also
describes devices as being able to be "expanded, edited, disabled, replaced, and more" from
their drop-down menus, so **Disable** and **Replace** are near-certainly present too.
**[C]** for the first list; **[R]** for _Disable_ / _Replace_ as literal menu labels.

**Bypass.** Per-device, from the slot's own button and from the menu. A bypassed device
stays in the list, in position, visibly off. (Note: the reference distinguishes _bypass_
from _disable_ — disable releases the plug-in's CPU; bypass keeps it instantiated. **[U]**
on the exact semantics in Pro 8.)

**Removing.** Menu arrow → **Remove**. All at once from the rack header's menu arrow.
**[C]**

**Reordering.** **Click-and-drag a device above, below, or between other devices.** The
drop target is shown between slots. **Splitters cannot be reordered by drag** because they
define parallel topology. **[C]**

**Copying between channels.** **Drag** a device from one channel's rack to another's — the
reference _copies_ rather than moves. Drag the **rack header** to copy the entire chain.
**[C]** (Whether a modifier makes it a move is **[U]**.)

**Making chain order visible.** The rack itself is the answer: a top-to-bottom list in a
boxed container with the signal implicitly flowing down it. The reference does not number
the slots. The Channel Overview (§4.9) makes the same order explicit **left to right**
across the screen. **[C]**

**Presets and chains.** Any device can **Store Preset** from its own menu. A whole rack can
be saved as an **FX Chain** and re-loaded by dragging the chain preset onto a channel; an
FX Chain containing a **Splitter** is an **Extended FX Chain** and can carry **Macro
Controls** (8 knobs, 8 buttons, 2 X/Y pads bound to any parameters of any device in the
chain, and themselves automatable). **[C]**

### 4.6 The Send Device Rack

- Sends are **added**, not pre-listed: you add a send and pick its destination (a Bus, an
  FX Channel, or a plug-in **sidechain input**). Adding to a _new_ FX channel in one step is
  the idiomatic move. **[C]** for sends targeting sidechain inputs; **[R]** for the one-step
  "send to new FX channel".
- Once added, **the Send device appears in the Send Device Rack** with: an **Activate
  button**, a **horizontal Level fader**, a **horizontal Pan fader**, and a **Pre/Post Fader
  button**. **[C]**
- **Send level range is −∞ to +10 dB** and is set by dragging the horizontal level fader.
  **[C]**
- Deactivating a send does not affect its destination channel. **[C]**
- The whole Sends/Cue-mix row can be hidden from Channel Components. **[C]**
- Cue-mix sends appear in the same rack region. **[R]**

> Note the shape: a send is **an object you create**, with a destination, a level, a pan,
> a pre/post flag and an on/off. It is _not_ "one row per available bus". Ours is currently
> the latter (`SendRack` in `src/components/mixer/InsertRack.tsx` maps over `buses`), which
> makes two sends to the same destination impossible and clutters the panel with rows for
> buses you do not use.

### 4.7 Input / output routing on the strip

- **Input selector** at the top of an Audio Channel (hardware input / Aux input). Instrument
  Channels show **Event (MIDI) inputs** instead. **[R]**
- **Output selector** at the bottom: Main Out, any Bus, any Sub Out. **[C]**
- **Monitor** button next to record arm on input-carrying channels. **[R]**
- **Sidechain**: a plug-in that accepts a sidechain shows a **Sidechain button with an arrow
  to pick the source**; alternatively the source channel adds a **Send whose destination is
  that plug-in's sidechain input**. Both routes exist. **[C]**

### 4.8 Metering on the strip

Right-click the meter for its options. **[C]**

- **Normal channels**: Peak, Peak/RMS, Peak Hold, Hold Length, Pre-fader Metering.
- **Output channels**: Peak/RMS only, plus the **K-System scale switch** — True Peak, K-20,
  K-14, K-12, R128. Plain Peak is not offered.
- **Peak/RMS** draws two slow-moving white RMS lines over the fast peak bar.
- **Peak Hold** leaves a held indicator that decays at the configured _Hold Length_.
- **Main Out** additionally shows a **Clip Counter** above the meter.
- **Gain reduction** from dynamics devices is reported into the console meter area (VST3
  dynamics plug-ins can feed it). **[C]**

### 4.9 Channel Editor and Channel Overview

**Channel Editor** — one per channel, with three views: **Channel Overview**, **Routing**,
and **Macro Controls**. Routing is where Splitters build parallel/series/band-split
topologies. Macro Controls is the knobs/buttons/XY-pads surface. **[C]**

**Channel Overview** (the Pro 8 headline feature) — one channel laid out **horizontally
across the full width of the app, above/across the Arrangement**, showing inserts, routing
and key parameters at once. Its point is that you can adjust the important controls of
every device on the channel **without opening a single plug-in window**. For native devices
it renders real graphics — you can **edit the EQ curve and the compressor graph directly in
the Overview**. For third-party plug-ins it shows a **user-definable** set of parameters.
The knob-form controls here are called **Mini View**; the slider-form controls in the
Insert Device Rack are **Micro View**. **[C]**

Known limitation, worth copying deliberately or fixing: both views assume a **linear stack**
of devices and do not represent parallel Splitter topologies well. **[R]**

We already ship a `ChannelOverview` (`src/components/mixer/ChannelOverview.tsx`) and it is
conceptually right. What it lacks is Mini View for _every_ device (it special-cases the
first EQ and the first dynamics device and renders the rest as chips).

### 4.10 Other console capabilities to hold in view

- **Groups** (linked channel controls), **VCA faders**, **Folder track ↔ console linking**.
- **Cue Mixes** for headphone sends; **Listen Bus** (Pro) for PFL/AFL solo.
- **Console navigation**: filter, per-type visibility, auto-expand, link to Track List.
- **Key commands**: _Show Channel Editor_ is bindable and is the fast route to a channel's
  plug-ins; the reference's Help menu writes out an HTML sheet of every command and its
  binding. **[C]**

---

## 5. The plug-in window

### 5.1 The header — what makes a plug-in read as professional

Every stock device in the reference wears the **same host-drawn header** above its own
designed face. That consistency is most of the professional feel: whatever the body looks
like, the header verbs never move.

Confirmed elements of the reference's plug-in header:

- **Preset browser** — a menu-based preset system **drawn by the host, not the plug-in**,
  so third-party plug-ins get the same preset UI as native ones. Presets can be **stored**
  from the device menu and **recalled by dragging a preset from the Browser** onto the
  device (or onto a channel, which instantiates the right plug-in automatically). **[C]**
- **Bypass / on-off** for the device. **[C]**
- **Sidechain button + source selector arrow** on devices that accept a sidechain. **[C]**
- **Micro View setup** (_Set Up Micro Edit Parameters_) for third-party devices. **[C]**
- **Rename**, **Favorite**, **Store Preset**, **Remove** — reachable from the same device
  menu that the rack slot exposes. **[C]**

Elements that are **industry convention** and that a professional plug-in header is
_expected_ to have, but which I could **not** confirm exist in this reference:

- **A/B compare** with a copy-A-to-B action. Cubase has it in the plug-in header; the
  reference's stock devices — **[U]**. Build it; it is cheap and it is what mixers reach for.
- **Per-plug-in undo/redo**. **[U]** in the reference (its global undo is documented; whether
  it captures every plug-in parameter change is **[U]**).
- **In / out level meters and an output-trim** in the header. Common on modern plug-ins;
  **[U]** for the reference's stock set.

### 5.2 Resizing and window behaviour

- Plug-in editors are **floating windows**. **[C]**
- **Studio One has historically had no host-side plug-in-window resize**; VST3 corner-drag
  scaling is a plug-in-side capability. Whether Pro 8 changed this is **[U]** — I found no
  source either way for version 8. Do not claim parity here; ours should be resizable
  because we can be.
- The console is the other half of the story: because of **Micro View** and the **Channel
  Overview**, the reference's whole design bet is that **you should rarely need the floating
  window at all**. Key parameters live in the rack and in the Overview; the window is for
  deep work.
- The Channel Editor / _Show Channel Editor_ key command is the fast route to a channel's
  devices without hunting windows. **[C]**

**Our target:** support **both** — a floating, resizable, draggable window _and_ an inline
expanded face in the rack (our current `InsertRack` accordion is already the second one).
The state of "which device is open" must live in the UI store, not in a component's local
`useState`, or the console and the inspector will disagree about it.

### 5.3 What is actually drawn, per processor family

This is the part that makes a face read as designed rather than generated. For each family,
the minimum the reference draws:

**Equaliser** (Pro EQ3)

- A **frequency-response curve** over a log frequency axis with a dB grid.
- **Draggable band handles** on the curve — drag horizontally for frequency, vertically for
  gain; the handle is the primary control, the knobs below are the fine one. **[C]**
- Either **all individual band curves** or **only the combined curve (drawn white)**; when
  individual curves are hidden, **hovering a handle reveals its curve**, and adjusting any
  band shows its curve temporarily. **[C]**
- A **real-time spectrum** behind the curve, with selectable modes: **Third Octave, 12th
  Octave, FFT Curve, Waterfall**. **[C]**
- Per band: **LC / HC** cut filters with a **slope** selector (**6, 12, 24, 36, 48 dB/oct**),
  **LF / HF** switchable between **shelving and peaking**, plus **Q** and **Gain**. **[C]**
- Conventions we should also carry: per-band **enable**, per-band **solo/listen**, and
  **gain-matched auto output**.

**Compressor / limiter / expander / gate**

- A **transfer-function graph**: input dB on one axis, output dB on the other, a **45°
  unity line below threshold** that **flattens above the threshold according to the ratio**.
  **[C]**
- A **live gain-reduction indicator drawn on that graph** — in the reference, an orange line
  descending from the 0 dB point by the current GR amount. **[C]**
- A dedicated **gain-reduction meter**, and GR reported back to the **console strip**. **[C]**
- Controls: **Threshold, Ratio (default 2:1), Attack, Release, Knee, Auto (program-dependent
  attack/release), Auto Gain (0 dB in → 0 dB out), Key Filter (sidechain filter frequency),
  Sidechain source**. **[C]**
- A limiter additionally shows **ceiling** and a **true-peak / over counter**.
- A gate/expander shows **threshold, range, hold, hysteresis** and marks the threshold on a
  level meter.

**Multiband dynamics**

- The **crossover split points drawn on a frequency axis**, each band's own GR shown
  separately, per-band solo/bypass. (We already do this — `MultibandFace`.)

**De-esser**

- The **detection band drawn as an EQ shape** plus GR history. (We already do this.)

**Saturator / distortion / amp sim / bitcrusher**

- The **transfer curve** of the waveshaper (input → output), which visibly bends as drive
  rises. **[C]** as a general convention; ours already draws the real curve pulled from the
  shaper, which is the right approach.
- Amp sims add: **amp model selector, cabinet/IR selector, mic position, tone stack (bass /
  mid / treble / presence), and a tuner**. Pro 8's **Mustang Native** and **Rumble Native**
  bundle amp models **and 73 stomp-box pedals with a pedalboard-style chain and a built-in
  tuner**. **[R]**

**Delay**

- **Time / division control with tempo sync** (straight / dotted / triplet), **feedback**,
  **mix**, **filtering in the feedback path**, **ping-pong / stereo spread**, **modulation**.
- Drawn: a **tap/echo diagram or feedback decay display** showing where the repeats land
  against the beat. The reference's Beat Delay and Groove Delay expose per-tap grids.
  **[R]** — I could not extract a first-party description of the Analog Delay display beyond
  "the GUI was upgraded in v5". **[U]** on its exact graphics.

**Reverb**

- Controls: **pre-delay, size/decay time, damping (HF/LF), early-reflection vs late-reverb
  balance, width, mix**.
- Drawn: **Studio Verb** shows **parameter sliders and a spectral display**, and has a
  **"Ping" button** that fires a short noise burst through the reverb so you can audition
  and _see_ the full-spectrum tail with no program material. **[R]**
- **Open AIR** (convolution) draws the **impulse response** with log level/time display
  options, and exposes **ER/LR mixing** and **cross-feed/delay**. **[R]**
- For us: a decay-envelope plot plus a live tail spectrum is the right minimum, and a
  **"Ping"-equivalent audition button is a cheap, high-signal feature to copy.**

**Modulation (chorus / flanger / phaser / tremolo / auto-pan / rotary)**

- Drawn: the **LFO waveform** with its rate and depth, animated in time. Phasers/flangers
  additionally show the **moving notch comb response** on a frequency axis. Rotary shows a
  **speed state (slow/fast) with a ramp**.
- Controls: **rate (free or tempo-synced), depth, shape, phase/stereo offset, feedback,
  mix**.

**Stereo / utility**

- Width and mid-side tools draw a **correlation meter and/or a goniometer**; a level meter
  draws **peak/RMS/K-scale**; a spectrum meter draws the **analyser**; a tuner draws a
  **needle/strobe with note name and cents**.

**Vocal tune / pitch**

- Draws the **detected pitch trace against a scale grid**, with the corrected trace over it.

---

## 6. Instruments

The reference's stock set: **SampleOne XT** (sampler), **Presence XT** (sample player),
**Impact XT** (drum machine), **Mai Tai** (polysynth), **Mojito** (mono synth), plus **Deep
Flight One** from Pro 7. **[C]**

Layout conventions by family:

**Synth (Mai Tai)** — a single fixed-size face, organised as a **left-to-right signal path
across a central control panel**: _oscillators (Osc 1 / Osc 2, each with an attached sine
sub-oscillator) + noise → Character → multimode filter (five types, vintage Moog/Oberheim
through modern zero-feedback) → amp_, with **three envelope generators with scalable curve
shapes** and **two free-running LFOs** grouped to the right. Along the **bottom** sits the
**Mod/FX section**: the **16-stage modulation matrix** and the built-in effects. **[C]**

**Mono synth (Mojito)** — the same idea, smaller: monophonic subtractive, **24 dB filter
emulation**, one screen, no matrix. **[C]**

**Sampler (SampleOne XT)** — the face is organised around **the sample and its map**, not
around oscillators: a **waveform display with start/end/loop markers**, a **keyboard/zone
map** for multi-sample layouts, **slicing** of a loop to individual keys, **automatic
time-stretching**, then the same **filter / envelopes / LFO / onboard FX** tail a synth has.
**[C]**

**Sample player (Presence XT)** — a preset-first face: pick a sound, then a small set of
macro-ish tone controls. **[C]**

**Drum machine (Impact XT)** — a **grid of 16 pads** as the primary surface; selecting a pad
swaps the editor below it to that pad's sample and settings. Pro 7 added an **in-place
Impact editor inside the Note Editor**, so pads and the pad/sample editor are reachable
without opening a separate window. **[C]**

**Multi Instruments** let several instruments be layered/split under one channel. **[C]**

**Convention to take:** an instrument's face is **fixed-layout and signal-ordered**, and the
_performance_ surface (keyboard map, pad grid, waveform) is the largest element on it. A
sampler that looks like a synth is a tell that nobody designed it.

---

## 7. Third-party plug-in hosting

MotionLab cannot host VST/AU — the web has no equivalent sandbox — but the reference's
_presentation_ of third-party devices is still the model for how our own device catalogue
(and any future WAM/WebAudio-module support) should behave.

- **Scanning** happens at startup from a configured folder list: _Options → Locations → VST
  Plug-Ins → Add_ the folder; there is a _Use VST plug-ins from VST3 folders_ option.
  64-bit only. **[C]**
- A **Plug-in Manager** (View → Plug-in Manager) is the single place to see what was found,
  **reset the blocklist**, and clear plug-in settings. Plug-ins that crash or fail
  validation during the scan are **blocklisted** rather than silently dropped, and the user
  can reset that list and rescan. **[C]**
- **In the rack, a third-party device is an equal citizen**: same slot chrome, same menu,
  same host-drawn preset browser, same bypass, same drag-to-reorder, same drag-to-copy. The
  only difference is that its **Micro View parameters must be chosen** (_Set Up Micro Edit
  Parameters_; default = the plug-in's first five parameters) because the host cannot know
  which five matter. **[C]**
- **Missing plug-in on song load**: the reference reports missing devices and **keeps
  placeholders** so the song's structure and the device's saved state survive; it does not
  drop the device from the chain. **[R]** — the exact visual treatment of the placeholder
  slot is **[U]**.
- **Degradation principle to copy:** a device that cannot load must **stay in the chain, in
  position, with its name and its stored settings, visibly inactive and passing audio
  through**. Never silently remove it; never fail the whole project load.

For MotionLab this maps directly onto **project version/schema drift**: an `Effect` whose
`kind` is unknown to this build must round-trip through save/load intact and render as a
"device unavailable" slot rather than being stripped by `isKnownEffect`.

---

## 8. What else separates it from an amateur tool

Beyond the console, and beyond what §3 already lists:

1. **Every control has three gestures**: drag to change, double-click to reset to default,
   fine-drag with a modifier. Applied uniformly, no exceptions.
2. **Everything is draggable to everywhere sensible**: presets onto channels, devices
   between channels, chains onto tracks, loops into the arrangement, a plug-in from the
   Browser onto a track header.
3. **Favorites and Recent** everywhere a list of things gets long — the Add-Insert menu is
   a small Browser precisely so it can carry them. **[C]**
4. **The host owns presets**, so preset behaviour is identical across every device.
5. **Nothing lies about state.** A bypassed device stays in position; a hidden channel is
   flagged; a truncated list says how many it hid; a silent channel says _why_ it is silent.
6. **Named, discoverable, rebindable key commands**, with a printable/searchable sheet
   generated from the live bindings. **[C]**
7. **Control Link**: any hardware control can be mapped to any parameter, with a per-device
   control map and a plug-in-follows-focus mode. **[C]**
8. **Metering is a choice, not a default** — peak vs RMS vs K-system vs R128, pre/post
   fader, hold length, per meter, from the meter's own context menu. **[C]**
9. **Latency compensation and device disable** — a "disable" that actually releases CPU is
   distinct from a "bypass" that keeps the plug-in instantiated for instant A/B.
10. **The console is configurable furniture**: density mode, per-channel expand, hideable
    row-by-row components, resizable rack divider, filterable channel list. The strip is not
    a fixed nine-row grid.

---

## 9. Gap list — our console versus the reference

Read against `src/components/mixer/ChannelStrip.tsx`, `InsertRack.tsx`, `PluginFace.tsx`,
`Mixer.tsx`, `ChannelOverview.tsx`, `src/model/effects.ts`,
`src/components/inspector/Inspector.tsx`, `src/styles/mixer.css`, `src/state/projectStore.ts`.

> **In-flight work:** an untracked `src/components/mixer/DeviceRack.tsx` appeared during
> this research pass and `ChannelStrip.tsx` has begun importing it. It already implements a
> device menu (Open / Bypass / Move up / Move down / Copy to… / Remove), HTML5 drag with a
> `application/x-motionlab-device` payload, drop-index insertion, and an `openDevice`
> entry in the UI store. Gaps **1, 3, 4, 5** below are therefore partly addressed already;
> they are still listed because the spec they must satisfy is here.

Ordered by what a professional user notices first.

1. **The console cannot edit a chain at all.** `ChannelStrip.tsx` → `InsertSlots` renders
   `effects.slice(0, 4)` as `<button>` chips whose `onClick` is `focusTrack()` — it selects
   the track and opens the Inspector. There is no add, no reorder, no open, no remove from
   the console. Right-click toggles bypass and that is the only mutation. The reference's
   entire mixing workflow lives in the rack. **This is the gap.**
2. **The rack truncates instead of scrolling.** Four slots, then a `+N more` chip
   (`ChannelStrip.tsx`), and `.strip-inserts` is a fixed `auto` grid row 3 in
   `src/styles/mixer.css` with 15px slots. The reference shows the whole chain and scrolls
   it with rack arrows, and lets the user drag the Insert/Send divider to trade height.
   Our nine-row `grid-template-rows` on `.strip` has no flexible rack row and no divider.
3. **No way to add a device from the console.** The only add affordance is the `<select>`
   in `InsertRack` (`fx-add`), inside the Inspector. The reference has four routes — the
   `+` menu, drag from Browser, drag onto a track, drag a preset — and the `+` menu carries
   **Favorites and Recent**. A `<select>` with `<optgroup>`s is not a plug-in menu: no
   search, no favourites, no recent, no blurbs, no keyboard-first filtering.
4. **Devices cannot be dragged.** `InsertRack` reorders only via ↑/↓ buttons, and only
   inside an _opened_ slot body. The reference reorders by dragging a slot between slots,
   and copies between channels by dragging across the console. `projectStore.copyEffectTo`
   already exists and, before `DeviceRack.tsx`, was called by nothing.
5. **"Which device is open" is component-local.** `InsertSlot` holds `const [open,
setOpen] = useState(false)`. It is not in the UI store, so the console cannot open a
   device the Inspector opened, the state dies on remount, and there is no floating window
   concept anywhere in the app (`grep` for a plug-in window component finds none).
6. **Plug-in faces have no header.** `PluginFace.tsx` draws bodies only. There is no preset
   browser (presets are a `<select>` in the rack's `fx-actions`, load-only — you cannot
   **store** a preset), no A/B compare, no in/out meters, no per-plug-in undo, no rename, no
   resize, no sidechain selector. `describeEffect()` in the slot header is good and should
   stay — it is our Micro View summary — but it is not a header.
7. **No Micro View.** The reference's core rack idea — one click reveals a few key
   parameters _as live controls, in the slot_ — has no equivalent. Our slot either shows a
   text summary or expands into the **full** parameter set (`spec.params` in `InsertRack`),
   which is the wall-of-knobs the reference deliberately avoids. `ParamSpec` in
   `src/model/effects.ts` has no "is this a micro-view parameter" flag to drive it.
8. **Sends are modelled as buses, not as send objects.** `SendRack` maps over every bus and
   renders a row per bus; `ChannelStrip.SendRows` shows at most three, read-only, and clicks
   through to the Inspector. Consequences: you cannot create two sends to one destination,
   you cannot pan a send (no send pan anywhere in the model), the level range is
   `max={1.5}` linear (≈ +3.5 dB) against the reference's **−∞…+10 dB**, there is no numeric
   dB readout on the send fader, and buses are refused sends outright ("Buses route straight
   to Master and cannot send onward") where the reference allows them.
9. **No instrument slot.** Nothing in the console shows which instrument an instrument
   channel is playing, and there is no route to open or replace it from the mixer.
   `TYPE_ICON` gives instrument channels a piano glyph and that is the whole story.
10. **The master is not a master.** `MasterStrip` in `ChannelStrip.tsx` repeats the same
    read-only four-chip rack, has **no post-fader insert rack** (the reference's Main Out has
    _Inserts_ **and** _Post_, each with its own `+`), no clip counter, no K-System/R128 meter
    scale, no metering-mode menu.
11. **Meters have no options.** `StereoMeter` (`src/components/common/widgets.tsx`) computes
    RMS internally but exposes no context menu: no Peak / Peak+RMS / Peak Hold / Hold Length
    / Pre-fader Metering, and no K-20/K-14/K-12/True-Peak/R128 scale on the output.
12. **No gain-reduction feedback on the strip.** Dynamics GR is drawn inside `DynamicsFace`
    and in `ChannelOverview`, but the channel strip itself never shows that a compressor is
    working — the reference reports GR into the console.
13. **The Channel Overview is partial.** `ChannelOverview.tsx` special-cases the _first_ EQ
    and the _first_ dynamics device and renders everything else as a chip. The reference
    gives **every** device a **Mini View** of its key controls, editable in place, including
    a user-definable view for devices it does not know.
14. **No console furniture.** `Mixer.tsx` is a flat horizontal scroller: no Channel List, no
    filter field, no per-type visibility toggles, no Small/Large density mode, no per-channel
    Expand, no wrench/Channel-Components options, no folder-track linking. `Mixer.tsx`'s only
    chrome is one `+` button.
15. **Chains are load-only and flat.** `CHAIN_PRESETS` can be applied but a user chain
    cannot be **saved** as an FX Chain; there is no Splitter, no parallel or band-split
    routing. Macros are the one bright spot — `src/model/macros.ts` already resolves
    targets through `paramRegistry`, so a macro _can_ drive a device parameter — but they
    are bound to a **track**, not to a chain, so a saved chain cannot carry its macros the
    way an Extended FX Chain does, and there is no X/Y pad.
16. **Faces missing for whole families.** `faceKindOf()` in `PluginFace.tsx` returns `null`
    for `delay`, `pingpong`, `reverb`, `width`, `trim`, `gainMatch` and `vocaltune` — those
    devices render as bare knob rows. Delay and reverb are two of the four processors a
    mixer opens most.
17. **`MAX_INSERTS = 12`** (`src/model/effects.ts`) against a reference with no practical
    limit. Defensible for browser DSP, but it must be a _scrolling rack that fills up_, and
    the limit must be visible before the user hits it, not a toast after.
18. **Unknown devices are dropped.** `isKnownEffect()` gates deserialisation; there is no
    "device unavailable" placeholder that preserves an unrecognised device's name and
    parameters through a save/load round-trip. That is the reference's missing-plug-in
    behaviour, and it is what makes projects survive version drift.
19. **No per-device rename and no favourites.** `Effect` has no user label; the Add menu has
    no favourites list.
20. **Vocabulary drift.** Our UI says "Inserts", "Add insert…", "Chain…", "PRE/PST", "Master".
    The reference says **Insert Device Rack**, **Add Insert**, **FX Chain**, **Pre/Post
    Fader**, **Main Out**, **Device**, **Micro View**, **Mini View**, **Channel Editor**.
    Adopt those words in labels, tooltips and `data-testid`s.

### 9.1 Suggested build order

1. **Device rack on the strip** (open / add / bypass / remove / reorder / drag-copy) —
   gaps 1, 3, 4, 5. Nothing else matters until the console can edit a chain.
2. **Rack geometry**: flexible scrolling rack row + draggable Insert/Send divider + Small/
   Large density — gap 2, part of 14.
3. **Micro View**: a `micro?: boolean` (or `microOrder`) flag on `ParamSpec`, defaulting to
   the first 3–5 params, rendered as sliders inside the closed slot — gap 7.
4. **Send objects**: model change from bus-rows to send objects with destination, level
   (−∞…+10 dB), pan, pre/post, enable — gap 8.
5. **Instrument slot** at the head of the rack — gap 9.
6. **Plug-in header** (preset store/recall, A/B, bypass, in/out meters, rename) and a
   floating resizable window driven by the store's `openDevice` — gaps 5, 6.
7. **Main Out**: post-fader rack, clip counter, K-System scales, meter context menu — gaps
   10, 11.
8. **Mini View for every device in the Channel Overview**, GR on the strip — gaps 12, 13.
9. **Console furniture**: channel list, filter, visibility, expand, Channel Components —
   gap 14.
10. **Chains, Splitter, Macros; missing faces; unknown-device placeholder; rename/favourites;
    vocabulary sweep** — gaps 15–20.

---

## 10. What MotionLab does _not_ attempt

Stated up front so "complete" stays honest:

- Third-party plug-in hosting (VST/AU/AAX) — the web has no equivalent sandbox. (But see
  §7: the _presentation_ and the _degradation behaviour_ are still in scope.)
- Physical disc burning / DDP on the Project page.
- Proprietary control-surface protocols beyond Web MIDI.
- Video track scoring beyond a simple reference video (no video export).

Everything else on this page is in scope for MotionLab v2.

---

## 11. Sources

Vendor documentation (reached via search extraction; direct fetch blocked in this
environment):

- PreSonus/Fender Studio One manual — _The Console_:
  <https://s1manual.presonus.com/en/Content/Mixing_Topics/The_Console.htm>
- _Effects Signal Routing_:
  <https://s1manual.presonus.com/Content/Mixing_Topics/Effects_Signal_Routing.htm>
- _Channel Editor and Overview_:
  <https://s1manual.presonus.com/Content/Mixing_Topics/Channel_Editor%20and%20Overview.htm>
- _Metering_: <https://s1manual.presonus.com/Content/Mixing_Topics/Metering.htm>
- _Master Device Rack_: <https://s1manual.presonus.com/Content/Mastering_Topics/Master_Device_Rack.htm>
- _Instrument Tracks_: <https://s1manual.presonus.com/Content/Recording_Topics/Instrument_Tracks.htm>
- _Built-in Virtual Instruments_:
  <https://s1manual.presonus.com/Content/Built-In_Instruments_Topics/Chapter-Built_in_Virtual_Instruments.htm>
- _Pro EQ3_: <https://s1manual.presonus.com/Content/Built-In_Effects_Topics/EQ.htm>
- _Track List_ (channel visibility/filter):
  <https://s1manual.presonus.com/Content/Arranging_Topics/Track_List.htm>
- Studio One Pro 7 release notes:
  <https://www.fmicassets.com/sites/presonus.com/img/studio-one-pro-7/PDFs/Studio%20One%207%20-%20Release%20Notes.pdf>
- PreSonus Knowledge Base — 3rd-party plug-ins not showing up (Pro 7):
  <https://support.presonus.com/hc/en-us/articles/29252556213773>
- PreSonus Knowledge Base — missing files/devices on song load:
  <https://support.presonus.com/hc/en-us/articles/9168067437069>

Press and training material:

- Sound On Sound, _Using Studio One's Mixing Console_:
  <https://www.soundonsound.com/techniques/using-studio-ones-mixing-console>
- Sound On Sound, _Studio Pro: The Channel Overview_ (Micro View vs Mini View):
  <https://www.soundonsound.com/techniques/studio-pro-channel-overview>
- Sound On Sound, _Studio One Metering Options_:
  <https://www.soundonsound.com/techniques/studio-one-metering-options>
- Sound On Sound, _Studio One: Compressor Options_:
  <https://www.soundonsound.com/techniques/studio-one-compressor-options>
- Sound On Sound, _Studio One: FX Chains_ and _Studio One 4: Channel Editor FX Chains_
- Sound On Sound, _Studio One becomes Fender Studio Pro_:
  <https://www.soundonsound.com/news/studio-one-becomes-fender-studio-pro>
- PCAudioLabs, _Pre and Post Master Fader Inserts in Studio One 4_:
  <https://pcaudiolabs.com/pre-and-post-master-fader-inserts-in-studio-one-4/>
- PCAudioLabs, _How to Drag-and-Drop Inserts in Studio One_:
  <https://pcaudiolabs.com/how-to-drag-and-drop-inserts-in-studio-one/>
- OBEDIA, _How To Add Inserts In Studio One 4_: <https://obedia.com/how-to-add-inserts-in-studio-one-4/>
- Sweetwater SweetCare, _Working With Plug-Ins in Fender Studio Pro_ and _Fender Studio Pro
  Quickstart Guide_
- Production Expert, _Fender Studio Pro 8 — First Look_ and _What's New In Fender Studio
  Pro 8.1 For Audio Pros_
- MusicRadar, _PreSonus Studio One Pro is dead, long live Fender Studio Pro_
- Synth Anatomy, _Fender Studio Pro 8_ (native plug-in list)
- MusicTech, _How to build synth textures with Mai Tai and Mojito in Studio One_
- Audeobox, _Sample One XT Guide_
- Splice, _Studio One Pro 7: 9 New Features You Need to Know_

---

## 12. Unconfirmed / disputed — check before building

- **Amp-model counts in Pro 8.** One report says Mustang Native and Rumble Native carry
  **39 amp models each** with 73 pedals; another says the pair total **57 guitar and bass
  amp models**. Both are secondary sources. Do not quote a number.
- **Exact device-menu item list.** _Edit, Expand, Rename, Bypass, Favorite, Store Preset,
  Remove, Set Up Micro Edit Parameters_ are attested. _Disable_ and _Replace_ are described
  in prose but not confirmed as literal menu labels.
- **Whether Pro 8 added host-side plug-in-window resizing.** Historically absent; no source
  found for version 8 either way.
- **A/B compare, per-plug-in undo, and in/out meters in the stock plug-in header.** Standard
  industry convention (Cubase has A/B in the header) but not confirmed for this reference.
- **The exact visual treatment of a missing/unloadable device slot.** Placeholders are
  reported; the chrome is not documented in anything I could reach.
- **Bypass vs disable semantics** (CPU release, latency behaviour) in Pro 8.
- **Whether double-clicking empty rack space adds a device** in the reference. Feature
  requests in its own forums suggest it does not.
- **`F11`**: described in one place as _Instrument Editor_ and in another as _Channel
  Editor_. Likely version-dependent, and rebindable in any case.
- **The Main Out's monitor-section controls** (mono check, dim, listen bus placement). Ours
  are a MotionLab addition; do not claim parity.
- **Number of visible insert slots before scrolling.** The reference sizes the rack by the
  Insert/Send divider rather than by a slot count, so there is no fixed number to match.

---

## 13. Stock effect devices, face by face

This section deepens §5.3. That section stated the conventions each _family_ follows; this
one takes the devices individually — what each does, how its own face groups its controls,
and, the part that drives our build, what it **draws**.

Fender Studio Pro 8 inherits the Studio One device set essentially whole and adds its own
native plug-ins on top of it (§1). The device and parameter names below are the Studio One
names as they appear in the vendor manual and in PreSonus/press documentation; where Pro 8
adds or supersedes something, that is called out in place. Sourcing is as §0 describes —
search extraction of pages this environment cannot fetch directly — so a control **name** is
marked **[C]** only where the extract read as manual text quoting it, and a claim about
_where_ something sits on the face is marked **[U]** unless a source described the position.

### 13.1 Dynamics

#### Compressor

The general-purpose compressor, and the device §5.3 describes the transfer graph for. Its
face groups as: the **graph** with the level meters beside it; a row of **timing and law**
knobs (Threshold, Ratio, Knee, Attack, Release); a **behaviour** row of buttons (Auto,
Auto Gain, Look Ahead, Adaptive); and the **sidechain** controls. **[R]** for the grouping.

Ranges the manual states: **Threshold −48 dB to 0 dB**, **Ratio 1:1 to 20:1**, **Knee 0.1 dB
to 20 dB**, and **Look Ahead is a fixed 2 ms** engaged by a button rather than a time knob.
**Auto Gain** makes a 0 dB input produce a 0 dB output. **[C]**

**Displayed.** Three things, and they are separate objects on the face, not one composite
meter:

- The **compression curve**, whose **handles are clickable and draggable in the display** —
  the graph is an input surface, not a readout. **[C]** This is the same idea as the EQ's
  band handles and it is worth copying: the threshold is set on the picture.
- An **Input Level** meter showing **peak _and_ RMS together**. **[C]**
- A **Reduction** display reading **−60 dB to +3 dB** which shows both the instantaneous
  attenuation **and the maximum reduction reached** — a held peak-GR figure, not just a
  bouncing bar. **[C]**

The **Sidechain** button sits **at the top of the effect window**, next to the preset menu —
i.e. it is part of the host-drawn header region described in §5.1, not of the device body.
**[C]** The sidechain filter can be applied to an external key signal _or_ to the internal
detector signal, so "key filter" is not exclusively a sidechain feature. **[C]**

#### Limiter2

The brickwall limiter, and the device the Main Out reaches for. Studio One 5 overhauled it;
it carries **three attack speeds** and **two modes controlling distortion character**.
**[R]**

Controls: **Input** (gain into the limiter), **Ceiling** (maximum output), **Threshold**,
**Release**, **True Peak (TP)**, **Soft Clip**, and **K-System metering as an option**.
**[R]** The Threshold behaviour is the distinctive part: when Threshold is set _below_ the
Ceiling the device becomes a levelling amp using a **soft knee and a fixed 1:20 ratio between
the threshold and ceiling values**, and the numeric readout is an absolute value **variable
from the ceiling down to 12 dB below it**. **[R]**

**Displayed.** Gain reduction, output level, and — when K-System metering is engaged — the
output meter switches to the **K-20 / K-14 / K-12 / True Peak / R128** scales that §4.8
describes for output channels. **[R]** I could not confirm whether Limiter2 draws a transfer
graph at all; the sources describe it as a knob-and-meter face rather than a curve face.
**[U]**

> The transferable idea: a limiter's picture is **not** a transfer curve. On the 0…−60 dB
> axis every other dynamics processor uses, a brickwall's whole law is one pixel in the
> corner. Its meters and its over-count are the display. Our `axisTopOf()` already works
> around this by giving the limiter a +24 dB axis; the reference's answer is to not draw the
> curve at all.

#### Gate

An expander with a **1:∞ ratio** — everything below threshold is attenuated by the Range
amount rather than muted outright. **[R]**

Controls: **Threshold Open** (the level at which the gate opens) and **Threshold Close**
(the close level, set _relative to_ Threshold Open) — which is hysteresis expressed as two
thresholds rather than as one "hysteresis" knob; **Range** (maximum attenuation, stated
elsewhere as 0 to −84 dB); **Attack** (0.02–500 ms); **Hold**; **Release** (0.05–2 s); a
**Key Filter** frequency; and a **Sidechain** button. **[R]** for the two-threshold form and
the ranges; the 0/−84 dB figures come from PreSonus knowledge-base articles that describe the
StudioLive/Fat Channel gate as well, so treat them as the family's ranges rather than as
Studio One Gate's exact ones. **[U]**

**Displayed.** A gain-reduction indication and a level meter with the threshold marked on
it. I could not confirm that the Gate draws a transfer graph. **[U]** — do not assume it
mirrors the Compressor's face.

#### Expander

A separate device from the Gate: a **downward expander with sidechain**. Controls:
**Threshold**, **Range**, **Ratio**, **Attack**, and the same **2 ms Look Ahead** button the
Compressor has. **[R]** Its display is **[U]**.

#### Multiband Dynamics

**Five** bands — Low, Low-Mid, Mid, High-Mid, High — not three. A frequency knob sets each
crossover. Per band there are **Mute, Solo and Bypass** toggles plus **Low Threshold and High
Threshold** (the pair defines the window within which the band is processed, which is what
makes this device an expander _and_ a compressor per band), **Ratio**, **Attack** and a
**Gain**. **[R]**

**Displayed.** The single most copyable meter in the whole device set: **the main display
shows each band's input level along the top and its output level along the bottom**, and the
output half **deepens toward red as compression attenuates the band, or shows green when the
band is being boosted**. **[R]** That is per-band gain reduction rendered as a colour-coded
input/output pair rather than as five separate GR bars, and it reads at a glance.

#### De-Esser

Controls: **Frequency** (target centre frequency), **S-Reduction** (amount), and two
audition buttons — **Listen** (hear the targeted band) and **Solo** (hear the reduced
signal). A **Shape** control (with at least a "Wide" setting) and a **Range** control (with
at least a "Full" setting) are named in the sources but not explained. **[R]** for Frequency,
S-Reduction, Listen and Solo; **[U]** for Shape and Range semantics.

**Displayed.** I could not confirm what the De-Esser draws. **[U]** Our own `DynamicsFace`
band strip (the detection band drawn as an EQ shape under the transfer curve) is a
MotionLab decision, not a copy — §5.3's claim that the reference does this is not something
I could re-confirm, so do not cite it as parity.

The two audition buttons **are** confirmed and we do not have them. A de-esser without a
listen/solo button is a de-esser you tune by guesswork.

#### Tricomp

A three-band compressor whose selling point is that it **sets threshold and ratio
automatically for all three bands**, leaving the user a **relative** control for the low and
high bands and a **switchable automatic attack and release** (`Auto`). Controls: **In Gain**,
the three band controls, **Auto**, **Mix** (parallel-compression blend), and an output gain.
**[R]**

**Displayed.** **Separate input and output meters, each paired with its own gain knob**, plus
a **dedicated gain-reduction meter**. **[R]** The pairing of a meter with the knob that feeds
it is the layout idea here: gain staging is done by looking at the meter immediately beside
the control.

#### Fat Channel XT

The channel strip, modelled on the StudioLive console strip. It contains **five processors in
fixed order: high-pass filter, gate/expander, compressor, EQ, limiter**, and the
**compressor and EQ order can be reversed**. **[C]** for the five processors and the
reversible order.

It ships **three compressor models** — StudioLive Standard plus State-Space-modelled **Tube**
and **FET** — and **three EQ models** — StudioLive Standard plus **Passive** and **Vintage**.
All three compressor models have **Key Listen**. The Fat Channel Plug-in Collection adds
**eight further compressor and seven further EQ models** which appear inside the same face.
**[C]**

**Layout — the important part.** Fat Channel XT has **Processor Select buttons** (HPF/Gate,
Compressor, Equalizer, Limiter) **and a Stacked Mode toggle**: with Stacked Mode off only the
selected processor block is drawn; with it on **all four are drawn at once, stacked**. Each
processor has a **round on/off button beside its name** in the selector row _and_ its own
enable switch inside its module. **[C]**

That is a genuinely different answer to the "too many controls" problem from Micro View: the
device itself has a density mode. A multi-processor face should be **selectable or stacked**,
user's choice, with the processor on/off buttons always visible whichever mode is active.

**Displayed.** The EQ module draws a curve with **LS/HS shelving toggles** on the low and
high bands and per-band enable, Freq, Gain and Q. **[C]** Per-module gain reduction and level
metering are near-certain given the strip's purpose but I could not confirm their form.
**[U]**

#### Channel Strip

The small, plain channel strip — dynamics plus equaliser in one device, distinct from Fat
Channel XT. **[R]** Its input stage carries **Gain** and **polarity/phase**. **[R]** I could
not confirm its band count, its control layout or anything it draws. **[U]** Do not build to
this one without better sourcing; Fat Channel XT is the better model anyway.

### 13.2 Equalisation and filters

#### Pro EQ3

The flagship EQ, and the most thoroughly documented face in the set. §5.3 already covers the
curve, the draggable band handles, the Show Curves behaviour, the spectrum modes and the
per-band slopes. What it does not cover:

- **Eight bands with fixed roles**: **LC** and **HC** (low-cut and high-cut), **LF** and
  **HF** (each switchable between **shelf and peaking**), and **LMF, MF, HMF** (peaking).
  **[C]**
- **Dynamic Mode** on the **LF, LMF, MF, HMF and HF** bands — not on LC/HC. With it engaged,
  the band's gain change is **triggered by the signal crossing an amplitude threshold**,
  which makes Pro EQ3 a dynamic EQ. **[C]**
- **Band Solo**, which auditions the selected band **as a band-pass** to find the exact spot.
  It does not change the mix, and **on a dynamic band the dynamics stay active while
  soloed**, so what you hear is what the band is doing. **[C]**
- **Auto Gain**, which compensates for the EQ's own gain change. **[C]**
- A **Level Range** field selecting **6 dB / 12 dB / 24 dB** for the display's vertical
  scale, affecting the picture only and not the audio. **[C]**
- The **Spectrum Display Type** field selecting **Third Octave, 12th Octave, FFT Curve,
  Waterfall — or None** to switch the analyser off entirely. **[C]**
- A **piano keyboard graphic below the spectrum display**, whose keys line up with the
  12th-octave bands so any point on the curve **reads as a musical note**. **[C]**

**Layout convention.** The display occupies the top of the face and the per-band controls sit
in a row beneath it, with the display-configuration fields (Level Range, Spectrum Display
Type, Show Curves) grouped as display settings rather than mixed in with the audio
parameters. **[U]** for the exact arrangement; **[C]** that the keyboard graphic is _below_
the spectrum.

Three ideas here that our EQ does not have and should: an analyser that can be **turned off**,
a **vertical scale the user chooses**, and a **note-name axis**. The last one costs almost
nothing and answers the question every EQ user actually asks.

#### Autofilter

A filter device with an envelope follower and an LFO — the reference's "secret equaliser".
Two filters with a **Chained/Parallel** switch between them. Filter models: **Ladder LP 12,
18 and 24 dB; Analog SVF 12 and 24 dB; Digital SVF 12 dB; Comb; Zero Delay LP 24 dB**.
Controls: **Cutoff**, **Reso**, **Drive** (filter overdrive), **FLT Spread** (the offset
between filter 1's and filter 2's cutoffs), **Envelope Length** (one knob setting both the
attack and release of the follower), and **LFO Speed**. **[R]**

**Displayed.** Not confirmed. **[U]** The interesting modelling detail is that this device has
**two** filters with a spread and a series/parallel switch, which our single `filter` device
does not.

### 13.3 Distortion, saturation and amp modelling

#### Ampire / Ampire XT

The amp, cabinet and pedalboard device. Three stacked regions, top to bottom: **amp**,
**cabinet and microphones**, **pedalboard**. **[R]**

- **Amp**: five amplifier models in the base Ampire, State-Space modelled, with the usual
  tone stack. **[R]**
- **Cabinet**: sixteen cabinet emulations built from State-Space modelling **combined with
  impulse responses**. A **User Cabinet** option turns the cabinet section into an **IR
  loader taking up to three IRs, one per microphone**, each added with a **`+` beside the
  mic**. **[R]**
- **Microphones**: an SM57-style dynamic, a Royer-style ribbon, a Neumann-style
  large-diaphragm condenser, and a crossed stereo pair of small-diaphragm capacitors; three
  of the four are configured per cabinet. You **blend between them relatively or
  independently**, **invert polarity** per mic, and **mics B and C have a Delay parameter**
  that moves them nearer or further from the source. **[R]**
- **Pedalboard, along the bottom**: **eight slots** drawn from **thirteen pedals** (five
  State-Space modelled on a Big Muff, a RAT, a Tube Screamer, an MXR Phase 90 and a Boss CE-1
  chorus). Pedals are **arranged in any order by dragging**, and **a metal bar on the
  pedalboard is itself draggable left and right**: pedals to the left of the bar are in front
  of the amp, pedals to the right are in the amp's effects loop. **[R]**
- **Tuner**: a full-size version of the standalone Tuner device with **standard and strobe
  modes and a calibration knob**, built into the amp face. **[R]**

**Displayed.** The pedalboard _is_ the display — chain order is shown as a physical row of
objects with a movable divider marking the amp's position in the chain. This is the
reference's only device that draws its own signal order, and it is the right answer for any
device that hosts sub-devices. The mic blend is the second display: three mics with levels,
polarity and distance is a spatial picture, not a knob row. **[U]** on whether Ampire draws a
level or GR meter anywhere.

Ampire XT (5.5) added **fast preset switching for the Show Page** so presets can be recalled
from a MIDI pedalboard live. **[R]**

#### Mustang Native and Rumble Native (Pro 8)

Pro 8's Fender-derived guitar and bass amp devices, derived from the hardware Mustang and
Rumble DSP amp lines. Each carries **amp models, the shared stompbox set, a built-in tuner,
and a large preset library**. One Fender article states **39 amp models each and 73 pedals
shared, with 200+ presets for Mustang and 100+ for Rumble**; other Fender-sourced material
states **57 guitar and bass amp models** in total. §12 already flags this conflict and it
remains unresolved — **do not quote a model count.** **[R]** for the structure, **[U]** for
the numbers.

One first-look review notes that the plug-in **shows a smaller window with nothing editable
until the plug-in finishes loading**, and treats that as an under-used idea. **[R]** The
transferable point is that a heavy device should draw a **legible loading state**, not a
blank rectangle.

#### RedLight Distortion

Analog distortion emulation with **six selectable models: Soft Tube, Hard Tube, Bad Tube,
Transistor, Fuzz, OpAmp**; **two EQ controls**; a **Mix** control; and **independent Drive and
Distortion controls** — two separate gain stages, which is the distinction our single `drive`
knob collapses. **[R]** Display **[U]**.

#### Bitcrusher

Controls: **Overdrive** (clean through fuzz), **Bit Depth** (down to **1 bit**), **Dirt** (a
button adding high-frequency instability to the bit-depth reduction for more pronounced
artefacts), **Downsample**, **Zero** (a button emphasising the high-frequency ringing the
downsampler produces), and **Clip** (a threshold; at 0 the signal is untouched, below 0 it is
clipped by whichever of three distortion algorithms is selected). **[R]**

Note the shape: **two knobs and two character _buttons_**. The buttons are the interesting
part — a lo-fi device's personality lives in switches, not in more knobs. Display **[U]**.

#### Console Shaper

The first generation of **Mix Engine FX** — a device class that runs on the summing engine
rather than as an ordinary insert, Pro-tier only. **[R]** Its face and its metering are
**[U]**. Worth knowing it exists because it is a _fourth_ device location (not insert, not
send, not instrument) and our model has no concept of it.

### 13.4 Delay

Three delay devices, deliberately different from one another rather than three presets of
one engine. **[C]** that the set is Analog Delay, Beat Delay and Groove Delay.

#### Analog Delay

A bucket-brigade/tape-style delay with a **vintage-styled panel face and no menus** — every
control is on the surface. **[R]**

Controls, grouped: **time** (**Sync** on/off, **Beats** subdivision, **Factor** — a tape-speed
multiplier from **0.5**, doubling the delay length, to **2**, halving it — and **Inertia**,
which sets how fast a time change is allowed to happen, i.e. the tape's pitch-glide when you
move the knob); **feedback and drive** (a **State-Space modelled Drive** stage); **Color**
(**Low Cut** and **High Cut** filters acting **on the repeats only, not on the dry signal**);
**modulation** (**Mod** depth and **Shape** LFO waveform, simulating an unstable tape);
and **stereo** (a ping-pong mode with three settings — **Off, Sum, 2-CH** — plus **Width**
taking the output from mono to full ping-pong). **[R]**

**Displayed.** No graphical display is described in any source I could reach; the face reads
as a panel of knobs and switches. **[U]** — §5.3's note that the reference draws a tap/echo
diagram is **not** confirmed for Analog Delay and should not be treated as parity.

#### Beat Delay

The tempo-locked delay. Controls: **Beats** (delay expressed as a beat subdivision),
**Offset** (a time offset of **−30% to +30% of the Beats value** — swing, in other words),
**Pingfactor** (a multiplier on the delay time following rhythmic subdivisions), **Cross
delay** (routes the input to one channel and the delayed signal to the other), **Feedback**,
**Width** and **Low Cut**. **[R]**

**Displayed.** **[U]**. One extraction described a "grid-based interface" but that phrasing
did not come from a source I can attribute, so treat Beat Delay's display as unknown.

#### Groove Delay

The four-tap delay, and the one with a real visualisation. Each of four taps has its own
**Beats** (one beat to two bars), **Groove** (delay time as a percentage of the beat
setting), **Feedback**, **Level**, **Pan**, and its own **resonant multi-mode filter**, so
every tap can have a different timbre. **[R]**

**Displayed.** A **Grid display**: rows are the four taps, columns are rhythmic subdivisions,
and a row of **Grid Display buttons switches which parameter the grid is showing and
editing — Level, Pan, Cutoff or Swing**. **[C]**

That is the pattern to copy for anything with N parallel elements and M parameters each:
**one grid, and a selector that changes which parameter the grid means.** It avoids both the
wall of knobs and the drill-down. Our delay devices have a single time and feedback and no
grid at all.

### 13.5 Reverb

#### Room Reverb

A geometric room simulator, and the best-documented reverb display in the set.

Controls: a **room model** selector — **Small Room, Room, Medium Hall, Large Hall**; **Size**
(average size of the virtual room), **Width** and **Height** (each relative to Size);
**Pre** (an offset applied to the room's own naturally-derived pre-delay, so the pre-delay
floor moves with the room rather than starting at zero); **Population** (0–1, the relative
number of people in the room — 0 gives enhanced bass and a static tail, 1 gives attenuated
bass and a moving tail); and **Reflexivity** (0–1, surface smoothness, higher values giving a
more echo-like tail). **[C]**

**Displayed — two separate readouts:**

1. A **W, D, H display** showing the **approximate room dimensions in real units** derived
   from the current Size/Width/Height settings. The abstract knobs are translated into
   metres. **[C]**
2. The **reverb display**, showing overall reverb characteristics **on a self-adjusting time
   scale**, with **early reflections drawn as individual vertical lines** and the **late tail
   drawn as a coloured envelope**. **[C]**

Both are worth taking. The self-adjusting time axis is why the display stays readable from a
0.4 s room to a 6 s hall, and drawing ERs as discrete lines against a continuous tail is what
makes the ER/LR balance visible at all. Our `ReverbFace` draws a single continuous envelope
with a shaded pre-delay gap and no early reflections.

#### Mixverb

The small, cheap reverb. Controls: **Pre-delay** (0–500 ms), **Size** (0–100%), **Damping**
(0–100%, attenuation of the upper frequencies of the reverberated signal), **Width**, **Mix**,
and a **gate on the tail** — **Gate Tail** on/off, **Gate Threshold** (−36 dB to +12 dB) and
**Gate Release** (10–250 ms). **[C]** for the ranges.

A gated-reverb control group built into the reverb, rather than requiring a gate after it, is
a small idea with an obvious payoff. Display **[U]**.

#### Open AIR

The convolution reverb. Controls: an **IR Name** field associating an impulse response with
the device; **Predelay**; **Length**, which shortens or lengthens the reverb time; a
**Shorten with Stretch** option which, when the requested length is shorter than the IR,
**timestretches the region between the ER/LR breakpoint and the end of the IR instead of
truncating it**, preserving the early reflections; and an **ER/LR** knob which **scales the
volumes before and after the ER/LR crossover point**. **[C]**

**Displayed.** The **impulse response itself**, with a **Log Time** toggle that **expands the
early part of the time axis so the early reflections are legible**, which is what makes the
ER/LR crossover point settable by eye. **[C]** for Log Time's purpose.

The lesson generalises past reverb: when a display's interesting detail is crammed into the
first 5% of the axis, give the axis a log mode rather than a zoom control.

#### Studio Verb (Pro 8)

Covered in §1: parameter sliders, a spectral display, and the **Ping** button that fires a
noise burst through the tail. **[R]** The only thing to add is why Ping matters as a face
element: it makes the display **useful with the transport stopped**, which no other reverb
display in the set is. An audition button belongs on any device whose picture is otherwise
blank until something plays.

#### IR Maker

A utility that **captures impulse responses** for use in Open AIR and in Ampire's cabinet
section. It is inserted on an audio track whose output feeds a physical output (into a room,
or into an amp's effects return) and whose input takes the microphone return; it plays a
sweep and computes the IR. An **Open** checkbox opens the resulting file in the system file
browser afterwards, and the IR can then be dragged onto a track to view and edit it, or
dragged straight into Open AIR or Ampire. **[C]**

Note what this implies about the reference's file model: **an IR is an ordinary file that
drags between the file browser, an audio track, and two different devices.** Nothing about it
is special-cased.

### 13.6 Modulation

#### Chorus

A voice chorus with LFO delay-time modulation and stereo width. Controls: **Delay** (the
delay of the chorus voices), a **Mode** switch between **Doubler** and **Chorus**, **LFO
Speed**, an **LFO Shape** switch across **Triangle, Sine, Sawtooth, Square**, and **LFO
Width** (the range of the modulation spacing). **[R]**

#### Flanger

Swept short delay with tempo sync. **Speed** sets the modulation rate; **Depth** is a
**dry-to-flanged blend**, not a modulation depth — the sources are explicit that fully left is
dry and fully right is flanged. **[R]** That is a meaningfully different meaning of "depth"
from ours and worth not copying blindly.

#### Phaser

A variable number of all-pass filters in series with **one overall feedback loop**. Its sweep
is bounded by **two range controls, not by a depth**: **Range Low** sets the lowest centre
frequency for the all-pass filters (10 Hz to 8 kHz, or up to the Range High value) and Range
High sets the top. **Speed/Beats** is one control whose meaning changes with the **Sync**
switch — in Hz when Sync is off, in beats when it is on. **[R]**

A swept effect specified by **where the sweep starts and stops** rather than by a centre and
a depth is more musical to set and is trivial for us to adopt.

#### Rotor

Rotary speaker emulation. Controls: **Slow/Fast** switches; **Woofer Speed** and **Horn
Speed** sliders **which set the actual rotation rates used in each of the slow and fast
modes** (so four values, not two); **On/Off** for the rotation itself; **Drive** (tube-amp
drive); **Horn Q** (blends in a midrange peak emulating the resonance of a rotating horn);
**Distance** (virtual microphone distance); **Spread** (stereo width of the rotating
elements); and a horn/woofer balance. Speed changes are **ramped with realistic braking and
acceleration**. **[R]**

**Displayed.** Not confirmed. **[U]** The state worth drawing is the ramp: a rotary that
snaps between two speeds when you press Fast is wrong, and the only way a user can tell the
ramp is happening is if something on the face moves.

#### Tremolo and Auto Pan

I could **not** confirm that FSP8 ships a device called Tremolo or one called Auto Pan.
**[U]** The level- and pan-modulation ground is covered by Autofilter's LFO, by Rotor and by
the panning devices in §13.7. Our `tremolo` and `autopan` may be devices the reference does
not have — see `docs/DEVICE-PARITY.md`.

### 13.7 Stereo, panning and routing utilities

#### Mixtool

The utility device. Functions: **Gain**; **independent left- and right-channel polarity
inversion** (two separate inverts, not one global Ø); **left/right channel swap**; **MS
Transform** on the input channels; and **Block DC Offset**, which re-centres the incoming
waveform. **[R]**

That is five distinct functions in one small device, and the separate per-channel inverts are
the reason it exists — a stereo track with one flipped side is a real problem and a single
polarity button cannot fix it. Display **[U]**, and probably none.

#### Dual Pan

A stereo panner with **independent left and right pan controls**, an **Input Balance** knob
(full left to full right, applied before the panners), and a **Pan Law** selector offering
**−6 dB Linear, −3 dB Constant Power Sin/Cos, −3 dB Constant Power Sqrt, 0 dB Balance
Sin/Cos, and 0 dB Linear**. **[R]**

The pan law being a **per-device choice from a named list** is the notable part: it makes the
law explicit and automatable instead of a global preference.

#### Binaural Pan

An HRTF-based panner for headphone placement. Its control set and its display are **[U]** —
I could not reach a description beyond the device's existence and purpose. Do not build to
this one from memory.

#### Pipeline

The hardware-insert device: it sends audio out of a physical output and brings it back on a
physical input so an outboard processor sits in the chain like a plug-in. It has a **ping
function that measures the round-trip I/O latency** and then compensates for it
automatically. **[R]**

Not implementable in a browser, but the **ping-and-measure** pattern is: any latency we
cannot know statically should be measured with a probe and shown, rather than guessed.

### 13.8 Metering and analysis

These four are the reference's dedicated meter devices, described in the manual's **Analysis
and Tools** chapter. They matter to us disproportionately because a meter device is nothing
_but_ its display.

#### Level Meter

**Sizeable as either a horizontal or a vertical display** — the device reflows, it does not
have one fixed orientation. **[C]** Parameters: **Mode** (**True Peak, K-20, K-14, K-12,
R128**), **Corr** (a toggle that adds a **phase-correlation** readout to the level meter),
and **RMS Len** and **Hold Len**, each chosen from a menu of length values. **[C]**

Two things we do not do: the meter's **integration time and hold time are user-set from
menus**, and correlation is available **on the level meter itself** rather than only in a
separate phase device.

#### Spectrum Meter

Display modes: **Oct-Band, 3rd-Oct-Band, 12th-Oct-Band, FFT, Waterfall (WF), Sonogram (Sono)
and Segments**. **[C]** Seven modes, of which three (Waterfall, Sonogram, Segments) are
time-history displays rather than instantaneous curves.

Note that Pro EQ3's embedded analyser offers a **subset** — Third Octave, 12th Octave, FFT
Curve, Waterfall — plus **None**. The dedicated device is the fuller instrument; the embedded
one is trimmed to what is useful behind a curve. That is a deliberate distinction and the
right one.

#### Phase Meter

Two components, and the manual describes them as such: a **goniometer occupying the centre of
the plug-in window**, and a **correlation meter across the very bottom**. **[C]** The
goniometer plots **left against right amplitude on an X/Y oscilloscope**, on which **a
vertical line means a mono signal**; the horizontal correlation meter shows the **average
amount of in-phase versus out-of-phase content**. **[C]**

#### Scope

An oscilloscope for debugging — the manual frames it as being for studio problems such as
**analysing crosstalk and noise levels**, not for musical use. It has **three signal channels
and one math channel**. **[C]**

A math channel (a derived trace, e.g. A−B) is what makes an oscilloscope useful for crosstalk
work, and it is the reason this device is not just a waveform view.

#### VU Meter

An **analogue-style VU** with **clip indicators**, alongside **peak level meters** and a
**correlation meter** on the same face. **[R]** In Pro 8 it is **pre-installed as part of the
native FX set** rather than being a separate download. **[R]** Its ballistics have been the
subject of user complaints that they do not match true analogue behaviour — if we build one,
the ballistics (300 ms integration, the standard overshoot) are the whole point. **[R]**

#### Tuner

Controls: a **Strobe Mode** toggle switching the display between **standard and strobe**, and
a **Calibration** knob setting the reference from **415 Hz to 465 Hz** by drag or by typing a
value into its number field. **[C]**

**Displayed**, and this is precise enough to build from: a **centre-note indicator with an
arrow to either side** — the **left arrow lights when the signal is flat**, the **right arrow
when it is sharp**; the **deviation is shown as a signed number**, positive for sharp and
negative for flat; and the **exact Frequency and Difference readouts sit in the lower left
corner** of the face. In strobe mode the **rotation speed of the strobe is the measure of how
far out of tune the note is**. **[C]**

Ours draws a time-domain oscilloscope trace and no note name at all.

### 13.9 Pitch

#### Melodyne (ARA)

Pitch and time editing arrives through **ARA (Audio Random Access)**, which lets the editor
exchange audio with the host directly rather than streaming through a plug-in. **[C]** The
display is the **blob** view: analysed notes drawn as blobs positioned by pitch and time,
with a **pitch ruler down the left-hand side**; **dragging a blob vertically changes its
pitch and dragging it horizontally changes its timing**. Melodic mode is the monophonic
algorithm used for vocals. **[R]**

#### Vocal Tune (Pro 8.1)

Pro 8.1's **native real-time pitch correction** device, added alongside the Melodyne
integration rather than replacing it. Controls: a **root note** and a **scale**, a
**correction percentage**, **vibrato** shaping, and a **formant shift** that changes timbre
without changing pitch. **[R]** Its display is **[U]** — I found no description of a pitch
trace, a scale grid or any graph, and should not assume one exists.

#### Voice FX (Pro 8)

A single device offering **six effect types: De-Tuner, Delay, Transformer, Filters, Ring
Modulator and Vocoder**, added for compatibility with the free Fender Studio app. **[R]** Its
face and any display are **[U]**.

### 13.10 What the device faces have in common

Pulling §13 together, the conventions that actually repeat across the set — these are the
rules to hold our own faces to:

1. **The display is an input surface.** Pro EQ3's band handles and the Compressor's curve
   handles are both dragged directly. A picture that can only be read is a wasted third of
   the face.
2. **The display has its own settings, and they are on the face.** Level Range, Spectrum
   Display Type, Show Curves, Log Time, Stacked Mode, Grid Display, standard-vs-strobe,
   horizontal-vs-vertical. In every case the user chooses what the picture shows, and in
   several cases can turn it off. None of our faces has a single display setting.
3. **Gain reduction is reported three ways, not one**: as a line on the transfer graph, as a
   dedicated meter with a **maximum-reduction hold**, and back into the console strip (§4.8).
4. **Input and output are metered separately and each sits beside the knob that sets it**
   (Tricomp is the clearest case).
5. **Audition affordances are first-class controls**: Listen and Solo on the De-Esser, Band
   Solo on Pro EQ3, Key Listen on Fat Channel XT's compressors, Ping on Studio Verb, the ping
   probe on Pipeline, the sweep on IR Maker. Roughly one device in three has a button whose
   only job is to let you hear or see what the device is keying on.
6. **A device that hosts sub-devices draws its chain** (Ampire's pedalboard with its movable
   pre/post-amp divider).
7. **N parallel elements get one grid and a parameter selector**, not N copies of the control
   set (Groove Delay).
8. **A crowded device gets a density mode of its own** (Fat Channel XT's Stacked Mode) rather
   than relying on the host's Micro View.
9. **Character lives in switches.** Bitcrusher's Dirt and Zero, RedLight's six models,
   Ampire's mic selection, Fat Channel's Tube/FET/Passive/Vintage. Adding a knob is the lazy
   answer.
10. **Ranges are stated, and units are real.** Room Reverb converts abstract size knobs into
    **metres**; Pro EQ3's spectrum carries a **piano keyboard**; the Tuner reads out **Hz and
    cents**. Every one of those turns a number the DSP wants into a number a musician has an
    opinion about.

---

## 14. Stock instruments, face by face

This deepens §6, which stated the family conventions. §6's list of the stock set stands;
what follows is per-instrument detail on the face and on what each one draws.

### 14.1 Impact XT — drum machine

**The pad grid is the face.** It is a **4×4 grid of 16 pads**, and there are **eight banks of
16 within a single patch** — 128 pad slots per instrument, switched by bank rather than by
loading a second instrument. **[R]**

A pad holds **one-shot hits, loops or pitched instrument sounds**, and **more than one sample
can be assigned to a pad with velocity switching between them**. **[R]**

Face regions:

- **The pads themselves**, with **Solo and Mute controls and an Output Channel assignment
  beneath each pad**. **[R]**
- **A waveform display at the top of the window** showing the currently selected sample, with
  **start and end point controls**, plus **normalise and reverse**. It is **zoomable**.
  **[R]**
- **A velocity range bar** used both to define the velocity layers and to **audition a layer
  by selecting it in the bar**. **[R]**
- The pad's own parameters below, swapped in when a different pad is selected (§6).

**Routing is part of the instrument's design, not an afterthought**: each pad can be assigned
to **its own stereo output**, which **appears as a separate channel in the console with full
insert capability**. **[R]** A drum machine whose pads cannot reach the mixer individually is
a toy, and this is the single biggest structural gap between the reference's drum machine and
ours.

Pro 7's in-place Impact editor inside the Note Editor (§6) means the pad grid appears in the
_editor_ as well as in the instrument window, so pads are reachable while drawing notes.
**[C]**

### 14.2 SampleOne XT — sampler

Organised around the sample and its map, as §6 says. The detail:

- **Up to 128 zones**, each holding its own sample. Zones can be **layered on the same key
  range** for stacking or **split across the keyboard** for a multisample. **[R]**
- **A waveform display** with **Reverse and Normalize buttons directly above it** and an
  **Edit Sample** button opening the per-sample parameters — **sample trim and loop
  playback** among them. **[R]**
- **Slicing**: a loop can be sliced and the slices **mapped to individual keys**. **[R]**
- **A filter section with nine filter models**, plus a **Drive** knob adding saturation in the
  filter and a **Punch** control adding percussive attack to the start of the note. **[R]**
- **An amp module** carrying gain, pan and an ADSR. **[R]**
- **An Envelopes tab at the top of the face** which switches the display to **a graphical view
  of all the envelopes at once**. **[R]**

The Envelopes tab is the structural idea worth taking: the envelopes are **not** each drawn
beside their own knob row; there is one place where **all** of them are drawn together and
compared. Ours draws a single amplitude envelope and has no filter or pitch envelope graph at
all.

### 14.3 Presence XT — sample player

A preset-first instrument, and the reference's answer to "I need a piano in four seconds".

- Plays a **generic multisample format packaged into Sound Sets**, and **also loads EXS,
  Giga, Kontakt (version 4 and below) and SoundFont presets** directly. **[R]**
- The playing face offers **filter, LFOs, envelopes, a modulation matrix and effects** —
  enough to shape a preset, not enough to build one. **[R]**
- **The Edit Page is locked by default.** Zone, layer and program editing, and the ability to
  script **eight assignable knobs and buttons**, are unlocked by the separately-sold
  **Presence XT Editor** add-on. **[R]**

That split — a **play face** everyone gets and an **edit face** behind a door — is a product
decision rather than a design one, but the shape of it is instructive: the sound-selection
surface and the sound-construction surface are genuinely different faces of one device, and
most users never see the second.

### 14.4 Mai Tai — polysynth

§6 covers the signal-ordered layout. Additional detail:

- The **central control panel** holds, in order, **Osc 1 and Osc 2 with their attached sine
  sub-oscillators**, the **noise** source, the **Character** processor, the **Filter**, and
  then the **LFOs and Envelope Generators**. The sub-oscillator plays the same relative pitch
  an octave down and is attached to its oscillator rather than being a separate source.
  **[R]**
- **The Mod/FX section runs along the bottom of the window** and contains **both** the
  modulation matrix and the built-in effects. **[C]** for the position.
- **The modulation matrix** works as: a **source drop-down** per row, a **target drop-down in
  a field at the bottom of the matrix**, and **the routing number itself doubles as the row's
  enable button**. **[R]**

A numbered row where the number is the enable toggle is a nice piece of economy and exactly
the sort of detail that reads as designed.

### 14.5 Mojito — mono synth

The small synth, and a good model for a compact face.

- **One oscillator with a continuous morph**: a single **Shape** control blends from **saw at
  full left to square at full right**, with a mix of the two in between — not a waveform
  selector. **Width** sets the pulse width when the oscillator is square-side, **Pitch** sets
  the pitch, and a **sub oscillator** can be dialled in. **[R]**
- **One filter**: a **resonant 24 dB low-pass**, with **Cutoff (20 Hz to 16 kHz)**, **Reso**,
  and **Drive (0–100%)**. It occupies the **upper right** of the face. **[R]**
- **One LFO**, with **Speed** (free or tempo-synced) sitting **under the oscillator section**,
  and **separate modulation-amount dials under Pitch, Wave and Width** — the routing is fixed
  and the depths are per-destination, which is a matrix without a matrix. **[R]**
- **Portamento** under the oscillator, and the **amp envelope beside it**. **[R]**

The continuous saw→square morph and the three fixed mod-depth dials are both worth copying:
they make a small synth feel deep without adding a page.

### 14.6 Multi Instrument

The layering and splitting container.

**Displayed — and this is the whole point of the device**: a **keyboard display in which each
loaded instrument is drawn as a coloured bar**. Each instrument's bar is a **range slider
whose ends are dragged to set its key range**. **Overlapping ranges layer**; non-overlapping
ranges split. **[C]**

Selecting an instrument in that display switches **the controls to the left** to that
instrument's **pan, level and transposition**, and **each instrument has its own inserts**.
**[C]**

**Velocity splits are not made here** — they are made with the **Input Filter Note FX**
placed before the instrument. **[R]** So the Multi Instrument's map is a **key** map only,
and velocity layering is a separate, composable mechanism. That is a defensible split and
worth knowing before we copy the shape, because our sampler's zone map is a **key _and_
velocity** map, which is the other choice.

### 14.7 Instrument face conventions

1. **The performance surface is the largest element and it is at the top** — pad grid,
   keyboard/zone map, waveform. Everything else is the tail.
2. **Selecting on the performance surface swaps the editor below it.** One pad editor, one
   zone editor, one instrument-parameter panel, re-pointed by selection rather than
   duplicated per element.
3. **A sample-based instrument's waveform display carries edit affordances directly** —
   start/end handles, loop handles, slice marks, and buttons (reverse, normalise) sitting
   immediately above it.
4. **Envelopes get one shared graphical view**, tabbed, rather than a small graph per
   envelope.
5. **Pads and layers reach the console individually.** Per-pad outputs in Impact XT, per-
   instrument inserts in the Multi Instrument.
6. **Fixed layout, signal-ordered left to right, with the modulation and effects section
   along the bottom.** Mai Tai is the canonical example; Mojito is the same idea at a
   quarter of the size.

---

## 15. Additional sources for §§13–14

All reached by search extraction; direct fetch remains blocked in this environment (§0).

Vendor manual pages (PreSonus/Fender Studio One reference manual):

- _Built-In Effects_ (chapter index):
  <https://s1manual.presonus.com/en/Content/Built-In_Effects_Topics/Chapter-Built_In_Effects.htm>
- _Dynamics_: <https://s1manual.presonus.com/Content/Built-In_Effects_Topics/Dynamics.htm>
- _Pro EQ3_: <https://s1manual.presonus.com/Content/Built-In_Effects_Topics/EQ.htm>
- _Delay_: <https://s1manual.presonus.com/Content/Built-In_Effects_Topics/Delay.htm>
- _Reverb_: <https://s1manual.presonus.com/Content/Built-In_Effects_Topics/Reverb.htm>
- _Mixing_ (Channel Strip, Fat Channel XT, Mixtool, Dual Pan, Binaural Pan, Tricomp):
  <https://s1manual.presonus.com/Content/Built-In_Effects_Topics/Mixing.htm>
- _Analysis and Tools_ (Level Meter, Spectrum Meter, Phase Meter, Scope, Tuner, IR Maker,
  Pipeline):
  <https://s1manual.presonus.com/en/Content/Built-In_Effects_Topics/Analysis_and_Tools.htm>
- _Mojito_: <https://s1manual.presonus.com/Content/Built-In_Instruments_Topics/Mojito.htm>
- _Presence XT_: <https://s1manual.presonus.com/Content/Built-In_Instruments_Topics/Presence_XT.htm>
- _Multi Instruments_:
  <https://s1manual.presonus.com/Content/Built-In_Instruments_Topics/Multi_Instruments.htm>
- _Pitch Correction with Melodyne Integration_:
  <https://s1manual.presonus.com/Content/Editing_Topics/Pitch_Correction_with.htm>

PreSonus first-party (knowledge base, blog, product pages):

- Knowledge Base — _Limiter_, _Expander_, _Gate Threshold_, _Gate Range_, _Gate Attack_,
  _Gate Release_, _Noise Gate_, _Digital Delay_, _K-System Metering Explained_,
  _MultiBand Dynamics Parts 1–2_, _Mixtool_, _Dual Pan_, _Binaural Pan_, _Mai Tai_
- Blog — _Limiter2 Deep Dive_, _Friday Tips: Limiter Demystified_,
  _Plug-In Matrimony: Pro EQ3 Weds Dynamics_, _The Surprising Channel Strip EQ_,
  _Solve Vocal Problems with the De-Esser_, _Fix Mixes with Multiband Dynamics_,
  _Grab Cab Impulses for Ampire from Any Amp Sim_
- Product pages — _Ampire_, _Rotor_, _Tricomp_, _Analog Delay_, _Red Light Distortion_,
  _Fat Channel XT_, _Fat Channel Collection Vol. 1_, _Channel Strip Collection_, _CTC-1_

Fender:

- _A Look at Mustang Guitar and Rumble Bass Native Plug-Ins in Fender Studio Pro 8_:
  <https://www.fender.com/articles/fender-studio/mustang-guitar-rumble-bass-plugins>
- _Fender Studio Pro 8 — Version History and Release Notes_ (PDF)

Press and training:

- Sound On Sound — _Studio One: Impact XT_, _Patterns & Impact XT In Studio One 4_,
  _Live Performance Loops With Impact XT_, _Using SampleOne XT In Studio One_,
  _Studio One: Presence XT_, _Studio One: Exploring Mai Tai_,
  _Studio One: Mai Tai's Modulation Matrix_, _Studio One: Mai Tai Timbral Variation_,
  _Studio One: Layering Synths Using Multi Instruments_, _Studio One: All Amped Up_,
  _Studio One: Exploring Analog Delay_, _Repeat After Me_ (delays),
  _Studio One: Console Shaper_, _Studio One: Melodyne Essential_,
  _M/S Processing In Studio One_, _Circular Panning In Studio One_,
  _Making Masters In Studio One_, _Inside Studio One Project Window_
- PCAudioLabs — per-device _How to use…_ articles for Pro EQ, ProEQ3, Compressor, Limiter,
  Gate, Expander, Multiband Dynamics, De-Esser, Tricomp, Mixverb, Room Reverb, Open AIR,
  Analog Delay, Beat Delay, Groove Delay, Chorus, Phaser, Rotor, Bitcrusher, RedLightDist,
  Auto Filter, Binaural Pan, Dual Pan, Channel Strip, Level Meter, Spectrum Meter, Phase
  Meter, and the Fat Channel and Ampire section series (_Cabinet Section in Ampire_,
  _Tuner Section in Ampire_)
- OBEDIA — _How To Use PreSonus Tricomp_, _How To Use Groove Delay_, _How To Use The
  PreSonus Rotor Plugin_
- MusicTech — _Making an impact with Impact XT_, _Capturing life with Sample One XT_,
  _How to get the best from Presence XT_, _How to build synth textures with Mai Tai and
  Mojito_, _Fender Studio Pro 8.1 review_
- Production Expert — _Fender Studio Pro 8: First Look_
- Audeobox — _Sample One XT Guide_, _Impact XT Drum Machine: Complete Guide_
- Loopmasters — _Working with Samples in Studio One's SampleOne XT_
- macProVideo / Ask.Audio — _Subtractive Synthesis with Studio One's Mojito_,
  _Using Studio One's Console Shaper Mix Effect_, _4 Delay Tips in PreSonus Studio One_
- KVR Audio — _Fender Updates Studio Pro to 8.1_ (Vocal Tune, Studio Assistant, Moises)
- Bedroom Producers Blog — _PreSonus VU Meter Is Now FREE_
- Sweetwater InSync — _Studio One's Secret Equalizer — Autofilter_, _Setting Up Keyboard
  Layers and Splits in Studio One_
- Celemony — _Working with ARA_ (Melodyne 5 help centre)

---

## 16. Additional unconfirmed items (extends §12)

Everything here is something §§13–14 needed and could not establish. Do not build to any of
it without checking.

- **Whether the Gate, the Expander, the De-Esser, the Limiter2 or Ampire draw a graph at
  all.** Only the Compressor's transfer graph, Pro EQ3's curve, Room Reverb's two displays,
  Open AIR's IR view, Groove Delay's grid, Multiband Dynamics' input/output bands and the
  four meter devices are confirmed as having displays. For the rest the sources describe
  knobs and switches and say nothing about a picture.
- **Whether FSP8 ships devices named Tremolo or Auto Pan.** I found none. Our `tremolo` and
  `autopan` may have no counterpart.
- **The De-Esser's Shape and Range controls.** Named in one source, unexplained everywhere.
- **The Channel Strip device's band count and layout**, as distinct from Fat Channel XT.
- **Binaural Pan's controls and display** beyond the fact that it is an HRTF panner.
- **Analog Delay's and Beat Delay's displays.** One extraction described a Beat Delay "grid"
  but could not be attributed; treat as unknown. Note that §5.3's statement that the
  reference draws a tap/echo diagram is confirmed **only** for Groove Delay.
- **Vocal Tune's display.** No source describes a pitch trace, a scale grid or any graph.
- **Voice FX's face.** Only the six effect-type names are confirmed.
- **Whether Fat Channel XT meters gain reduction per module**, and in what form.
- **Mustang Native / Rumble Native model counts.** Now conflicting from two Fender-sourced
  places (39 + 39 versus 57 total) as well as from press. Still unquotable.
- **Exact on-face positions** for most devices. Confirmed positions are: Pro EQ3's piano
  keyboard below the spectrum; the Compressor's Sidechain button at the top of the window;
  Ampire's pedalboard along the bottom; Mai Tai's Mod/FX along the bottom; Impact XT's
  waveform at the top; the Phase Meter's goniometer centred with the correlation meter along
  the bottom; SampleOne XT's Envelopes tab at the top; Mojito's filter upper-right. Every
  other position claim in §13 is inference.
- **Whether Studio One's Gate exposes Threshold Open / Threshold Close under exactly those
  labels**, or whether those are the StudioLive/Fat Channel gate's labels reused by the
  secondary sources.
