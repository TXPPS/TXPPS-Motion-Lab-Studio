# Parity survey — Mixing and Automation

**Directive 09 §1 · Research Analyst · MotionLab Studio**

**Reference source:** Fender Studio Pro 8 user manual, chapters *Mixing* (pp. 299–356)
and *Automation* (pp. 403–412), read cover to cover from the extracted text at
`scratchpad/fsp8.txt` lines 11793–14093 and 15544–15957.

**MotionLab source:** read directly, at the paths cited per row.

**Status vocabulary:** `PARITY` · `PARTIAL` · `MISSING` · `DIVERGENT-BY-DESIGN`.

**IP boundary.** This is a reference document. Quotations are short and attributed to the
FSP8 manual. No trademarked reference name is proposed for any MotionLab UI string, symbol,
filename or preset. Where a reference feature needs a MotionLab name, a neutral descriptive
name is suggested instead.

**A note on `docs/REFERENCE-FSP8.md`.** That prior survey was assembled from search-engine
extracts and marks its own confidence with [C]/[R]/[U]. Section 14 of this document lists
every place the manual now **confirms**, **corrects** or **contradicts** it.

---

## 1. The Console — channel strip anatomy

### 1.1 Strip element order, top to bottom

1. **FSP8 does.** The manual states the order positionally rather than as a list, so the
   order below is assembled from its own sentences (*The Console › Channel Features*, and
   *Console Options › Channel Components*):

   | # | Element | Manual's own words on its position |
   | - | ------- | ---------------------------------- |
   | 1 | **Input / Output display** | "At the top of each Channel is a display of its configured Input and Output, with the Input shown at the top and the Output below it." |
   | 2 | **Input controls** — Input Gain, Polarity Invert (Ø) | "display the Input Gain and Polarity Invert controls **at the top of each Channel**"; present on every channel type "except Output Channels and VCA Channels" |
   | 3 | **Insert Device Rack** | "Each Channel in the Console can have its own set of Device Racks… the Insert Device Racks are hidden in Small Console mode" |
   | 4 | **Send Device Rack** | Sends/Cue mix: "show the Sends **above the fader** on each Channel" |
   | 5 | **I/O connections** (optional duplicate row) | "display Input / Output routings **above the fader**" |
   | 6 | **Panner** (horizontal) | "All Channels feature a horizontal panner and vertical volume fader **below the I/O-selection display**" |
   | 7 | **Volume fader** (vertical) + **level meter** | as above; "Each Channel has a level meter" |
   | 8 | **Mute / Solo** (+ Record Enable / Monitor Enable on Audio Channels) | Audio Channels have "corresponding Record Enable, Monitor Enable, Solo, and Mute controls" |
   | 9 | **VCA connections** | "display VCA Channel connections **beneath the meter**" |
   | 10 | **Group assignment** | "display Group assignments **above the labels**" |
   | 11 | **Automation Mode** | "displayed **at the bottom of the Channel**. By default, this mode is set to Off." |
   | 12 | **Name** | "Channel names are shown **at the bottom** of each Channel" |
   | 13 | **Channel Notes** | "**beneath the faders** on each Channel" |
   | 14 | **Channel Icons** | "**beneath the faders** on each Channel" |

   Rows 2, 4, 5, 9, 10, 13, 14 are individually hideable from **Console Options (wrench) →
   Channel Components**. The Group icon "appears inside the Channel above the level meter"
   and "is not visible when the Console view is in Narrow mode".

   Two corroborating orders the manual gives explicitly, for the *horizontal* layouts:

   - **Channel Overview** (left to right): channel name · audio device controls · input
     gain & polarity · input/output routing · pan mode · pan · track notes · track icon ·
     mute/solo · record arm/monitor · fader and meter · expand · group assignment ·
     automation.
   - **Channel Editor, Channel column** (top to bottom): channel number and name ·
     hardware input controls · input gain & polarity · mute/solo · record arm/monitor ·
     input/output routing · pan mode · pan · track notes · track icon · fader and meter ·
     group assignment · automation.

   Note both horizontal orders put **Mute/Solo before the fader**, and both put **routing
   near the top**, consistent with the vertical strip's I/O-at-top rule.

2. **MotionLab does.** `src/components/mixer/ChannelStrip.tsx` documents and implements a
   fixed nine-row CSS grid (`src/styles/mixer.css` `.strip`, `grid-template-rows`):

   ```
   name · input (trim / polarity / mono) · device rack · sends · pan
   fader + stereo meter with printed dB scale · mute/solo/arm · dB + peak readout
   output routing + VCA assignment
   ```

   Differences in ordering against the reference: MotionLab has **no input-source row at
   the top** (the input selector lives in the Inspector, not the strip); **output routing
   is at the bottom**, not the top; there is **no group-assignment row**, **no automation-
   mode row** (an "A" badge in the name row stands in), **no notes row**, **no icon row**;
   and the **name is at the top**, not the bottom.

3. **Gap — `PARTIAL`.** The element *set* is roughly two-thirds present; the *order* is
   materially different at both ends of the strip. Two specific divergences are worth
   deciding deliberately rather than drifting into:
   - **Routing position.** The reference puts input **and** output at the top; MotionLab
     puts output at the bottom. This is the single largest ordering divergence and the one
     that breaks horizontal scanning across a console.
   - **Name position.** Reference: bottom. MotionLab: top. MotionLab's choice is defensible
     (the coloured name row doubles as the strip's identity band) — mark it
     `DIVERGENT-BY-DESIGN` if kept, but record it.

   Also `MISSING`: the whole **Channel Components** idea — every strip row in FSP8 is
   user-hideable, and MotionLab's grid has nine hard-coded rows with no visibility model.
   `src/styles/mixer.css`'s comment already concedes the grid "encodes the opposite
   assumption".

### 1.2 Console density modes

1. **FSP8 does.** Two viewing modes, **Small** and **Large** (Large is the default; toggle
   with the Small/Large button or `[Shift]+[F3]`). Small mode hides the Insert and Send
   Device Racks. In Large mode the divider between the Insert and Send racks can be dragged
   vertically to trade height. Either mode can additionally be made **Narrow** — in Small +
   Narrow "a volume-fade handle is overlapped on the level meter, with Mute and Solo
   controls above the meter"; in Large + Narrow the device racks are replaced by channel
   level meters. A channel can be **Expanded** individually (button, or double-click open
   space) to reveal its racks without changing the whole console. The Console can be
   **detached** into its own window and reattached.

2. **MotionLab does.** One density. `Mixer.tsx` renders a single flat horizontal scroller of
   fixed-width strips (`--strip-w`), with a `touch` boolean that only affects the master
   strip's sizing. No Small/Large, no Narrow, no per-channel Expand, no detach.

3. **Gap — `MISSING`.**

### 1.3 Console navigation column, Channel List, options

1. **FSP8 does.** A **Console Navigation column** down the far left carrying: Audio I/O
   Setup (with a drop-down to quickly add a Bus, FX, VCA or Aux Channel), Console Options
   (wrench), Inputs panel, Outputs panel, External Devices panel, Instrument Rack, Show
   Scenes, Show Groups, Channel List, Detach.

   **Channel List:** round show/hide button per channel, click-and-drag through them to
   sweep, hidden channels stay faintly visible in the list, a **Filter field** taking
   comma-separated terms ("bas, guit"), an X to clear, per-channel-type icons along the
   bottom to hide/show whole classes, a Group column showing each channel's group, and a
   **Remote Bank** (a special Scene governing which channels a control surface sees).

   **Console Options (wrench)** groups: *Grouping* (keep FX / bus / VCA channels to the
   right; preserve order of channels with folder track), *Visibility* (link Track List and
   Console; link expansion and visibility of Folder Tracks; Auto-expand Selected Channel;
   Colorize Channel Strips; Colorize Plug-in Header), *Channel Components* (audio device
   controls, input controls, sends/cue mix, I/O connections, VCA connections, group
   assignment, channel notes, channel icons), *Bus Settings* (Enable Listen Bus; Solo
   through Listen Bus; Automatically Create Instrument Busses), and Restore Audio Device
   Settings.

   Find a channel by name or number with `[Ctrl]+[Alt]/[Option]+[C]`, "whether the Console
   is visible or not".

2. **MotionLab does.** `Mixer.tsx` has one piece of chrome: a `+` button whose menu offers
   *Add bus*, *Add FX channel*, *Add VCA fader*. Ordering is hard-coded (channels, then
   buses, then FX, then VCAs, then master) — which happens to match the reference's
   *keep-to-the-right* options, but as a fixed rule rather than a setting. No channel list,
   no filter, no per-type visibility, no options menu, no find-by-name.

3. **Gap — `MISSING`** for the navigation column, Channel List, filter and options menu.
   `PARITY` (accidental) on channel ordering-by-type.

### 1.4 Channel types

1. **FSP8 does.** **Input** (hardware inputs, mono or stereo, for metering or processing an
   input), **Audio** (one per Audio Track), **Instrument** (the *audio output of a virtual
   instrument* — Instrument Tracks have no direct console representation, and a multi-out
   instrument gets one channel per output), **Aux** (an external audio source controlled by
   the console with no associated track), **Bus** (summing; mono or stereo via a Channel
   Mode button), **FX** (an effects return fed by Sends), **Output** (Main Out, always
   locked to the far right and unmovable; plus **Sub Outs** shown to the right when the
   Outputs panel is open), **VCA**, and the **Listen Bus**.

   Bus and FX channels "display a graphical count of the number of Tracks assigned or sent
   to them"; clicking the input area pops a list of assigned/sent tracks, with a **Select
   All**, and clicking a track in the list "selects and expands that Track in the Mix view".

   Output channels carry **Metronome controls** (independent click on/off and level per
   hardware output) and a **Mono switch** for summed-mono monitoring.

2. **MotionLab does.** `TrackType` in `src/model/types.ts` and `Mixer.tsx`: `audio`,
   `instrument`, `drum`, `bus`, `fx`, `folder`, `vca`, plus a singleton `master`. Bus and FX
   strips show a `BUS`/`FX` tag with the feeder count and a tooltip listing feeder names
   (`ChannelStrip.tsx`) — this is the reference's "graphical count of tracks assigned or
   sent" idea, done as a tag rather than a graphic.

   `MISSING` types: **Input channels** (no hardware-input strips; monitoring is routed into
   the track's own channel by `engine.startMonitoring`), **Aux channels**, **Sub Outs** (one
   stereo master only), **Listen Bus**. MotionLab adds **`folder`** and **`drum`**, which
   the reference does not have as console channel types.

   MotionLab's `drum` type is a MotionLab concept; FSP8's equivalent would be an Instrument
   Channel. Its `folder` type carries a fader and mute that act multiplicatively on children
   (`mixerGraph.resolveChannels`), where FSP8's Folder Tracks instead get assigned to a Bus
   or a VCA.

3. **Gap — `PARTIAL`.** Core types present; Input / Aux / Sub Out / Listen Bus missing;
   folder-as-gain-stage is `DIVERGENT-BY-DESIGN` (it is a simpler model than the reference's
   folder→bus/VCA assignment, and it is coherent — but it means MotionLab has a fourth
   gain-summing concept the reference does not).

### 1.5 Mono/stereo channel mode

1. **FSP8 does.** "Bus Channels can be mono or stereo. Click the Channel Mode button in the
   Bus Channel to select the desired option." Output channels are stereo or mono depending
   on the configured hardware output, and every stereo Output Channel has a **Mono switch**.
   The Listen Bus has a Channel Mode button too.

2. **MotionLab does.** Per-channel `monoSum` (an `M` button in the strip's input row) sets
   `trim.channelCount = 1` / `channelCountMode = 'explicit'` at the *input* of the channel
   (`engine.ts` in `syncGraph`). The master has `monoCheck` doing the same on `masterMono`,
   explicitly documented as monitoring-only and never printed to a bounce. No mono/stereo
   mode on buses as a *format* decision.

3. **Gap — `PARTIAL`.** Mono summing exists and is arguably better placed (per channel, not
   just per bus); a bus **format** (mono vs stereo bus) does not exist. The master mono
   check is `PARITY`.

### 1.6 Copy/paste channel settings

1. **FSP8 does.** `[Ctrl]/[Cmd]+[C]` on a selected channel and `[Ctrl]/[Cmd]+[V]` on one or
   many others copies "the level, panning, and insert/send effects" — across channels in
   the session, into other sessions, and across pages. "Any Channel type can be a source or
   destination: Audio, Instrument, Aux, Bus, VCA, or Master, with the exception of the
   Listen Bus." Also in the channel context menu.

2. **MotionLab does.** `projectStore.copyEffectTo(fromTrackId, effectId, toTrackId)` copies
   **one device**. `DeviceRack.tsx` exposes it as *Copy to…*. Nothing copies a channel's
   level, pan, whole insert chain or send set.

3. **Gap — `MISSING`** for whole-channel settings; `PARTIAL` for chain copying (one device
   at a time, no rack-header drag).

---

## 2. Pan — modes and pan law

### 2.1 Pan law

1. **FSP8 does.** Quoting the manual directly (*The Console › Volume and Pan settings*):

   > "Fender Studio Pro uses a **-3 dB pan law** for all channel panning. On stereo
   > channels, the panner adjusts the balance of left and right signal levels."

   That is the manual's only stated dB figure for panning. There is **no user-selectable pan
   law** anywhere in the Mixing chapter — one law, fixed, for all channel panning. A −3 dB
   law is the constant-power law: a centred mono source sits 3.01 dB down in each leg and
   sums to unity power.

2. **MotionLab does.** Every channel panner and the master panner are Web Audio
   `StereoPannerNode`s — `engine.ts:942` (`buildChannel`: `const panner =
   ctx.createStereoPanner()`) and `engine.ts:361` (`masterPan`). The offline bounce builds
   the same nodes (`src/audio/exportMix.ts:521`, `:560`), which is what keeps bounce parity
   (`CLAUDE.md`'s do-not-refactor rule).

   The Web Audio specification fixes `StereoPannerNode`'s law: for a **mono** input,
   `x = (pan + 1)/2`, `gainL = cos(x·π/2)`, `gainR = sin(x·π/2)` — at centre both legs are
   `cos(π/4) = 0.7071`, i.e. **−3.01 dB**, constant power. For a **stereo** input the spec
   applies its balance algorithm, attenuating the far leg with the same cos/sin pair.

   So MotionLab's law and the reference's law are the same law, and both treat a stereo
   channel as a balance rather than a re-pan.

3. **Gap — `PARITY`.** This is the strongest single match in the chapter, and it is
   inherited rather than chosen — worth recording so that nobody "fixes" it. One nuance to
   note but not necessarily act on: the Web Audio stereo algorithm **folds** the far channel
   into the near one at extremes (hard-left sends R into L), whereas a pure balance control
   would simply attenuate R to silence. The manual does not say which FSP8 does. Flag as
   unverified; do not change the node.

### 2.2 Pan modes

1. **FSP8 does.** Right-click the panner for three modes:
   - **Balance** — "The default mode which allows you to position the Channel's signal left
     to right in the stereo image."
   - **Dual** — "A stereo panner that allows for independent left/right panning."
   - **Binaural** — "A stereo panner that employs mid/side processing to manipulate the
     perceived width of stereo signals, from mono to double the normal width."

   "Note that Dual and Binaural pans don't apply to Mono channels." A preference,
   *Use Binaural/Dual for New Channels*, sets the default for new channels.

   **Dual gestures:** drag the middle for joint balance (or mousewheel); drag an endpoint to
   balance one side; drag up/down to widen or narrow (or Ctrl+mousewheel). Width can be
   dragged **negative** past zero — "indicated by a red color change in the interface".

   **Binaural gestures:** drag left/right for balance; drag the width control left/right for
   width; double-click the width control to type a value; mouseover + mousewheel.

   **Both:** double-click the pan interface for a larger fine-control pop-up, and those
   pop-ups "display for the currently-selected channel when you press the left/right arrow
   keys to navigate across the console". Numerical values may be entered for pan and volume.
   Dual Pan and Binaural Pan also exist as separate plug-ins for more advanced control.

2. **MotionLab does.** One mode. `PanKnob` (`src/components/common/widgets.tsx`) driving
   `track.pan` (−1…1), a `panText()` readout, and the same knob in `ChannelOverview.tsx`.
   No mode selector, no dual panner, no width/mid-side control, no negative width, no
   fine-control pop-up, no arrow-key console navigation, no numeric entry.

3. **Gap — `PARTIAL`.** Balance mode is at parity (§2.1). Dual and Binaural are `MISSING`.
   The **fine-control pop-up + arrow-key traversal** is a distinct, cheap, high-value
   omission — it is the reference's answer to "the strip is 90 px wide" and MotionLab has
   the same problem.

   Also `MISSING`: **numeric entry for pan and volume**. MotionLab shows `formatDb(level)`
   and `panText(pan)` as read-only text (`ChannelStrip.tsx` `.strip-readout`, `.pan-val`).
   The reference lets you type both. This is a small change with a large usability return
   and it is already the class of bug CLAUDE.md calls out ("a control that does nothing").

---

## 3. Mute, solo, and implicit mute

### 3.1 Solo mode

1. **FSP8 does.** "Solo mode is also known as **Solo-in-Place, or SIP**." Muting silences the
   channel; soloing "silences all except the audio for the soloed Channel". Any number of
   channels can be muted or soloed at once. `[M]` and `[S]` mute/solo selected channels.

   Two behavioural specifics worth copying:
   - "When using the [M] or [S] keys to mute or solo an **Instrument Track** that has a
     virtual instrument attached to it, mute or solo is applied to the **note data Track**
     in the Arrangement view, rather than to the audio Track in the Mix view."
   - "[M] and [S] have **no effect on Bus or FX Channels**."

   **Global Solo Off:** hold `[Ctrl]` and click any Solo button — disengages solo everywhere.
   "Performing the [Ctrl]-click again **recalls the previous solo settings**", restoring the
   set that was soloed. The manual gives the use case: comparing a group of soloed tracks
   against the rest of the mix.

2. **MotionLab does.** SIP, resolved as pure data in `src/model/mixerGraph.ts`
   `resolveChannels()`. Its solo model is materially *richer* than the reference's:
   - solo expands through **folders** and **VCAs** to their members;
   - solo is **transitive downstream** (a soloed track keeps whatever it feeds audible) and
     **upstream** (a soloed bus keeps its feeders audible);
   - `soloSafe` survives any solo.

   Toggled from the strip's `S` button (`ChannelStrip.tsx`) and the track header. `[S]`/`[M]`
   keyboard bindings exist via `src/app/shortcuts.ts`.

   `MISSING`: Global Solo Off with recall of the previous solo set. Grepping for
   `clearSolo`/`soloOff`/`clearAllSolo` across `src/` returns nothing.

   `DIVERGENT`: MotionLab's `S` **does** work on bus and FX strips (and its transitive rules
   make that meaningful); the reference explicitly excludes them from `[M]`/`[S]`.

3. **Gap — `PARTIAL`, and better in the important direction.** The transitive solo is a
   genuine improvement over a plain SIP and should not be "corrected" toward the reference.
   The two real gaps are **Global Solo Off with recall** (`MISSING`) and the
   **instrument-track note-data-vs-audio distinction** (`MISSING` / not applicable —
   MotionLab has no separate note track).

### 3.2 Solo Safe

1. **FSP8 does.** "It is possible to place Console Channels in Solo Safe mode. When any
   Channel in the Console is soloed, all Channels with Solo Safe engaged are also soloed, and
   all other Channels are muted. To engage Solo Safe on any Channel, **[Shift]-click on its
   Solo button**… The Solo button is **green** when Solo Safe is engaged."

   "**FX Channels have Solo Safe engaged by default** because effects may be critical to how
   soloed Channels sound in the mix." (Stated twice — once in *The Console*, again in
   *Effects Signal Routing › The FX and Solo Safe*.)

2. **MotionLab does.** `Track.soloSafe` is honoured by `resolveChannels` (`soloOk = !soloActive
   || audibleBySolo.has(t.id) || t.soloSafe === true`). Engaged by **right-click** on the Solo
   button (`ChannelStrip.tsx` `onContextMenu`), indicated by the button reading `S!` instead
   of `S`.

   `MISSING`: FX channels are **not** solo-safe by default — `projectStore.addTrack` sets no
   `soloSafe` for any type. Because MotionLab's solo is transitive downstream, a soloed track
   *does* keep its send destinations audible, which covers the common case by accident; but
   an FX return fed only by a *different*, non-soloed track goes silent, which is exactly
   what the reference's default prevents.

3. **Gap — `PARTIAL`.**
   - Mechanism: `PARITY`.
   - Gesture: `DIVERGENT` (Shift-click vs right-click). Right-click is defensible on a
     touch-hostile control, but Shift-click costs nothing to add as a second route.
   - Indication: `PARTIAL` — the reference uses **colour** (green solo button), MotionLab
     uses a **glyph change** (`S` → `S!`). A glyph change on a 20 px button at console
     density is weak; the reference's colour signal is the stronger one.
   - **FX solo-safe by default: `MISSING`.** This is a one-line default and a real
     behavioural gap.

### 3.3 Implicit mute — how a silenced channel is shown

1. **FSP8 does.** The Mixing chapter describes the *behaviour* ("Soloing silences all except
   the audio for the soloed Channel") but **never states how an implicitly-muted channel is
   indicated**. There is no sentence in either chapter about a dimmed strip, a flashing mute
   button, or a distinct implicit-mute colour. This is a genuine silence in the source, not
   an omission in this survey — treat any claim about FSP8's implicit-mute indication as
   unverified.

2. **MotionLab does.** `resolveChannels` returns two distinct flags per channel:
   - `mutedByGroup` — "something other than this track's own controls is silencing it"
     (a folder mute or a VCA mute);
   - `mutedBySolo` — "this track is silent only because something else is soloed".

   `ChannelStrip.tsx` turns those into a `silentBecause` string —
   `'silenced by its group'` / `'silenced by another track's solo'` — used as the title on
   both the name row and the Mute button, plus a `.silent` class on the strip that drops the
   name and fader rows to `opacity: 0.55` (`src/styles/mixer.css:216`).

3. **Gap — `DIVERGENT-BY-DESIGN`, in MotionLab's favour.** MotionLab distinguishes *two
   kinds* of implicit mute and says which in words; the reference documents neither. Keep
   it. Two improvements worth noting anyway:
   - the indication is **opacity plus a tooltip** — a tooltip is invisible on touch and to a
     screen reader on the fader; the Mute button's `aria-pressed` still reads `false` when
     the channel is implicitly silent, which is correct but leaves the *reason* unspoken.
   - `mutedByGroup` covers folder and VCA mutes only. A channel silenced because its
     **output bus** is muted is not flagged (the graph walk in `resolveChannels` does not
     propagate a bus's mute down to its feeders' `ChannelState`). Worth a test.

---

## 4. Metering

### 4.1 Meter types and where the modes live

1. **FSP8 does.** Two separate Metering Mode menus, both reached by right-click on a meter:
   **one for the Output Channels** and **one for every other console channel**. "Note that
   the Pre-Fader Metering setting is applied globally to all meters, including the Output
   Channels. Changing that setting in one menu will change it automatically in the other."

   - **Normal channels:** choose **Peak** *or* **Peak/RMS** (mutually exclusive). The choice
     "will be applied to all Channels in the Console except the Output Channels" — i.e. it is
     a **global** choice for that class, not per-channel.
   - **Output channels:** "**Peak meters are not available for the Output Channels**, which
     feature Peak/RMS metering with K-System Metering options."
   - **Peak meters** "measure the instantaneous audio level from moment to moment at a very
     fast resolution and display the highest output level at any instant."
   - **Peak/RMS meters** "simultaneously show both peak and RMS levels… an RMS meter shows
     an average of the peaks and troughs of an audio signal over time… intended to indicate
     the perceived loudness."
   - Meters "automatically display in mono or stereo depending on the audio source."

2. **MotionLab does.** One meter type, everywhere. `StereoMeter`
   (`src/components/common/widgets.tsx:522`) draws two bars whose **fill is RMS**
   (`meterScalePosition(linToDb(m.rmsL))`) with a separate **hold marker** driven by
   `holdL`/`holdR` (peak-derived). So MotionLab is permanently in a Peak/RMS-like hybrid:
   RMS body, peak-hold marker, no fast peak bar.

   `MeterData` (`engine.ts:102`) carries `peak`, `rms`, `hold`, `clipped`, and per-channel
   `peakL/R`, `rmsL/R`, `holdL/R` — so the *data* for a true peak-over-RMS display already
   exists; only the widget does not draw it.

   The single-bar `SignalMeter` variant does offer a peak-or-RMS choice (`byPeak ? m.peak :
   m.rms * 1.4`, `widgets.tsx:634`) but that is not the console meter, and the `× 1.4` lift
   on RMS is a display fudge with no stated derivation.

   No context menu on any meter. No mode selection of any kind.

3. **Gap — `PARTIAL`.** RMS and peak-hold are both present and metering is stereo; the
   **mode menu is `MISSING`**, **plain Peak mode is `MISSING`**, and the reference's
   two-menu / global-scope structure has no counterpart. The reference's mutual exclusivity
   and global scope is an important design detail: it is a *console preference*, not a
   per-strip toggle.

### 4.2 Scale, ballistics, peak hold

1. **FSP8 does.** "[Right]/[Ctrl]-click on any meter to adjust the **Peak Hold** and **Hold
   Length** settings **globally for all Channels**." The Listen Bus additionally lets you
   "specify the Peak Hold behavior of the meters". The manual gives no dB scale endpoints, no
   fall rate and no integration time for either meter type — those numbers are not in this
   chapter. Any claim about FSP8's ballistics constants is unverified.

2. **MotionLab does.**
   - **Scale:** floor at **−60 dBFS** (`DB_FLOOR = 60`, `widgets.tsx:448`), top at 0 dBFS,
     with a deliberately non-linear mapping `((db + 60)/60)^1.9` that stretches the top of
     the scale. Printed ticks at **0, −3, −6, −12, −18, −24, −36, −48 dB**
     (`METER_TICKS`), thinned by available height via `meterTickTier`.
   - **Ballistics:** fall is a **rate in dB per second**, from the preference
     `meterFallDbPerSec` (default **26 dB/s**, `src/state/prefsStore.ts:45`), applied as
     `fall = 10^(−rate·dt/20)` each frame (`engine.ts:2062`). The comment there records that
     an earlier fixed-amplitude subtraction was wrong precisely because it made the
     preference meaningless — that is the right reasoning and the right fix.
   - **Peak hold:** `holdL = l.peak >= prev.holdL ? l.peak : prev.holdL * fall` — the hold
     marker **decays at the same rate as the meter**; there is no separate hold-length
     setting and no infinite hold.
   - **Rise:** instantaneous (no attack ballistic on either RMS or peak); RMS also decays at
     `fall`, so the "RMS" is really a peak-decay envelope of a per-frame RMS, not a
     time-windowed RMS.

3. **Gap — `PARTIAL`.**
   - Fall as a dB/s rate and a user preference: **ahead of what the manual documents**.
   - **`MISSING`: a separate Hold Length**, and a peak-hold that holds rather than decaying
     with the bar. The reference makes Hold Length a first-class global setting; MotionLab
     conflates hold decay with meter fall.
   - **Scale is a MotionLab decision** (−60 dB floor, `^1.9` warp). The manual states no
     scale, so this is `DIVERGENT-BY-DESIGN` and cannot be called a gap either way. It should
     be recorded as *ours*, with its own justification, rather than implied to be parity.

### 4.3 Pre-fader metering

1. **FSP8 does.** "Pre-Fader Metering is not enabled by default. When it is enabled, the level
   meters show levels independent of fader position. When it is disabled, the level meters
   respond to fader position. This is known as **Post-Fader Metering**. The selection you make
   will be applied **globally to all Channels, including the Main Out and Sub Outs**." Either
   metering mode (Peak or Peak/RMS) can use it.

2. **MotionLab does.** Post-fader only, structurally. `buildChannel` wires
   `input → trim → inserts → pdc → mute → volume → pan → analyser`, and the meter tap hangs
   off `ch.analyser` (`ensureTap`, `engine.ts:2007`) — i.e. after the fader **and** after the
   pan. There is no pre-fader tap and no toggle.

3. **Gap — `MISSING`.** Note the implementation cost is low: a second splitter off
   `inserts.exit` (which the pre-fader send path already taps) gives a pre-fader tap with no
   graph restructuring.

### 4.4 Clip indication

1. **FSP8 does.** "The Main Out Channel features a **Clip Counter** above its Peak/RMS meter.
   The counter turns **red** when the Main Out signal clips and **counts the total number of
   clips** that occur… The counter **resets when clicked or when the Main Out fader is
   adjusted**." The chapter describes no clip indicator on ordinary channels.

2. **MotionLab does.** Every strip's meter carries an **over indicator** — a button with
   `data-over="yes"/"no"`, latched when any frame's peak reaches `>= 0.999`
   (`engine.ts:2076`), cleared globally by `engine.resetClipIndicators()` which the button's
   `onClick` calls (`widgets.tsx:571-578`). It is a **boolean latch, not a count**, it is
   reset **globally** by clicking **any** meter's indicator, and it does **not** reset when
   the fader moves.

3. **Gap — `PARTIAL`.**
   - Clip indication exists on **every** channel (reference: Main Out only) — a MotionLab
     improvement, keep it.
   - **`MISSING`: the count.** "3 clips" and "clipped at some point" are different pieces of
     information, and the reference deliberately gives the former.
   - **`DIVERGENT`: reset scope.** Clicking one strip's over-lamp clearing *every* channel's
     is surprising and is the kind of control-that-does-more-than-it-says the house style
     objects to. Worth a per-channel reset with a modifier for reset-all.
   - **`MISSING`: reset-on-fader-move.**

### 4.5 K-System metering

1. **FSP8 does.** "The Peak/RMS meters in the Output Channels also feature K-System metering
   options… This metering system features **three different meter scales called K-20, K-14,
   and K-12**." The manual quotes Bob Katz's AES paper on which scale suits which material,
   and states the calibration rule: "When using any of the three K-System scales, the 0 VU
   mark should be calibrated to **85 dB SPL**… playing back a **−14 dBFS** sine wave while
   using the **K-14** scale causes the meter to read **0 VU** for both the peak and average
   levels." Switch via right-click on an Output Channel meter.

   The manual names **exactly three** scales here. It does **not** name True Peak or R128 as
   meter-scale options in the Metering section.

2. **MotionLab does.** No K-System. No scale switching of any kind. MotionLab *does* have a
   real BS.1770-4 loudness implementation (`src/model/loudness.ts` — K-weighting, −0.691
   offset, absolute gate at −70 LUFS, histogram, momentary/short-term/integrated) and a true-
   peak measurement, but they are used **only in export reporting**
   (`exportActions.ts:258`) and in the mastering page — not as a console meter scale.

3. **Gap — `MISSING`** for K-System. Worth flagging that the hard part (a correct loudness
   meter) already exists; what is missing is a **scale-offset display mode** on the master
   meter, which is arithmetic on an existing number.

### 4.6 Where meters can be shown

1. **FSP8 does.** Meters appear: on every console channel; on the Main Out and Sub Outs; on
   the Listen Bus (with configurable peak-hold); inside the **Channel Overview** (right-click
   the meter for options there too); in the **Channel Editor**; overlapped on the fader
   handle in Small+Narrow console mode; replacing the device racks in Large+Narrow mode; in
   the **channel tabs** below the Channel Overview ("Show Channel Meters"); on **Input
   Channels** for metering inputs accurately; and at the input and output of many effect
   plug-ins ("Many effects plug-ins feature peak meters at the input and output so that any
   level attenuation the effect imparts on the audio signal can be seen"). Main output meters
   also sit in the Transport bar (double-clicking them opens the Main bus Channel Editor).

2. **MotionLab does.** Console strips (`ChannelStrip`), the master strip, and the Channel
   Overview (`ChannelOverview.tsx` uses the same `StereoMeter`). `engine.watchMeter` is
   reference-counted so unwatched channels are never scanned — a good design that makes
   adding meter sites cheap. `PeakReadout` gives a text peak value beside each fader, which
   is the accessible reading the meter itself deliberately does not expose.

   `MISSING` sites: transport-bar master meters, input-channel meters, narrow-mode
   meter-on-fader, channel-tab mini meters, per-plug-in in/out meters.

3. **Gap — `PARTIAL`.**

### 4.7 Gain-reduction reporting

1. **FSP8 does.** The Mixing chapter's Metering section **does not mention gain-reduction
   metering on the channel strip at all.** `docs/REFERENCE-FSP8.md` §4.3/§4.8 asserts it
   ("gain-reduction meter fed by dynamics devices… **[C]**"). The manual chapters assigned
   here do not support that claim — see §14.

2. **MotionLab does.** GR is drawn inside `DynamicsFace` (`PluginFace.tsx`) and in
   `ChannelOverview.tsx`; the channel strip shows nothing.

3. **Gap — unverifiable from this source.** Do not build to the reference doc's [C] here
   without a better citation.

---

## 5. Effects signal routing

### 5.1 Inserts

1. **FSP8 does.** The **Insert Device Rack** holds all insert effects on a channel, visible
   in the Console (hidden in Small mode).

   **Adding:** drag from the Browser into the rack; drag directly onto a Track or Track Lane
   in Arrange; click **Add Insert** at the top of the rack for a pop-up menu that "functions
   like a smaller version of The Browser, giving you sorting options, and access to the
   **Favorite** and **Recent Plug-ins** lists", navigable with arrow keys and with a search
   bar; drag a **preset** from the Browser to add the effect with that preset loaded. The
   plug-in menu style (rich vs basic) is a Console Advanced Option.

   **Order:** "Inserts affect the audio signal path in the **top-to-bottom sequential order**
   in which they are inserted." Reorder by dragging above/below/between. "Splitters are a
   special case, and cannot be re-ordered via drag and drop due to the parallel manner in
   which they process the signal chain."

   **Editing:** click the insert, or menu arrow / right-click then Edit. All plug-ins on a
   channel "appear in tabs at the top of the plug-in header GUI". `[F11]` opens the effect
   editor for the selected Audio Track; `[Ctrl]/[Cmd]+[PageUp]/[PageDown]` cycles through
   that channel's rack. A **Pin** button in the upper right keeps a window open independently;
   any number can be pinned open at once.

   **Copying/moving:** drag an insert to another channel to **copy** it (dragging to the
   console edge auto-scrolls); drag the **rack header** to copy the whole chain; hold `[Alt]`
   while dragging to **move** rather than copy. Copy/Paste buttons in the plug-in header move
   settings between two instances of the same plug-in.

   **Compare:** "[Compare] … allows you to compare the current settings for a plug-in to the
   settings stored the last time the Session, Mastering Project or Show was saved."

   **Three off-states, distinguished:**
   - **Bypass** — "the audio signal is simply rerouted around the Insert, and any CPU or RAM
     the Insert is using remains in use". **Automatable.**
   - **Deactivate** — "turned completely off, which can free up CPU resources, but the
     process remains in RAM, enabling you to instantly turn the plug-in on/off". Not
     automatable.
   - **Disable** — "both CPU and RAM loads are relieved, however, this process is not as
     instant". Right-click then Disable; must be re-enabled before it can be activated. Not
     automatable.

   **Activate All** at the top of the rack; pressing an insert's Activate with several
   channels selected toggles that **same slot** on all of them; **Activate All Inserts** at
   the bottom-left of the Arrange view toggles every insert in the session, remembering which
   were already off (hold any modifier to activate those too).

   **Removing:** menu arrow then Remove, or drag into the console's **Trash Bin** panel;
   *Remove All* from the rack header menu. "When any Insert effect is removed, it is placed in
   the Trash Bin, where it can be restored to its original state and location at any time."

   **Add an insert to a Sends rack** creates a new FX Channel with that effect (settings
   intact) and routes a Send to it.

2. **MotionLab does.** `DeviceRack.tsx` (514 lines) on the strip, `InsertRack.tsx` (470) in
   the Inspector, `InsertChain` in `src/audio/effectChain.ts` as the audio implementation.
   Inserts are pre-fader by construction (`buildChannel`: `input -> trim -> inserts -> pdc ->
   mute -> volume -> pan`), which matches the reference. `DeviceRack` implements a device menu
   (Open / Bypass / Move up / Move down / Copy to… / Remove) and HTML5 drag-and-drop with an
   `application/x-motionlab-device` payload and drop-index insertion.

   `MAX_INSERTS = 12` (`src/model/effects.ts:1712`).

   Against the reference's list: `PARITY` on top-to-bottom order, pre-fader placement,
   drag-reorder, drag-copy between channels, per-device bypass, remove. `MISSING`: the
   Add-Insert **menu** with search/favourites/recent (the add affordance is a `<select>`),
   drag-from-Browser, drag-onto-a-track, drag-a-preset, plug-in **tabs**, **Pin**,
   **Compare**, **Trash Bin with restore**, **Activate All** (per rack, per selection, and
   session-wide), the **deactivate vs disable** distinction (MotionLab has bypass only), and
   `[Alt]`-drag-to-move.

3. **Gap — `PARTIAL`.** The three-state off model (bypass / deactivate / disable) is the most
   *conceptually* significant miss: it is a CPU-management vocabulary, and a browser DAW with
   a WASM/WebAudio graph needs it at least as much as a native one. **Bypass being
   automatable while deactivate and disable are not** is a precise rule worth adopting
   verbatim.

### 5.2 Sends — creation, controls, ranges

1. **FSP8 does.** "Sends are used to route the audio output (**pre- or post-fader**) from one
   Channel to another, such as an FX Channel."

   **Routes to create one:**
   - Drag an effect or **FX Chain** from the Browser into a channel's **Send Device Rack** —
     creates a new FX Channel *named after the effect or chain*, with the effect loaded, and
     a Send to it.
   - Click **Add Send** in the Send Device Rack, then choose an existing FX Channel (or Bus).
   - With the Sends/Cue-mix component shown, click the **`+`** to "select an existing
     destination Channel, add a new one, or make a **Sidechain** connection".
   - Drag an audio effect into blank console space, creating an FX Channel to send to.
   - Right-click blank console space or any channel then **Add FX** — an FX channel with no
     inserts, available as any send's destination.
   - Drag an **Insert** to a Sends rack — new FX Channel with that effect, settings intact.

   **Controls on the send device:** an **Activate** button, a horizontal **Level** fader, a
   horizontal **Pan** fader, and a **Pre/Post Fader** button. "Click on the Activate button to
   activate/deactivate the Send; this does not affect the Send's destination Channel."

   **Level range:** "Click-and-drag on the horizontal Level fader to adjust the send level
   between **[-inf] and +10 dB**." (The minus-infinity glyph is lost in the PDF text
   extraction, which renders the sentence as "between - and +10 dB"; +10 dB is unambiguous.)

   **Tap point — two rules, both explicit:**
   - "Pre-fader allows you to set a send level independent of the channel fader so that the
     level is unaffected by fader position."
   - "**The send source signal is always post-inserts.**"

   **Channel Pan Lock — the detail most likely to be missed.** "By default, a Send's pan
   setting in a Bus send, Cue mix send, or FX Send is **tied to that of its Channel**." Unlock
   for the whole send rack from the Sends drop-down, or per-send from each send's drop-down.
   "Disabling Pan Lock… will unhide the panning interface directly below the Send Level
   interface." And: "if a Send is unlocked from a Channel's panning, **all newly-created sends
   will also be unlocked**. This default setting will also carry over to new Documents."

   **Fine control:** double-click a send device for a larger pop-up; those pop-ups show the
   Cue Mixes for the selected channel, and arrow keys navigate Cue Mixes, Sends and Panning
   across the console. Double-click a Send to jump to its destination's Insert rack.

   **Bulk:** "In any Send Device Rack, all Sends can be removed simultaneously by choosing
   **'remove all'** from the Send Device's drop-down menu. This can be applied to several
   Channels at once when they are group-selected."

   **Copy/move:** drag a send between racks to copy it (same destination); drag the **rack
   header** to copy the whole send set; `[Alt]`-drag to move.

   **Who can send:** any channel. "You can also create a Send on an **FX Channel** to route
   the affected signal to any other Audio, Instrument, Bus, or even another FX Channel."
   "**Buses have Sends that can be used the same way as other Sends.**"

   **How many:** the manual states no limit, and none of the described interactions implies
   one. Multiple sends per channel are the norm; nothing prevents two sends to one
   destination.

2. **MotionLab does.** `src/model/types.ts:388`:

   ```ts
   export interface Send {
     busId: string;      // target bus track id
     amount: number;     // linear amount 0..1.5
     enabled: boolean;
     preFader: boolean;  // post-fader is the default
   }
   ```

   `SendRack` (`InsertRack.tsx:385`) renders **one row per existing bus**, not one row per
   send object: `buses.map((bus) => { const send = sends.find(s => s.busId === bus.id) … })`.
   The strip's `SendRows` (`ChannelStrip.tsx`) shows at most three enabled sends, read-only,
   clicking through to the Inspector.

   **Engine (`engine.ts`, `syncGraph`):**

   ```ts
   const tap: AudioNode = send.preFader ? ch.inserts.exit : ch.panner;
   ```

   Pre-fader taps **after the inserts and before PDC/mute/fader**, which matches "always
   post-inserts" exactly; post-fader taps **after the panner**, so a post-fader send inherits
   the channel's pan. That is accidental parity with the reference's **Pan Lock default** and
   is worth recording before someone "fixes" it.

   Also:

   ```ts
   const level = send.enabled && audible ? Math.max(0, send.amount) : 0;
   ```

   A **pre-fader send is silenced by mute and by another channel's solo**. The reference only
   promises independence from the *fader*. Plausible and probably correct, but unstated in the
   manual: mark unverified.

   And buses/FX are refused sends in **both** layers — UI (`SendRack` early-returns with
   "Buses route straight to Master and cannot send onward") and engine
   (`track.type === 'bus' || track.type === 'fx' ? [] : (track.sends ?? [])`, with the comment
   "Buses never send onward, which keeps the graph acyclic").

3. **Gap — `PARTIAL`, and this is one of the two largest gaps in the chapter.**

   | Reference behaviour | MotionLab | Status |
   | ------------------- | --------- | ------ |
   | A send is a created **object** with a destination | One row per bus, keyed by `busId` | `MISSING` — two sends to one destination impossible |
   | Level range -inf…**+10 dB** | `0..1.5` linear, about -inf…**+3.5 dB** | `PARTIAL` — 6.5 dB short |
   | Numeric dB readout on the send fader | none (raw `<input type=range>`) | `MISSING` |
   | **Send pan** | not in the model at all | `MISSING` |
   | **Pan Lock** (locked by default; unlockable per-rack and per-send; sticky for new sends and new documents) | n/a (no send pan) | `MISSING` |
   | Activate button per send | `ON`/`OFF` button | `PARITY` |
   | Pre/Post Fader button | `PRE`/`PST` button | `PARITY` |
   | Send source always post-inserts | `ch.inserts.exit` | `PARITY` |
   | Buses and FX channels can send | refused in UI **and** engine | `MISSING` |
   | Send to a plug-in **sidechain input** | `Track.sidechainFrom` picks a *source channel*, wired post-fader from `src.panner` to `inserts.sidechainInputs()` | `PARTIAL` — routing exists, but as a channel property rather than a send with its own level/pre-post |
   | Fine-control pop-up + arrow-key traversal | none | `MISSING` |
   | Remove-all sends, incl. across selected channels | none | `MISSING` |
   | Copy send / copy whole send rack / Alt-move | none | `MISSING` |

   The **acyclic-graph justification for refusing bus sends is sound but over-broad.** The
   reference solves the same problem differently and says so: "It is possible to **nest buses
   infinitely**… **Feedback prevention is in place** so that you can't create a bus routing
   that would cause a feedback loop (e.g., A to B, B to C, C to A)." That is cycle
   *detection*, not a blanket ban. MotionLab already has the graph walk to do it —
   `mixerGraph.feedersOf` plus the `seenDown`/`seenUp` traversals in `resolveChannels` are
   most of a reachability check.

### 5.3 Buses and groups — creating, routing, nesting

1. **FSP8 does.**

   **Creating a Bus:** right-click blank console space or any channel then **Add Bus**; or
   select channels, right-click, **Add Bus for Selected Channels** ("quickly create a new Bus
   and route the selected Channels to that new Bus"); or the drop-down beside the I/O icon in
   the Console Navigation column, which adds a Bus, FX, VCA or Aux.

   **Routing to a Bus:** choose it as a channel's **Output**, or send to it. "Although less
   common, it is also possible to use Sends to route audio to Bus Channels" — used for
   **multing**, "routing a Channel to multiple places… a convenient way to layer sounds".

   **Bus outputs:** "The Bus sends its summed signal to the Main Out by default but can also
   be routed to Sub Out Channels."

   **Nesting:** infinite, with feedback prevention (quoted in §5.2 above).

   **Source management:** click a Bus/FX channel's input area for a list of assigned/sent
   tracks, with **Select All**; right-click a Bus for **Hide Sources** / **Show Sources**;
   right-click then **Remove** re-routes all source tracks to the Main Out.

   **Transform to Rendered Audio:** renders a whole bus structure (including its inserts) to
   one audio track, restoring bus send assignments on the new audio channel, applying an edit
   lock, and reversible via **Transform to Bus Channel**. Only available "if subordinate
   channels do not have Send targets outside of the bus and are not targeted by sources
   outside of the bus". Buses linked to VCAs can be transformed only if the VCA has no
   automation data (otherwise use **Merge VCA automation** first). Mix FX are not reinstated
   on the way back.

   **Instrument buses:** *Automatically Create Instrument Busses* creates a bus per multi-out
   instrument; *Create Buses for All Multi-Out Instruments* does it manually.

   **Groups (Edit Groups) in the console** — a *separate* concept from buses:
   - Create: select channels, right-click, **Group Selected Tracks**, or `[Ctrl]/[Cmd]+G`.
     Dissolve: `[Ctrl]/[Cmd]+[Shift]+G`.
   - "When a Channel is placed in a Group its fader is **linked** to the faders for all other
     Tracks in the Group, so that if one of them is moved, **they all move**. Their movements
     are **relative** to one another, maintaining the correct dB value relationships."
   - "**Solo, Mute, Record Enable, and Monitor Enable controls are also linked.**"
   - **Effects propagate and replace:** "changes that are made to the effects of any grouped
     Channel will cause all of the Channels within the Group to adopt the same changes. Note
     that this does **not add** the new effects to the ones already on the Channels; those
     will be **replaced**."
   - **Suspension:** `[Alt]/[Option]` while touching a control suspends for that gesture;
     `[Shift]+G` plus number/letter suspends a whole group; `[Alt]` plus a number 1-10 does
     the same; `[Ctrl/Alt]/[Cmd/Opt]+G` suspends/reactivates **all**. "Group suspensions are
     not saved or remembered when Fender Studio Pro is restarted."
   - **Nesting:** channels can be in a small group and a larger one; "in order to make
     adjustments to the smaller, nested Group, the larger Group must be temporarily
     suspended". A channel can belong to more than one group.
   - **Group Attributes:** Editing, Volume, Pan, Mute/Solo, Record/Monitor, Inserts, Sends —
     each individually includable or excludable per group.
   - **Solo interactions:** "[Alt]/[Option]-clicking Solo on a grouped Track **clears the Solo
     status of all Tracks** in the Console"; "It is **not possible to solo single Tracks from
     two separate Groups simultaneously**, though you can solo a single Track from one Group
     and solo all Tracks in a second Group."

2. **MotionLab does.**

   **Buses:** `addTrack('bus')` / `addTrack('fx')` from the mixer's `+` menu. Routing by the
   strip's output `<select>` (Master or any bus/FX). Nesting is **impossible**: `syncGraph`
   forces `const dest = track.type === 'bus' || track.type === 'fx' ? 'master' : track.output`
   — a bus's output is hard-wired to master regardless of what the project says. Feeders are
   surfaced as a count plus tooltip on the strip tag and computed by
   `mixerGraph.feedersOf(tracks, busId)`.

   `MISSING`: add-bus-for-selected-channels, hide/show sources, remove-with-reroute, transform
   to rendered audio, sub-outs, instrument buses, and **bus nesting entirely**.

   **Groups:** `Track.editGroup` (1-4) exists, but it is used **only** for clip-edit linking
   in the arrangement (`src/components/arrangement/ClipView.tsx:312` and the `G1` badge in
   `TrackHeader.tsx:288`). Nothing in the console reads it. There is no fader linking, no
   mute/solo linking, no group attributes, no suspension, no nesting, no group-assignment row.

3. **Gap.**
   - **Bus nesting: `MISSING`.** This is the single most consequential routing gap. The
     reference calls it infinite; MotionLab hard-codes bus-to-master in the engine. It also
     makes the "no sends from buses" restriction (§5.2) doubly binding: a bus can reach
     another bus by neither route.
   - **Console Groups: `MISSING`.** MotionLab has the *name* (`editGroup`) attached to a
     different feature, which is worse than not having it — a user who groups tracks
     reasonably expects the faders to link.
   - Bus creation and routing-to: `PARITY`.
   - Bus source list / hide sources / transform: `MISSING`.

### 5.4 VCA channels, and VCA vs group

1. **FSP8 does.** The manual builds the distinction explicitly, and it is the clearest
   statement of the three-way difference:

   - **Group:** "when you create a Group, the volume faders for all included Channels **move
     simultaneously** when any grouped fader is moved. This means that any inter-channel
     volume balancing involves either temporarily ungrouping the Channels, or changing the
     relative gain of a Channel using the gain control on an inserted plug-in."
   - **Bus:** "A similar effect can be accomplished by routing Channels to a Bus and writing
     volume automation for that Bus. However, this means that **the audio from all affected
     Channels must pass through that Bus**, which may not be desirable."
   - **VCA:** "special assignable control faders… that allow simultaneous movement (and
     automation) of the volume of multiple Channels. The individual volume faders of affected
     Channels **can still be moved independently** — all faders move as one only when you
     change or automate the setting of the linked VCA Fader."

   **Creating/assigning:** select channels, right-click, **Add VCA for Selected Channels**;
   or right-click then **Add VCA Channel**, then assign per channel from the selector **under
   the meter/fader**. That selector is shown/hidden by **Show VCA Connections** in Console
   Options. Unassign by choosing **None**.

   **Automation:** right-click the VCA fader then **Edit Volume Automation**. "Any automated
   changes in VCA Fader level are applied in a **relative** manner to the faders for any
   linked Channels. You can see this reflected in a **gray automation line that sits alongside
   the volume automation of each affected Track**." **Merge VCA Automation** (right-click the
   VCA fader track in Edit view) bakes the VCA moves into each member's own automation and
   returns the VCA lane to default.

   **Nesting:** "their effects can be nested. For example, if you have multiple snare
   Channels, they could be linked to a snare-specific VCA fader… Then, all drum-related VCAs
   (and drum Channels not yet linked to a VCA) could be linked to a 'master' VCA Fader."

   **Folder tracks:** assign a Folder Track (and its tracks) to a VCA from the folder's
   Bus/VCA selector; "This assignment can then be defeated or changed on a per-track basis."

2. **MotionLab does.** `type: 'vca'` tracks; `Track.vcaId` per member; `VcaStrip.tsx` renders
   the fader, member list, and M/S. `mixerGraph.resolveChannels` multiplies the VCA's volume
   into `groupGain`, and — importantly — returns `groupGain` **separately** so that
   `engine.applyAutomation` can multiply it back:

   > "Volume automation writes the track's own fader value, so it has to multiply this back in
   > or a VCA would be ignored the moment a volume lane started playing."

   That is the correct relative-VCA semantic, and it is enforced in one place that the engine,
   the meters, the mixer UI and the offline bounce all read — which is the right architecture.
   VCA mute mutes members; VCA solo solos members (`soloed` expansion in `resolveChannels`).
   Assignment is a `<select>` in the strip footer (`ChannelStrip.tsx`), shown only when VCAs
   exist and the strip is not a bus/FX.

   `MISSING`: **VCA nesting** (a VCA strip has no VCA selector, and `vcaMembers` is a
   single-level `t.vcaId` lookup), **VCA automation lane** (`VcaStrip` has no automation
   affordance and no `captureParamChange` call — the VCA fader writes no automation at all),
   **Merge VCA Automation**, and the **grey companion line** on members' volume lanes.

3. **Gap — `PARTIAL`, and the *concept* is at parity while the *automation story* is absent.**

   The three-way distinction MotionLab actually implements is: **bus** (audio passes through),
   **VCA** (gain scaling, no routing change), **folder** (gain scaling *and* arrangement
   nesting). It has no **group** (linked faders). So MotionLab has the reference's *hardest*
   case right and its *easiest* case missing.

   The highest-value single addition here is **VCA volume automation**, because the manual's
   own justification for VCAs is automation ("it can be desirable to write automation that
   changes volumes for a whole set of Channels"), and MotionLab's VCA fader currently cannot
   be automated at all.

### 5.5 Sidechaining

1. **FSP8 does.** "Sidechaining is accomplished by using a **Send** to route audio to a
   special Sidechain input on an Insert." Assigned from inside the target plug-in: click the
   arrow beside the Sidechain activation button and select one or more channels. "It is
   possible to send to the Sidechain input of any insert effect, **whether or not the sidechain
   is engaged** in the effect."

   The routing menu offers **Send** (creates one if none exists) with a **pre/post-fader
   toggle**, or **Output** (route the channel's output to the sidechain instead). Right-click
   in the routing menu gives: Send Active, Send Prefader, **Lock Pan to Channel**, Show in
   Console.

2. **MotionLab does.** `Track.sidechainFrom` names a **source track**; `syncGraph` builds a
   gain node from `src.panner` (post-fader, post-pan) into every
   `ch.inserts.sidechainInputs()`, and calls `ch.inserts.setSidechain(true)`. The comment
   records the design reason: "The key tap is post-fader on the source because a kick that is
   faded down should duck less, which is what an engineer expects."

3. **Gap — `PARTIAL`.** The audio path exists and is defensible. `MISSING`: sidechain as a
   **send** (so no independent sidechain level, no pre/post choice, no pan lock), assignment
   from **inside the plug-in**, multiple sources, and the output-instead-of-send option. Also
   `DIVERGENT`: FSP8's sidechain send is **user-chosen** pre or post; MotionLab hard-codes
   post-fader.

### 5.6 FX Chains, Mix Engine FX, hardware inserts

1. **FSP8 does.**
   - **FX Chains:** store a channel's whole insert rack (with settings) as a named chain from
     the rack's menu arrow then **Store FX Chain**; or drag the rack header to the Effects
     Browser (chain named after the channel) or the File Browser (exports a file). Chains
     live in an **FX Chains** folder in the Audio Effects Browser; drag one onto a channel to
     insert, onto a device to replace it, or between devices to insert without disturbing the
     rest. Expand a chain in the Browser to drag out individual effects or presets. Chains
     "incorporate any **parallel processing** you set up in the Routing view" and carry custom
     Macro Controls.
   - **Mix Engine FX:** "a plug-in format… specializing in processing tasks that affect
     multiple channels in a Session (such as console emulation)". One slot per Bus; "All
     Channels that feed that Bus are affected by the Mix Engine FX plug-in **at their source**".
     One-click bypass for whole-mix A/B; enables inter-channel effects such as console-style
     crosstalk. "Each Bus can have one Mix Engine FX plug-in inserted at a time."
   - **Hardware Inserts:** an External Effect plug-in routes to outboard gear and back,
     "automatically compensating for the round-trip latency".

2. **MotionLab does.**
   - **Chains:** `src/state/chainStore.ts` saves named user chains to `localStorage`
     (`MAX_SAVED_CHAINS = 64`), per-device rather than per-project, with a documented
     rationale. `src/model/effectPresets.ts` holds the built-in chains. So **storing a user
     chain does exist** — which corrects `docs/REFERENCE-FSP8.md` §9.15's claim that "a user
     chain cannot be **saved** as an FX Chain". What is `MISSING` is the *browser integration*
     (no chain library in a browser panel, no drag-to-insert/replace/expand) and **parallel
     topology** (no Splitter, so no chain can carry one).
   - **Mix Engine FX:** `MISSING` entirely. There is no bus-level slot that reaches back into
     feeding channels, and nothing in `effectChain.ts` has that shape.
   - **Hardware inserts:** `MISSING`, and `DIVERGENT-BY-DESIGN` — the browser has no
     low-latency hardware I/O and no round-trip latency compensation primitive. Per
     `docs/REFERENCE-FSP8.md`'s own framing, functional parity is not owed here.

3. **Gap.** FX Chains: `PARTIAL`. Mix Engine FX: `MISSING` (and architecturally interesting —
   it is the only reference feature that requires a *reverse* dependency from a bus to its
   feeders, which MotionLab's one-pass `resolveChannels` model would need to accommodate).
   Hardware inserts: `DIVERGENT-BY-DESIGN`.

---

## 6. Fader Flip

1. **FSP8 does.** A **Flip** button at the top left of the Console retargets every fader and
   panner from channel volume to the **Send levels and pans for a chosen Send target** —
   including FX Channels, Bus Channels, Outputs, **Cue Mixes** and **Sidechain Inserts**. The
   target is chosen from a drop-down beside the Flip button, populated with all available
   sends.

   Visual language: "Faders will change to **green** to indicate Flip is active; **metering
   will change from displaying Volume to displaying the Send level**. Send rack items of the
   currently-selected Send target will be highlighted in green as well."

   **Hide Unassigned Faders** hides channels with no send to the target; **enabled by default**.
   With unassigned faders visible, a send can be added from the Channel Overview or the rack's
   `+`, and "the fader of the newly-assigned Channel will Flip (turn green)".

   Also activatable from a Send slot's drop-down, or the right-click menu of any channel that
   receives sends.

2. **MotionLab does.** No general fader flip. But `CueBar.tsx` plus `ChannelStrip.tsx`
   implement **fader flip restricted to cue mixes**, and implement it well:
   - selecting a cue in the bar sets `uiStore.monitorCueId` and calls `engine.setMonitorCue`;
   - every strip's fader, pan and mute then drive the **cue send** rather than the channel
     (`const level = send ? send.level : track.volume`), with the reason documented: "While a
     cue mix is being monitored, the fader, pan and mute belong to the cue: what you hear is
     what you are adjusting";
   - automation capture is correctly suppressed while flipped (`onGestureStart={() => !cue &&
     …}`, and `captureParamChange` is skipped);
   - the mode is signalled by a colour change on the bar and an `in-cue` class on every strip,
     with the reason given: "a mode that is not obvious is a mode that gets left on".

3. **Gap — `PARTIAL`.** The hard parts (retargeting every strip's fader/pan/mute, suppressing
   automation while flipped, making the mode loud) are **done**. What is `MISSING` is
   generalising the target beyond cue mixes to sends/buses/outputs/sidechains, flipping the
   **meters** to send level, hiding unassigned faders, and the send-rack highlight.

   This is the best cost/benefit item in the whole survey: the mechanism exists and is
   correct; only the target set is narrow.

---

## 7. Channel Overview and Channel Editor

### 7.1 Channel Overview

1. **FSP8 does.** "The Channel Overview provides a comprehensive look at a single mixer
   channel strip… Similar to an analog hardware mixing console, the Overview shows every
   aspect of a single channel, laid out **horizontally over the full width of the Arrangement
   view**." Opened from a button at the far right of the Transport Bar, or by double-clicking
   the rightmost area of a track or the lower area of a channel (which toggles between Console
   and Channel Overview). Detachable.

   Two sections: **Channel Controls** (the ordered list quoted in §1.1) and **Inserts
   Preview**.

   **Compact Views:** "Crucial parameters of insert effects can be accessed directly without
   having to open the Channel Editor. This includes custom views for certain Native FX
   plug-ins, as well as a **user definable view for any third-party plug-in**." Configure via
   the arrow on an insert bubble then **Setup Edit Parameters**, an add/remove parameter
   dialog. Double-click a slot to open the full editor. Drag the insert bubbles to reorder the
   chain.

   **Channel tabs** run below the Overview for quick channel switching, with buttons to show
   channel **icons**, per-tab **meters**, and **inputs/outputs**, plus an I/O button opening
   the Audio I/O Setup.

2. **MotionLab does.** `src/components/mixer/ChannelOverview.tsx` (242 lines), hosted above
   the console by `Mixer.tsx` when `uiStore.channelOverview` is set. Its own doc comment states
   the same motivation almost word for word: "A console strip is 90 pixels wide, which is the
   right shape for comparing twenty channels and the wrong shape for working on one."

   It lays out: name, Input (polarity, mono), the **first non-bypassed EQ** as a real curve,
   the **first non-bypassed dynamics device** with live gain reduction, the remaining chain as
   chips, sends, pan, fader plus meter.

3. **Gap — `PARTIAL`.** Concept and layout: `PARITY`. `MISSING`: a per-device view for
   **every** device (only the first EQ and first dynamics get one), **user-definable
   parameters** for unknown devices, **reorder by dragging the bubbles**, **channel tabs**
   with icons/meters/IO, **detach**, the **expand-to-Inputs/Sends/Cue-Mix** column, and
   notes/icon/group/automation controls.

### 7.2 Channel Editor, Macro Controls, Routing/Splitter

1. **FSP8 does.** Three views: **Channel**, **Routing**, **Macro Controls**. "Since the Channel
   Editor is all about configuring and controlling audio effects, **only Audio Channels and
   Channels associated with software Instruments have this feature**."

   **Macro Controls:** "**eight knobs, eight buttons, and two X/Y control pads** available for
   each Channel." Any parameter (or several) per control; a control showing multiple
   assignments displays the first parameter's name with a `+`. Assign from a built-in plug-in
   by right-click then "Connect (name of control) to Channel Macro Control". The **Macro
   Controls Mapping** view (wrench) gives three columns (macros / targets / plug-in
   parameters), drag or `[Add Targets]`/`[Remove Targets]`, unlimited assignments per macro,
   renameable.

   **Transform settings per assignment:** a response curve from start to end of the macro's
   travel, with draggable endpoints (which set the *effective range*, and can be **inverted**
   by putting the right point below the left) and a mid handle for curve shape; Reset /
   Invert / Copy / Paste. Macro **buttons** have no curve but can be inverted from the Trans
   column. Right-click a macro knob or switch for **automation** of that control.

   **Routing view:** effects are modules connected top to bottom in series by default; select
   one to see its key controls and a colour picker in the left inspector; each module has a
   Bypass button and Edit/Rename/Remove.

   **Splitter:** dragged in from the `[Splitter]` button. Options: **Splits** (number of
   paths), **Mute Output** per path, **Levels** ("from fully off (-inf dB) to +10 dB",
   settable by slider, by typing a dB value, or from the fader icon on each path in the
   Routing view), and **Split Mode**:
   - **Normal** — identical copies, "useful for any sort of parallel processing, such as 'New
     York' compression or vocal multiprocessing";
   - **Channel Split** — splits multichannel signals into pairs of mono signals;
   - **Frequency Split** — crossover into bands at frequencies you specify, "numbered from low
     frequency to high".

   "Splitter effects chains are compensated for plug-in delay automatically, retaining the
   proper time relationship between all split channels." Removing a splitter reconnects its
   contained effects in series.

2. **MotionLab does.**
   - **Macros:** `MAX_MACROS = 8` (`src/model/macros.ts:14`); `Macro { id, name, value,
     targets }` with `MacroTarget { from, to }` giving each target a **range** (`targetNorm`
     maps macro position into `[from, to]`, and `from > to` inverts). Bound to `Track.macros`
     and resolved through `paramRegistry`. So: 8 knobs `PARITY`, per-target range and
     inversion `PARITY`. `MISSING`: 8 **buttons**, 2 **X/Y pads**, a **curve shape** per
     assignment (only a linear range map), the mapping view, macro **automation**, and macros
     travelling with a saved chain (they belong to the track).
   - **Routing / Splitter:** `MISSING` entirely. `InsertChain` is strictly serial; there is no
     parallel path, no channel split, no band split.
   - **Channel Editor as a three-view window:** `MISSING`. MotionLab has the Inspector and the
     Channel Overview but no Routing view and no macro-mapping view.

3. **Gap — `PARTIAL` on macros, `MISSING` on Routing/Splitter.** The Splitter is the largest
   single *DSP-architecture* gap in this chapter: it is the reference's answer to parallel
   compression, mid/side and multiband, and it changes what an "FX Chain" can contain.

---

## 8. Scenes (console scenes)

1. **FSP8 does.** Scenes "save and recall different configurations of Channels and Tracks, as
   well as different settings". Recalling one "shows the desired Channels and Tracks and hides
   all of the others". Any number per session; saveable in a Session Template. Accessed from
   **Show Scenes** in the Console Navigation column or `[Ctrl]+[Alt]/[Option]+[S]` "whether the
   Scenes list is open or not".

   Automation data is saved and recalled for **Volume, Pan, Mute, Inserts** when those are
   checked.

   **Recall Options** — which aspects of a Scene are applied: Visibility, Volume, Pan, Mute,
   Inserts, **Sends** (including Prefader on/off), **Cue Mix**, **Input Controls**, **Selected
   Channels only**, **Recall Input Channels**, **Recall Output Channels**.

   **Management:** Recall / Rename / Update / Remove / Remove Scenes (multi-select).

   *(Distinct from Launcher Scenes, which are a clip-launching concept in a different chapter.)*

2. **MotionLab does.** `MISSING` entirely. Nothing in `src/state/` or `src/model/` stores a
   console snapshot. `ProjectData.scratchPads` is a different feature (alternative
   *arrangements*, not console configurations).

3. **Gap — `MISSING`.** Worth noting the shape MotionLab would need: a scene is (a) a
   visibility set and (b) a selective settings snapshot with a per-aspect recall mask. The
   recall mask is the part that makes it useful and the part most implementations omit.

---

## 9. The Listen Bus

1. **FSP8 does.** "A dedicated Listen Bus is available for monitoring Solo signals, which
   allows you to solo individual Channels and sources **without affecting the Cue Mix buses**.
   It can provide a separate audio feed to the control room monitors or headphones,
   independently from the Main Out Channel."

   **Enable Listen Bus** (right-click any channel, or Console Options) adds it to the console
   "immediately to the left or right of the Main Out Channel. It can be dragged to either
   side." Its output can be routed to any output pair; its status is saved with the session.

   **Solo through Listen Bus** is toggled *independently*: engaged, soloed channels route
   through the Listen Bus **and the other channels are still heard through the Main Out**;
   disengaged, "soloed Channels are heard through the Main Out Channel and all other Channels
   are muted" (i.e. plain SIP).

   "Note that the Listen Bus is **completely independent from the other Solo modes** (Solo Safe
   and Solo-in-Place)."

   **Features:** Insert FX **and Post-fader FX**; output channel selectable in the field above
   the **Peak Hold** meters; configurable Peak Hold behaviour; an **L** button that "is
   highlighted when any Channel is in Solo mode. Use it as a **master Solo button** to enter
   and exit Solo mode for all soloed Channels at the same time"; **Prefader Listen** — "The
   Listen Bus offers a dedicated **PFL (Pre-Fader Listen)** option. Signals soloed in PFL mode
   are monitored **pre-fader and pre-pan**. With PFL disengaged, the solo signal is monitored
   **after fader and pan**" (i.e. AFL); **Click On/Off** and **Click Volume**; **Channel Mode**
   (stereo/mono). Also available on the Mastering Page.

   Another stated use: "run a room calibration plug-in as a Listen Bus insert while keeping the
   Main Output unaffected."

2. **MotionLab does.** `MISSING` entirely — no listen bus, no PFL, no AFL, no separate monitor
   path. Grepping `listenBus|PFL|AFL` across `src/` returns nothing.

   Adjacent capabilities that exist: **cue mixes** (a separate headphone balance per performer,
   `model/cueMix.ts`, `MAX_CUE_MIXES = 8`, with `ignoreSolo` per cue) and the master strip's
   **DIM** (-20 dB monitor dim) and **MONO** check. The metronome click is deliberately joined
   *after* the master analyser and limiter so it is never metered, compressed or bounced
   (`engine.buildMasterChain`) — which is the same instinct as the Listen Bus's separate click
   controls, applied to the main path instead.

3. **Gap — `MISSING`.** This is where the three solo modes actually live in the reference:
   **SIP** is the console default, and **PFL/AFL** exist only via the Listen Bus. So MotionLab
   has one of three solo monitoring modes. The full Listen Bus is a large build; the
   **PFL/AFL choice for solo monitoring** is the part with real mixing value and could be
   carried on the existing graph (a pre-fader/pre-pan tap already exists for pre-fader sends).

---

## 10. Delay compensation and manual track delay

### 10.1 Automatic plug-in delay compensation

1. **FSP8 does.** "In Fender Studio Pro, this delay is managed with plug-in delay compensation
   **through the entire audio path**. There are **no settings to manage**, as this feature is
   completely automatic. The sync and timing of every Audio Channel in your Session are
   automatically maintained, no matter what processing is being used. The current **total
   plug-in delay time is displayed in the left-side Transport, below the current sample rate**."

   Additionally, "Splitter effects chains are compensated for plug-in delay automatically."

2. **MotionLab does.** `engine.applyPdc()` (`engine.ts:537`):

   ```ts
   let deepest = 0;
   for (const ch of this.channels.values())
     deepest = Math.max(deepest, ch.inserts.latencySamples());
   for (const ch of this.channels.values()) {
     const behind = Math.min(cap, deepest - ch.inserts.latencySamples());
     safeSet(ch.pdc.delayTime, Math.max(0, behind) / ctx.sampleRate, …);
   }
   ```

   Each channel carries a `DelayNode` sized at `MAX_PDC_SEC`, placed **after the inserts and
   before the fader** so "what it holds back is exactly this channel's processed signal and
   nothing downstream of the mix decisions". Recomputed after every chain re-sync, "because
   that is when a chain's declared latency can have changed". `pdcSamples()` is exposed as a
   test probe.

3. **Gap — `PARTIAL`, with a likely correctness bug worth a test.**

   The compensation is **flat, not graph-aware**: every channel is equalised against the single
   deepest *channel* latency, with no account of routing depth. A track routed through a bus
   that itself carries a latent insert passes through that latency **in addition to** its own
   compensated delay, while a track routed straight to master does not. The bus's own `pdc`
   delays the bus output further, which pushes the through-bus path later still rather than
   pulling it earlier.

   Expected symptom: with a look-ahead limiter on a bus, tracks through that bus sit late
   against tracks going direct to master by roughly the bus's insert latency. This is an
   inference from reading `applyPdc` — it should be confirmed by a test that renders a click
   through a latent bus and a direct path and compares sample offsets, before anything is
   changed.

   Also `MISSING`: the **total plug-in delay readout** in the transport. `pdcSamples()` already
   computes it; nothing displays it.

### 10.2 Manual audio track delay

1. **FSP8 does.** "Open the Inspector view by clicking on the Inspector button or pressing
   [F4]… Enter a **positive or negative Delay value, in milliseconds**, to apply a delay to the
   Track." The manual gives the ambient-mic worked example and the arithmetic (distance in feet
   divided by 1,129, or metres by 343; 100 ft gives 88.5 ms, entered as -88.5).

2. **MotionLab does.** `MISSING`. No `delayMs`, `trackDelay` or equivalent field on `Track`;
   nothing in the engine offsets a channel by a user value. The per-channel `pdc` `DelayNode`
   already exists and is the obvious host for a **positive** manual delay; a **negative** delay
   needs the same trick the reference uses — push everything else later — which the flat PDC
   pass could absorb.

3. **Gap — `MISSING`.** Small model change, real mixing value, and the infrastructure is
   already in the graph.

---

## 11. Marker track, looping, mixing down

### 11.1 Marker track

1. **FSP8 does.** Markers placed on a dedicated Marker Track. `[Y]` adds a numbered marker
   (sequential 1, 2, 3…); `[Shift]+[Y]` prompts for a name; double-click to rename. A
   **Timebase** button toggles between **musical** (bars/beats — markers move with tempo) and
   **absolute** (clock — markers stay put). Inspector list with a locator icon highlighting the
   most recently passed marker, click-to-move-playhead, `+` to add at the cursor (refused if one
   is already there), `-` to delete (Shift for multi-select), a Start-time field, and a **Stop
   At Marker** checkbox. Navigation: `[Shift]+[B]` / `[Shift]+[N]`; `[Ctrl]+[Alt]/[Option]+[M]`
   to recall by number; up to seven from the Transport/Goto Marker menu. **Session Start and End
   Markers** (default session length "5 minutes or 151 bars at the default 120 bpm tempo") define
   the default export range and cannot be renamed. Right-click for **Create Arranger Sections from
   Markers**. Cut/copy/paste/delete, plus **Paste at Original Position**
   (`[Ctrl]/[Cmd]+[Shift]+[V]`).

2. **MotionLab does.** `ProjectData.markers?: Marker[]`; `MarkerLane` in
   `src/components/arrangement/GlobalTracks.tsx` — double-click to add, drag to move (snapped),
   context menu with **Go to marker**, **Rename**, a next-marker action, and **Delete**.

   `MISSING`: timebase toggle (musical vs absolute), Stop At Marker, an inspector list with the
   passed-marker locator, keyboard add (`Y` / `Shift+Y`), keyboard navigation
   (previous/next/recall-by-number), Session Start/End markers as an export range, Create
   Arranger Sections from Markers, and marker cut/copy/paste.

3. **Gap — `PARTIAL`.**

### 11.2 Looping during mixing

1. **FSP8 does.** `[P]` sets the Left and Right Locators around the current selection
   (`[Shift]+[P]` ignores Snap); Loop toggles from the Transport or `[Num Pad /]`. Draw a loop
   region with the Draw tool at the top of the Timeline Ruler (a tooltip shows the loop length;
   hold `[Alt]` to engage Loop at the same time). Locators are editable numerically in the
   Transport. **Loop Length** display toggles from Start/End via the `]` icon or the right-click
   menu, with a timebase choice of **Seconds, Samples, Bars or Frames**. Drag the grey connector
   line to move the whole range; **double-click the connector to enable or disable looping**.

2. **MotionLab does.** Loop region exists (`LoopRegion`, `wrapLoopBeat` in `src/model/music.ts`,
   and the engine's loop-wrap rescheduling). Locators are draggable in the ruler. A
   set-loop-to-selection shortcut exists in `src/app/shortcuts.ts`.

   `MISSING`: Loop **Length** display mode and its four timebases, double-click-the-connector to
   toggle, and `[Alt]`-drag to draw-and-engage in one gesture.

3. **Gap — `PARTIAL`.** Low priority for a mixing parity pass.

### 11.3 Mixing down

1. **FSP8 does.** **Export Mixdown** (`[Ctrl]/[Cmd]+[E]`).

   **Formats:** Wave, AIFF, **FLAC (16-, 24- and 32-bit integer)**, CAF, M4A, Ogg Vorbis, Opus,
   MP3. MP3 and Ogg Vorbis offer Constant or Variable bit rate.

   **Export Range:** Session Content (events only — "no automation, markers, chords, etc.");
   Between Loop; Between Session Start/End Marker; **Between Each Marker** (separate files per
   marker range per track, in folders named after the markers); **Between Selected Markers**;
   Launcher Playlist. **Auto Tail** — "the maximum amount of extra time (in seconds)… after the
   last event… so any natural decay or lingering effects — such as reverb or delay — are fully
   rendered"; only available with Session Content.

   **Target Loudness:** an **Adjust Loudness** checkbox with per-service presets; **Max
   Loudness** and **Max True Peak**; entering your own values switches the preset to Custom;
   service presets cannot be edited. "**Max True Peak always wins**" when the two conflict.

   **Options:** Output selection (Main Out and any Sub Outs); **Speaker Format** (Original,
   Mono, Stereo, **Split Mono**); **Processing** (Automatic / Offline / Realtime, where
   Automatic picks Realtime if external instruments or effects are in the path); **Bypass
   Master Effects**; Use Realtime Processing; **Write tempo to Audio Files**; **Import to
   Track**; Close After Export. Plus a Publishing menu and session Meta-Information used to
   tag exported files.

2. **MotionLab does.** `src/app/exportActions.ts` — `ExportSettings`:
   `format: 'wav' | 'flac'`, `bitDepth`, `float` (32-bit only), `sampleRate`,
   `dither: 'none' | 'tpdf' | 'shaped'`, `scope: 'mix' | 'stems' | 'tracks'`,
   `cueId` (render a cue's balance instead of the main mix), `range: 'song' | 'loop'`,
   `normalizeDbtp`, `trimSilence`, `tailSeconds` (default 2), `metadata`. Rendering goes through
   `src/audio/exportMix.ts`, which builds the **same `InsertChain`** as the realtime engine —
   the bounce-parity contract CLAUDE.md protects. Post-export it reports integrated LUFS and
   true peak.

   Ahead of the reference: **dither with a shaped option**, **per-track and per-bus stem
   scopes**, **cue-mix rendering**, and a measured LUFS/dBTP report.

   `MISSING`: AIFF, CAF, M4A, Ogg Vorbis, Opus, **MP3** (all lossy formats); marker-based export
   ranges (Between Each Marker / Between Selected Markers / Session Start-End); **Bypass Master
   Effects**; **Speaker Format** including **Split Mono**; **Import to Track**; **Write tempo to
   audio files**; sub-out selection; and a **target-loudness normaliser with service presets**
   (MotionLab normalises to a true-peak ceiling only — `normalizeDbtp` — with no loudness
   target, and therefore no "true peak wins" conflict rule).

3. **Gap — `PARTIAL`.** The two that matter most for mixing parity: **Bypass Master Effects**
   (one boolean, directly serving the manual's own "prepare your mix for mastering" advice) and
   **loudness-targeted export** (MotionLab already measures LUFS; it just does not act on it).
   Lossy formats are a browser-encoder question, not a design gap.

### 11.4 Mixing suggestions

1. **FSP8 does.** Prose guidance only: finish the arrangement before mixing; do not "fix it in
   the mix"; mixing is balance, not loudness; use busing for submixes and for layering;
   **"Avoid placing compressors or limiters on the master channel of your mix"** when preparing
   for mastering; raise the buffer size during mixdown since latency is irrelevant when not
   monitoring live; render/deactivate virtual instruments to free CPU; and an audio-engine
   overload watchdog that stops the system after 15 seconds of unresponsiveness.

2. **MotionLab does.** `docs/USER-MANUAL.md` and `docs/QUICK-START.md` exist. The engine has a
   **safety limiter** on the master (`threshold -1.5 dB`, ratio 20, 2 ms attack, 80 ms release)
   that is on by default and disengaged by raising the threshold rather than rewiring, plus a
   `LIM` toggle on the master strip.

3. **Gap — `DIVERGENT-BY-DESIGN`, and worth a note.** The reference explicitly advises against
   a limiter on the master when mixing; MotionLab ships one **on by default**. The two are not
   in conflict — MotionLab's is a *safety* limiter at -1.5 dB, not a loudness tool, and its
   comment says so — but the master strip's `LIM` button and the export path should make clear
   that it is a monitoring safety net. **Open question for verification:** `exportMix.ts` builds
   its own master chain; whether the safety limiter is included in a bounce was not confirmed in
   this pass. If it is, it is printing to the file, which contradicts both the reference's advice
   and the button's implied meaning.

---

## 12. Automation

### 12.1 What automation is, and the types

1. **FSP8 does.** "Automation lets you record changes in parameter values… In Fender Studio
   Pro, automation is recorded in **automation curves**, which are a series of data points
   connected by lines."

   **"Nearly every parameter in Fender Studio Pro can be automated."** Three types:

   - **Track automation** — any parameter of an Audio or Instrument Track and its events.
     "**Volume and Pan automation curves are available by default on every Audio Track.**"
     Instrument Tracks have **no** parameters automation-enabled by default, and their curves
     control the virtual instrument the track is routed to.
   - **Automation Tracks** — "a Track type dedicated to automation that only contains automation
     curves. An Automation Track can contain automation curves related to **any** Track and any
     plug-ins." Added via `[T]` then Automation. "**at least one curve on Automation Tracks is
     always visible**". Only parameters without an existing curve are offered, but a curve can
     be **dragged from another track onto** an Automation Track. Used to automate **Bus, FX and
     Output Channel parameters and Inserts**, and to keep critical curves in one place.
   - **Part automation** — see §12.5.

   **Display:** `[A]` (or the Show Automation button) shows one curve at a time superimposed on
   the track; **Expand Automation** (right-click a track, or the track's drop-down arrows) shows
   several at once in lanes. The track column then shows an **On/Off button**, the parameter
   name, and the automation mode. Each curve has an independent on/off; "Turning an automation
   curve on/off during playback has different results depending on the current Automation Mode."

   **Adding a curve, route 1:** move any parameter and it appears in the **Software Parameter
   window** at the far left of the Arrange toolbar; drag its **Hand icon** onto a track. If the
   curve exists it is displayed rather than duplicated.
   **Route 2:** `[A]`, then the track's Parameter window then **Add/Remove** — the Automation
   dialog: browse all tracks, add an Automation Track, a **search bar**, existing curves listed
   with their mode and device on the left, addable parameters on the right, `<<Add` /
   `Remove>>`.

2. **MotionLab does.** `src/model/automation.ts` — `AutomationLane { id, paramId, points,
   enabled, height? }` with points **normalized to 0..1** and the parameter descriptor
   (`src/model/paramRegistry.ts`) mapping to real units. The doc comment gives the reason:
   "Storing normalized values keeps curve math domain-free, makes every lane render identically,
   and gives cross-parameter copy/paste a defined meaning."

   Lanes live on `Track.automation` **and** on `MasterChannel.automation`
   (`types.ts:607`) — so master automation exists. `paramId` covers channel controls and sends
   (`"volume"`, `"pan"`, `"mute"`, `"send:<busId>"`) and device parameters via the registry;
   `engine.applyAutomation` dispatches on `kind: 'volume' | 'pan' | 'mute' | 'send' | 'fx' |
   'synth' | 'smp'`.

   Per-lane `enabled` is honoured everywhere (`ChannelStrip` filters on it; `AutomationLanes.tsx`
   exposes the toggle). `Track.automationOpen` is the expand-lanes state.

   `MISSING`: **Automation Tracks** as a track type (no way to collect another track's curves,
   or a bus/FX/output's, into one place); the **Software Parameter window** plus hand-drag route;
   and the **Automation dialog** with search and add/remove across all tracks.

3. **Gap — `PARTIAL`.** The data model is at parity and arguably cleaner (normalized values give
   cross-parameter paste a defined meaning, which the reference does not offer). The **discovery
   routes** are the gap: FSP8 gives two ways to find and add a parameter, one of which
   (touch-a-control-then-drag-the-hand) requires no dialog at all.

### 12.2 Editing curves — Arrow tool

1. **FSP8 does.** A track must be selected for curve points to appear.

   - **Add:** float over the curve until the Hand cursor appears, then click-and-drag to create
     a point and position it.
   - **Move:** click-and-hold a point; vertical changes value, horizontal changes time.
     `[Ctrl]/[Cmd]` while dragging **locks time or value, "depending on the distance from the
     point"**. `[Alt]/[Option]` plus left/right arrow keys nudges. `[Alt]/[Option]` plus mouse
     wheel over a point changes its value. `[Shift]` slows the drag for fine control. A pop-up
     value indicator follows the drag.
   - **Right-click a point:** "the point value **and curve color** can be changed".
   - **Push behaviour:** "you can drag an automation point as far beyond the position of other
     automation points as needed. Moving an automation point beyond other points **causes the
     other points to move as well**. The other points being moved are **restored to their
     original positions** if the point that caused them to be moved is moved back beyond their
     original positions."
   - **Segment curve:** hover between two points and a **curve handle** appears on the line;
     drag up/down to shape that segment; right-click the handle to **type a curve value and
     choose a type**.
   - **Delete:** select and `[Delete]`, or right-click then Delete.
   - **Multi-edit:** marquee in the lane; or `[Alt]/[Option]`-click empty space or a point to
     "select all points on the curve **from that point in time forward**". Dragging multiple
     points vertically "adjusts each parameter value **relative to** the point being moved".
   - **Automation Follows Events:** on by default; underlying track automation moves with audio
     events and instrument parts. Disable in Options/Advanced.

2. **MotionLab does.** `src/components/arrangement/AutomationLanes.tsx` (529 lines), windowed
   rendering like clips and notes.

   Present: add a point by clicking the curve; drag a point in both axes; marquee multi-select;
   snap with `[Alt]` to bypass (`e.altKey || snap <= 0 ? rawBeat : snapBeat(rawBeat, snap)`);
   keyboard editing on a focused point (arrow keys move value/time, `[Shift]` gives a fine
   0.01 value step versus 0.05, stepped parameters use 0.5 so one press crosses the middle);
   a title showing formatted value, beat and curve; right-click then **Curve: Linear /
   Exponential / Logarithmic / S-curve / Stepped** applied to the selection; per-lane resize;
   delete; copy/paste/duplicate via `automationActions.ts`.

   `MISSING`: the **segment curve handle** (curve shape is a per-point menu choice from five
   presets, not a draggable handle, and there is no numeric curve value); **per-point colour**;
   **Ctrl-lock to one axis**; **Alt+wheel** value change; the **pop-up value indicator** during
   a drag; **Alt-click to select everything from here forward**; **push-and-restore** when
   dragging past neighbours; and **Automation Follows Events** (grep finds nothing —
   moving a clip leaves its automation behind).

3. **Gap — `PARTIAL`.** Two stand out:
   - **Automation Follows Events** is `MISSING` and is a default-on behaviour in the reference.
     Moving a vocal comp without its volume ride is a silent data-integrity surprise, and it is
     the kind of thing users only discover after it has cost them a session.
   - **The segment curve handle** is the reference's primary shaping gesture. MotionLab's five
     named shapes cover most cases but cannot express an arbitrary curve, and the shape lives on
     the *point* rather than being drawn on the *segment*, which is a different mental model.

### 12.3 Editing curves — Paint, Transform, Range tools

1. **FSP8 does.**

   **Paint tool:** a single click adds one point; a drag paints many. On release, "the drawn
   curves of the curve are **intelligently and accurately approximated** to achieve the desired
   result with **as few points as possible**". Snap applies. Painting over existing points
   overwrites them; undoable.

   **Figures** (scroll the mouse wheel with the cursor over the Paint tool): **Freehand, Line,
   Parabola, Square, Triangle, Saw, Sine**. While dragging a waveform figure, `[Alt]` adjusts its
   **frequency**, `[Ctrl]` varies **phase (amplitude and polarity)**, and `[Ctrl]/[Cmd]+[Alt]`
   moves the whole shape along the timeline.

   **Transform tool** (from the Paint drop-down): marquee a region of a curve, then drag any of
   **eight handles (four sides, four corners)** to **scale** the selected points. Shortcut:
   select a range with the Range tool and press `[Alt]+[T]`.

   **Range tool trim:** select a range, hover the upper half until the cursor becomes the Trim
   tool, drag up/down to **trim the whole selected range**. Or hover the upper half above a
   single **segment** (the span between two points) to trim just that segment.

   **Duplicating:** `[D]` duplicates; `[Ctrl]+[C]` / `[Ctrl]+[V]` copies and pastes onto the
   **currently-selected track from the play head**. `[Alt]/[Option]` while dragging an Insert
   Effect to another track copies **its automation parameters** with it.

   **Remove Track Automation:** right-click a track to purge all written data. "**Any previously
   created automation lanes remain**, but all written automation data on the Track is purged."

2. **MotionLab does.** `automationActions.ts` implements copy / paste / duplicate / delete, with
   the clipboard holding **normalized** values and beats relative to the earliest copied point —
   so a paste is defined at any playhead position **and across parameters**: "pasting a volume
   ride onto a filter lane is a legitimate move, which is exactly why lane values are normalized
   in the first place." Duplicate places the copy immediately after the selection's span.

   `MISSING`: the **Paint tool** entirely, all **seven figures**, the point-reduction
   approximation on release, the **Transform** tool and its eight handles, and **Range-tool
   trim** for a range or a single segment.

   `PARTIAL`: **Remove Track Automation** — `projectStore.removeAutomationLane(trackId, laneId)`
   removes a lane *and* its data, one lane at a time. The reference purges data across the whole
   track while **keeping the lanes**, which is a meaningfully different operation (you keep your
   lane layout and start the pass again).

3. **Gap — `MISSING` for the drawing and shaping tools; `PARTIAL` for clipboard (better in one
   respect: cross-parameter paste).**

   Ranked by mixing value: **Range-tool trim** first (riding a whole chorus up 1.5 dB without
   redrawing it is a daily move and MotionLab cannot do it at all), then **Transform** (scaling
   an existing pass), then **Line** and **Freehand** paint, then the waveform figures.

   Note MotionLab *does* have a `trim` **automation mode** (§12.4), which solves the same problem
   from the realtime side. The Range-tool trim is its offline counterpart and the two together
   are the reference's full story.

### 12.4 Automation modes

1. **FSP8 does.** **"In Fender Studio Pro, automation modes are specific to devices on each
   Track. A delay effect on an Audio Track might be in Touch mode, while the volume, pan, and
   other effects on that Track are in different modes."** The mode is visible with Show
   Automation and chosen from the Automation Mode window.

   - **Auto: Off** — "all automation for the current parameter **and for all related
     parameters** are turned off". The manual's example: viewing a compressor's Attack and
     choosing Auto:Off turns off *all* automation for that compressor, while parameters
     belonging to other devices keep their own modes. "This is **not the same** as turning an
     individual automation curve on and off."
   - **Read** — existing curves control their parameters. "**Read mode is automatically engaged
     when you draw a new automation curve with the mouse.**" `[J]`.
   - **Touch** — writes while a touch-sensitive hardware control is held, reads when released;
     "Touch mode can be used even if your hardware controller does not have touch sensitivity.
     In this case, automation is written when you move the hardware controller." `[K]`.
   - **Latch** — reads until a control is manipulated, then "automation is written continuously
     until playback is stopped".
   - **Write** — "automation is continuously written based on the current position of external
     hardware controllers. **Existing automation is not read at any point** and is instead
     overwritten."

   The manual lists **no Trim mode**.

2. **MotionLab does.** `AutomationMode = 'read' | 'touch' | 'latch' | 'write' | 'trim' | 'off'`
   (`src/model/automation.ts`), stored as **`Track.automationMode`** — one mode **per track**,
   plus one on `MasterChannel`. Each mode carries a one-line blurb for the picker
   (`AUTOMATION_MODE_BLURBS`), and `modeRecords()` gates writing.

   Capture is implemented in `automationActions.ts` for all recording modes, driven from the
   real controls: `ChannelStrip`'s fader and pan call `captureParamChange` on move and
   `captureParamRelease` on gesture end. The documented semantics match the reference's for
   touch, latch and write, and `trim` adds "writes the **DIFFERENCE** from where the control
   started, so an existing ride is shifted rather than replaced".

3. **Gap — `PARTIAL`, with a divergence in each direction.**
   - **`MISSING`: per-device mode granularity.** This is the significant one. FSP8's mode is
     scoped to a *device*; MotionLab's is scoped to a *track*. Putting one plug-in in Touch while
     volume stays in Read is impossible. It also makes **Auto: Off** unrepresentable —
     MotionLab's `off` turns off the whole track.
   - **`MISSING`: Read auto-engaging when a curve is drawn.** A user who draws a ride in a track
     left in `off` will hear nothing and have no indication why. Cheap to add, and it is exactly
     the "control that does nothing" class CLAUDE.md names.
   - **Ahead of the reference: `trim`.** Not in the manual. Keep it, and note it as ours.
   - **`MISSING`: keyboard mode switching** (`[J]` Read, `[K]` Touch) on selected tracks.

### 12.5 Instrument Part automation

1. **FSP8 does.** "In a feature **unique to Fender Studio Pro**, automation curves for any given
   virtual instrument can be written and accessed **directly within Instrument Parts**, just like
   note data parameters such as velocity and pitch bend. Part automation is integrated into
   Instrument Parts, so that **no matter where an Instrument Part is moved, or how it is edited,
   the automation stays in place**."

   **Recording:** with Record enabled, moving a connected instrument's controls (by mouse or
   hardware) writes Part automation into the part being recorded — or live into a new or existing
   part at any time. The track must be connected to a virtual or external instrument.

   **Viewing/editing:** open the Note Editor (`[F2]`), click the jagged-peaks button at the
   bottom-left to show/hide the Automation Lanes. **Parameter tabs** run along the top; by
   default **Velocity, Modulation, Pitch Bend, and Aftertouch (Pressure)**. Add a parameter with
   the `(...)` Add/Remove button or right-click a tab then Add…, opening the same Automation
   dialog; only parameters without an existing curve are offered, and only those of the
   instrument the part's track is connected to. Or drag the hand icon from the parameter window
   into the Note Editor. Multiple lanes via `+`/`-`; a show/hide-all button. "**Any written Part
   automation is read, regardless of whether it is currently being viewed.**"

   Editing is "nearly identical" to track automation, with one exception: `[Alt]/[Option]` with
   the Paint tool "draws straight lines of any length, which only use **two curve points**".

   **Group-editing velocity:** marquee notes in the piano view then drag a highlighted velocity
   column; or marquee in the velocity lane itself, drawing "around the **tops** of the desired
   velocity columns" — "This allows for nuanced selection of only your loudest or quietest notes."

   **Select Part Automation with Notes:** selecting notes also selects visible part automation in
   the note range, so note moves, **Quantize**, and cut/copy/paste/duplicate/delete carry it.
   Automation in lanes that are not currently visible is unaffected. "This option works with all
   types of automation… **with the exception of Note Controllers such as Poly Pressure and MPE**.
   Note Controller automation data is **always** selected with their associated notes, regardless
   of the current state of the option."

2. **MotionLab does.** `MISSING` entirely. Grepping `partAutomation` / `clip.automation` across
   `src/` returns nothing; `MidiClip` carries notes but no automation. All MotionLab automation is
   track-scoped (or master-scoped) and timeline-absolute.

   Adjacent: per-note `pan` and `detune` exist on `Note` (`types.ts:246-249`), and note effects
   (`NoteFx`) process MIDI before the instrument — but neither is part automation.

3. **Gap — `MISSING`.** The manual itself calls this the reference's differentiating feature. Its
   core value is the invariant — automation that travels with the part through moves, copies and
   quantize — and MotionLab's absence of **Automation Follows Events** (§12.2) means it does not
   have the weaker track-level version either. Together these are the biggest **automation** gap
   in this survey.

---

## 13. Directive §1 deep-dive summary

| Directive ask | Answer, in one line | Status |
| ------------- | ------------------- | ------ |
| **Channel strip order** | Reference: I/O display **at top**, then input controls, insert rack, send rack, pan, fader+meter, mute/solo, VCA, group, automation mode, name, notes, icon — most rows user-hideable via Channel Components. MotionLab: name at top, output at bottom, nine fixed rows, no visibility model. | `PARTIAL` |
| **Sends** | Reference: created objects with destination, Activate, Level (**-inf…+10 dB**), **Pan** (Pan-Locked to the channel by default), Pre/Post; source **always post-inserts**; any channel including buses can send; no stated limit. MotionLab: one send per bus, 0…1.5 linear (**+3.5 dB**), no pan, no pan lock, buses refused in UI **and** engine. | `PARTIAL` |
| **Buses and groups** | Reference: buses created from a context menu or for a selection, routed by output or send, **nested infinitely with feedback prevention**; **Groups** link faders relatively plus mute/solo/rec/monitor with per-group attributes, suspension and nesting; **VCAs** scale without moving member faders or rerouting audio, nest, and automate with a merge. MotionLab: buses hard-wired to master (no nesting), no console groups (`editGroup` is clip-edit linking), VCAs correct in gain semantics but no nesting and **no automation**. | `PARTIAL` / `MISSING` |
| **Metering** | Reference: Peak **or** Peak/RMS (global, mutually exclusive, not for outputs); outputs are Peak/RMS plus **K-20/K-14/K-12** with an 85 dB SPL calibration rule; global **Peak Hold** and **Hold Length**; global **Pre-Fader Metering**; **Main Out Clip Counter** that counts and resets on click or fader move; no scale or ballistics constants stated. MotionLab: one RMS-fill plus peak-hold meter, **-60 dB floor**, ticks at 0/-3/-6/-12/-18/-24/-36/-48, fall as **26 dB/s** preference, hold decays with the bar, over-lamp is a boolean latch reset globally, post-fader only, no menu, no K-System. | `PARTIAL` |
| **Pan law** | Reference, verbatim: **"Fender Studio Pro uses a -3 dB pan law for all channel panning. On stereo channels, the panner adjusts the balance of left and right signal levels."** One law, not selectable. MotionLab: Web Audio `StereoPannerNode` — spec-defined constant-power cos/sin, **-3.01 dB at centre**, stereo handled as balance. | **`PARITY`** |
| **Solo / mute / implicit mute** | Reference: **SIP** is the console mode; **Solo Safe** by Shift-click, solo button **green**, **on by default for FX channels**; **PFL/AFL** exist only via the **Listen Bus**; Global Solo Off by Ctrl-click **with recall of the previous set**; `[M]`/`[S]` do not affect Bus/FX; **implicit-mute indication is not documented**. MotionLab: SIP with transitive up/downstream expansion through folders and VCAs, solo-safe by right-click shown as `S!`, **no FX default**, **no global solo off**, **no Listen Bus / PFL / AFL**; implicit mute distinguished as `mutedByGroup` vs `mutedBySolo` and shown as 55% opacity plus a worded tooltip. | `PARTIAL`; implicit-mute is `DIVERGENT-BY-DESIGN` in MotionLab's favour |

---

## 14. Where the manual confirms, corrects or contradicts `docs/REFERENCE-FSP8.md`

### 14.1 Contradictions — the reference doc is wrong or over-claims

1. **§4.7 "Output selector **at the bottom**" — CONTRADICTED.**
   Manual: "At the top of each Channel is a display of its configured Input and Output, with the
   Input shown at the top and the **Output below it**." The output selector is at the **top** of
   the strip, directly under the input. §4.3's item 9 ("Output selector") placed ninth in a
   top-to-bottom list is wrong for the same reason. *(Note: MotionLab currently follows the
   reference doc's incorrect placement.)*

2. **§4.8 output meter scales "True Peak, K-20, K-14, K-12, **R128**" — CONTRADICTED as stated.**
   The Metering section names **exactly three** K-System scales: "This metering system features
   three different meter scales called **K-20, K-14, and K-12**." Neither True Peak nor R128
   appears as a meter-scale option anywhere in the Metering section. Marked **[C]** in the
   reference doc; downgrade to two-thirds confirmed and drop the two extra scales unless a
   better source is found.

3. **§9.15 "a user chain cannot be **saved** as an FX Chain" — CONTRADICTED by our own code.**
   `src/state/chainStore.ts` saves named user chains (`MAX_SAVED_CHAINS = 64`, localStorage,
   per-device). The real gap is browser integration and parallel topology, not saving. This is a
   correction to the reference doc's reading of *MotionLab*, not of FSP8.

4. **§4.3 Main Out "Two insert racks… 'Inserts' (pre-fader) and 'Post' (post-fader) **[C]**" —
   NOT SUPPORTED by these chapters, and the manual attributes a post-fader FX rack to a
   *different* channel.** The only mention of a post-fader rack in the Mixing chapter is under
   **Listen Bus features**: "Insert FX and **Post-fader FX** can be added as needed." The Main Out
   description mentions no second rack. Not a flat contradiction (a Main Out post rack may be
   documented in a chapter outside this assignment) but the [C] is not earned here, and the
   feature demonstrably exists on the **Listen Bus**.

5. **§4.3 / §4.8 "**gain-reduction meter** fed by dynamics devices… **[C]**" — NOT SUPPORTED.**
   The Metering section describes Peak, Peak/RMS, Pre-Fader, Clip Counter and K-System, and
   nothing else. There is no mention of GR reporting into the console in either assigned chapter.
   Downgrade from [C].

6. **§4.5 "arrows at the very top and bottom of the rack scroll it… **[C]**" — NOT SUPPORTED.**
   The manual describes the Insert/Send **divider** drag (confirmed, §14.2) but says nothing about
   rack scroll arrows anywhere in the Mixing chapter. Downgrade from [C]. The related "no fixed
   slot count / several dozen slots" claim is neither confirmed nor denied.

7. **§4.1 "**Listen Bus** — Pro-only solo/PFL destination" — refined.** The manual confirms PFL
   and adds the detail the reference doc omits: PFL is **pre-fader and pre-pan**, and with PFL
   disengaged the solo signal is monitored **after fader and pan** (AFL). The reference doc lists
   only "PFL/AFL solo" in §4.10 without the tap points.

### 14.2 Confirmations — upgrade to manual-confirmed

- **§4.2 Small/Large console modes, Small hides the device racks, draggable Insert/Send divider
  in Large mode** — **CONFIRMED verbatim**: "In Small Console mode, the Insert and Send Device
  Racks are hidden"; "In Large Console mode, the Insert and Send Device Racks can be sized
  vertically by clicking-and-dragging on the divider between them." The **Narrow** mode detail
  the reference doc treats lightly is fully described (volume-fade handle overlapped on the meter
  in Small+Narrow; meters replacing racks in Large+Narrow).
- **§4.2 Channel List with a comma-separated Filter field, an X to clear, per-type icons** —
  **CONFIRMED verbatim**, including the "bas, guit" example. Adds: the **Group column**, the
  hidden-channels-stay-faintly-visible detail, and the **Remote Bank**.
- **§4.2 Auto-expand Selected Channel with Alt/Option to keep the previous one expanded** —
  **CONFIRMED verbatim.**
- **§4.4 Inserts are pre-fader on normal channels; sends are individually pre/post; pre-fader
  metering is a separate global toggle** — **CONFIRMED**, and strengthened: the manual adds
  "**The send source signal is always post-inserts**", which the reference doc does not state.
- **§4.6 Send device carries Activate, horizontal Level, horizontal Pan, Pre/Post Fader** —
  **CONFIRMED verbatim.**
- **§4.6 Send level range -inf…+10 dB** — **CONFIRMED**. Also confirmed for **Splitter path
  levels**: "from fully off (-inf dB) to +10 dB".
- **§4.6 Deactivating a send does not affect its destination channel** — **CONFIRMED verbatim.**
- **§4.6 Sends can target a plug-in sidechain input; adding a send to a new FX channel in one
  step** — **BOTH CONFIRMED**, and the one-step route (marked [R]) is upgraded to [C]:
  "Dragging an audio effect or FX Chain to the Send slot of a Channel in the Console creates a
  new FX Channel with the same name as the effect or FX Chain, and routes audio from the original
  Channel to the new FX Channel, via a Send."
- **§4.8 Peak Hold and Hold Length, set globally from the meter's right-click menu** —
  **CONFIRMED verbatim** ("globally for all Channels").
- **§4.8 Pre-fader metering is global including the outputs** — **CONFIRMED**, with the extra
  detail that there are **two** metering-mode menus (outputs vs everything else) and the
  pre-fader setting is mirrored between them.
- **§4.8 Plain Peak is not offered on output channels** — **CONFIRMED verbatim**: "Peak meters
  are not available for the Output Channels".
- **§4.8 Main Out Clip Counter** — **CONFIRMED**, with two behaviours the reference doc omits: it
  **counts** clips (not just indicates), and it **resets when clicked or when the Main Out fader
  is adjusted**.
- **§4.9 Channel Overview laid out horizontally across the full width; user-definable parameter
  set for third-party plug-ins** — **CONFIRMED** ("laid out horizontally over the full width of
  the Arrangement view"; "a user definable view for any third-party plug-in", configured via
  **Setup Edit Parameters**).
- **§4.9 Channel Editor's three views (Channel / Routing / Macro Controls)** — **CONFIRMED**,
  plus the restriction the reference doc omits: "**only Audio Channels and Channels associated
  with software Instruments have this feature**."
- **§4.1 Macro Controls = 8 knobs, 8 buttons, 2 X/Y pads** — **CONFIRMED verbatim**, plus
  unlimited parameters per macro and per-assignment transform curves with range and inversion.
- **§4.1 / §4.5 Splitter modes** — **CONFIRMED and named**: Normal, Channel Split, Frequency
  Split; and "Splitter effects chains are compensated for plug-in delay automatically".
- **§4.5 Bypass vs disable distinction (marked [U] in §12) — RESOLVED.** The manual gives
  **three** states, not two: **Bypass** (signal rerouted around; CPU and RAM still in use),
  **Deactivate** (turned off, frees CPU, stays in RAM for instant A/B), **Disable** (frees both
  CPU and RAM, not instant, must be re-enabled before it can be activated). And: "**While Insert
  bypassing is automatable, deactivation and disabling are not.**" Remove this from §12's
  unconfirmed list.
- **§12 "`F11`: Instrument Editor or Channel Editor?" — RESOLVED for this version.** The manual
  uses `[F11]` twice: "press [F11] on the keyboard to **open the effect editor for the selected
  Audio Track**" and "press [F11] to quickly **open the FX view for the currently selected
  Channel**, or press **[Shift]+[F11]** to open the Instrument window of a selected Instrument
  Track." So `[F11]` = effects/FX view; `[Shift]+[F11]` = instrument window.
- **§4.10 Groups, VCA faders, folder-track/console linking, cue mixes** — **ALL CONFIRMED**, and
  §5.3–§5.4 above now give the full behavioural spec the reference doc only gestures at.
- **§4.5 Copy an insert between channels by dragging = copy, `[Alt]`-drag = move (marked [U]) —
  RESOLVED to [C]**: "In the event that you want to move, rather than copy, an Insert to another
  Channel, hold [Alt] as you drag the Insert from one Channel to the other." The same rule is
  stated again for Sends.
- **§4.5 Add-Insert menu with Favorites and Recent and a search bar** — **CONFIRMED verbatim.**

### 14.3 New material the reference doc does not cover at all

- **Pan modes** (Balance / Dual / Binaural), their gestures, negative width, and the
  *Use Binaural/Dual for New Channels* preference.
- **The -3 dB pan law statement** — the reference doc contains no pan-law claim of any kind.
- **Channel Pan Lock** for sends (locked by default; unlock per-rack or per-send; sticky for new
  sends and new documents).
- **Fader Flip** — absent from the reference doc entirely.
- **Console Scenes** with the full Recall Options list.
- **Mix Engine FX** — one per bus, affecting feeding channels at their source.
- **Copy/Paste Channel Settings** across channels, sessions and pages.
- **Infinite bus nesting with feedback prevention.**
- **Transform Bus to Rendered Audio** and its VCA-automation precondition.
- **Group Attributes**, group suspension gestures, and the two solo-with-groups rules.
- **VCA nesting**, **Merge VCA Automation**, and the **grey companion automation line**.
- **The whole Automation chapter** — the reference doc has no automation section. Everything in
  §12 above is new: the three automation types, Automation Tracks, the Software Parameter
  window / hand-drag route, the Paint tool's seven figures, Transform, Range-tool trim,
  per-**device** automation modes, and Instrument Part automation.
- **Automatic PDC with a total-delay readout in the transport**, and **manual per-track delay in
  milliseconds**.
- **Export Mixdown's** full option set (marker-based ranges, Auto Tail, target loudness with
  "Max True Peak always wins", Speaker Format incl. Split Mono, Bypass Master Effects).

---

## 15. Open questions for verification

Items inferred from code reading rather than confirmed, listed so nobody builds on them:

1. **PDC graph-awareness** (§10.1) — does a track through a latent bus sit late against a direct
   track? Needs a render test comparing sample offsets.
2. **Safety limiter in the bounce** (§11.4) — is the master safety limiter present in
   `exportMix.ts`'s rendered output? If yes, it prints to the file.
3. **Bus mute propagation to `mutedByGroup`** (§3.3) — a channel silenced because its output bus
   is muted appears not to be flagged.
4. **Pre-fader sends and mute** (§5.2) — MotionLab silences pre-fader sends on mute/solo; the
   manual only promises independence from the fader.
5. **Web Audio stereo pan folding** (§2.1) — the spec folds the far channel into the near one at
   extremes; the manual does not say whether the reference's Balance mode does.
