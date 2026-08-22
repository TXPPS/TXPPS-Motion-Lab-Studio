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
