# Directive 09 §1 — Parity Analysis: the "Setup" chapter

**Reference document:** _Fender Studio Pro 8 — User Manual_ (referred to below as
**FSP8**), chapter **Setup**, manual pages 13–43, extracted text lines 719–2090.
**Analysed against:** MotionLab Studio, branch `claude/motionlab-studio-poc-3l1gwa`,
commit `4d3c6f0`.
**Analyst:** Research Analyst, Directive 09 §1.

## How to read this document

Every documented behaviour gets a numbered block with three parts:

- **FSP8 does** — the exact reference behaviour: named control, range, default,
  and the dialog/tab/page path it lives on. Quoted where wording is load-bearing.
- **MotionLab does** — what the shipping web app does _today_, established by
  reading the code. Where a thing is absent, the grep that established it is named.
- **Gap** — exactly one of `PARITY` · `PARTIAL` · `MISSING` · `DIVERGENT-BY-DESIGN`.
  `DIVERGENT-BY-DESIGN` means the browser platform cannot perform the native
  mechanism and a reason is given; it never means "we don't need the workflow".

### IP boundary

This is a **reference document**. Manual quotations appear here, attributed, only
where the exact wording carries the behaviour. **No product name, trademark, or
manufacturer name from the reference is proposed for MotionLab UI, code, symbols
or filenames.** Where a MotionLab-side equivalent is named it is a neutral
generic term — "Input Bus", "Device Setup", "Audio I/O Map" and so on. Nothing in
this file is cleared for `motionwave/`; see `LEGAL_NOTES.md`.

---

# 1. System Requirements

_(FSP8 manual p. 13; extract lines 764–796)_

## SR-1 · Operating-system floor

**FSP8 does:** Publishes hard OS/CPU minimums. macOS 13 (Ventura) or higher on
Intel Core i3 / Apple M1 or better — with a stated end-of-support date of
2026-12-31 for macOS 13. Windows 10 22H2 (64-bit only) or Windows 11 22H2+, on
Intel Core i3 / AMD A10 / Snapdragon X or better — Windows 10 support also ends
2026-12-31. Linux is a **Public Beta**: Ubuntu 24.04 LTS or higher including
derivatives, **Wayland session required**, Intel Core i3 / AMD A10 or better,
Vulkan 1.1 or OpenGL ES 2 compatible graphics driver.

**MotionLab does:** No OS matrix exists — the product is a browser application.
The only hard gate is `missingHardRequirements()` in `src/main.tsx:110–118`,
which checks for exactly two capabilities: `structuredClone` and
`AudioContext`/`webkitAudioContext`. When either is missing the root element is
replaced with a static block reading "This browser can't run MotionLab Studio …
Please use a current version of Chrome, Edge, Firefox, or Safari 15.4+"
(`src/main.tsx:124–130`). Everything else — recording, MIDI, storage — is
documented in that comment as degrading "feature-by-feature with in-app
messaging instead."

**Gap:** `DIVERGENT-BY-DESIGN` — a web app's requirement surface is the browser
engine, not the OS. The equivalent workflow (tell the user before they lose work
that this machine cannot run the product) exists and is stricter than the
reference's, which only warns after install.

## SR-2 · Internet connection required for install and activation

**FSP8 does:** "Internet connection (needed for installation and activation)".
Licence enforcement lives outside this chapter but is referenced: a subscription
licence requires the computer to be online once every 30 days; a perpetual
licence once a year (extract lines 749–758, cross-chapter).

**MotionLab does:** No licensing or activation of any kind. Deployed to
Cloudflare Workers; the service worker registers for offline operation
(`displayMode()` and `swStatus()` in `src/diagnostics/report.ts:32–45`), and the
diagnostics report carries an `Online` field (`src/diagnostics/report.ts:265`).
Grepped `activation|licen[cs]e|entitlement` — no hits in `src/`.

**Gap:** `DIVERGENT-BY-DESIGN` — the app is delivered, not installed. Note this is
a _product-model_ divergence and not a feature gap to close.

## SR-3 · Display and touch requirements

**FSP8 does:** "Monitor with 1280 x 768 resolution (high-dpi / Retina monitor
recommended)"; "Multi-touch enabled monitor with TUIO support is required for
touch operation."

**MotionLab does:** No stated minimum resolution. Three responsive shells exist —
`src/components/shell/PhoneLayout.tsx`, `TabletLayout.tsx`, `DesktopLayout.tsx` —
so the layout adapts rather than demanding a floor. Viewport and DPR are recorded
in diagnostics as `${vw}×${vh} @${devicePixelRatio}x`
(`src/diagnostics/report.ts:264`). Touch is native pointer-event handling, not
TUIO; grepped `TUIO` — absent.

**Gap:** `DIVERGENT-BY-DESIGN` — a browser DAW that reflows cannot have a
resolution floor in the same sense, and TUIO is an external protocol with no
browser binding. Touch operation itself is present and is a first-class layout.

## SR-4 · Content storage minimums

**FSP8 does:** "8 GB RAM minimum" and "40 GB free hard drive space (Fender
Studio Pro)", stated under _Content storage_.

**MotionLab does:** Storage is IndexedDB, not a disk allocation. The product asks
the browser rather than the OS: `storageEstimate()` in
`src/persistence/mediaStore.ts:137–142` returns `{usage, quota}` from
`navigator.storage.estimate()`, surfaced in the diagnostics sheet as
`Storage used` (`src/diagnostics/report.ts:173`). Quota exhaustion is handled at
write time, not prevented at install time: `src/persistence/mediaStore.ts:51–52`
logs `Storage quota exceeded while writing …` and
`src/persistence/projectRepo.ts:931–932` logs `Storage quota exceeded while
saving "<name>" — project NOT saved`. No RAM check exists.

**Gap:** `DIVERGENT-BY-DESIGN` for the mechanism (a browser cannot reserve disk),
but the _reporting_ is present and arguably better — the user sees live usage
against quota rather than a one-time install figure.

---

# 2. Set Up Your Audio Device

_(FSP8 manual pp. 13–17; extract lines 798–1015)_

## AD-1 · Automatic device selection at first run — **P0**

**FSP8 does:** "Fender Studio Pro automatically selects an audio device to use for
audio input and output, pulling from a list of devices currently installed on your
computer. If you have a Fender audio interface or PreSonus mixer, it is selected
automatically." (extract lines 793–795.) The list is populated from the OS driver
enumeration (ASIO/WASAPI on Windows, Core Audio on macOS).

**MotionLab does:** There is no application-wide device choice at all. Output is
whatever `AudioContext`'s `destination` resolves to — see
`src/audio/engine.ts:290`, `new AudioContext({ latencyHint: 'interactive' })`,
with the master chain terminating at `ctx.destination`
(`src/audio/engine.ts:~372`). Input is _per-track_, not global: each audio track
carries `inputDeviceId?: string` (`src/model/types.ts:181`) defaulting to the
literal `'default'` (`DEFAULT_INPUT` in `src/audio/inputManager.ts:31`). The
input list is populated by `AudioInputManager.refreshDevices()`
(`src/audio/inputManager.ts:114–133`) via `navigator.mediaDevices
.enumerateDevices()`, filtered to `kind === 'audioinput'`. Preferred-device
recognition (auto-select a known interface) does not exist; grepped
`preferredDevice|autoSelect|preferDevice` — no hits.

**Gap:** `PARTIAL`. Input enumeration exists and is honest; there is no _global_
device concept, no output-side selection, and no first-run auto-selection.

## AD-2 · Where the setting lives — **P0**

**FSP8 does:** Windows: `Studio Pro / Options / Audio Setup / Audio Device`.
macOS: `Preferences / Audio Setup / Audio Device`. One dedicated settings window
grouping every device decision.

**MotionLab does:** The Preferences sheet
(`src/components/settings/SettingsSheet.tsx`, opened via `uiStore.settingsOpen`)
has an **Audio** section containing exactly two rows: a read-only _Engine_ row
showing the context sample rate with the hint "Sample rate is chosen by the
browser", and a _Workspace_ row with a "Reset panel layout" button. **Device
selection is not in Preferences.** It lives in `TrackInputControls`
(`src/components/recording/RecordControls.tsx:172–204`) — a per-track `<select>`
labelled "Device" in the inspector/record workspace.

**Gap:** `PARTIAL` — the setting exists but is in a structurally different place
(per-track inspector, not a global device dialog). This is the single most
visible information-architecture divergence in the chapter.

## AD-3 · Separate playback and recording device on macOS — **P0**

**FSP8 does:** On macOS the dialog has **two** menus: _Playback Device_ and
_Recording Device_, selected independently. On Windows a **single** _Audio Device_
menu covers both, because the ASIO/WASAPI driver model binds them.

**MotionLab does:** Only a recording (input) device is selectable. Grepped
`setSinkId`, `sinkId`, `audiooutput`, `selectAudioOutput`, `output device`,
`playback device` across `src/`, `tests/` and `e2e/` — **zero hits**. There is no
`AudioContext` `sinkId` assignment, no `HTMLMediaElement.setSinkId()` call, and
no `navigator.mediaDevices.selectAudioOutput()` call. Output goes to the system
default and cannot be changed from inside the app.

**Gap:** `MISSING`. Output device selection is implementable in Chromium today
(`AudioContext({sinkId})` / `setSinkId`) and degrades cleanly elsewhere, so this
is not a platform ceiling — it is unbuilt. **P0.**

## AD-4 · Device Control Panel button

**FSP8 does:** "you can click on the [Control Panel] button next to the device
selection drop-down menu and make your changes within the device's control panel.
If your device does not offer these options, the Control Panel button is grayed
out." The grey-out is the documented behaviour when the driver exposes no panel.

**MotionLab does:** Absent. Grepped `control panel|controlPanel|openDriver` — no
hits. A browser cannot open a native driver control panel.

**Gap:** `DIVERGENT-BY-DESIGN` — no browser API reaches a device driver's own UI.
The workflow it serves (per-device gain/routing/clock configuration) has to be
handled OS-side by the user, outside the app.

## AD-5 · Device Buffer Size — **P0**

**FSP8 does:** A _Device Buffer Size_ control in the Audio Device window. "Lower
settings minimize latency, which is useful when tracking. Higher settings bring
more latency, but give you additional processing power for effects and instrument
plug-ins. Generally, you want to pick the lowest Buffer Size that still lets your
system perform correctly." No enumerated list of sizes is given in this chapter;
the values come from the driver. The setting reconfigures the driver rather than
requiring an app restart.

**MotionLab does:** Absent as a user control. The only lever is the fixed
`latencyHint: 'interactive'` passed at context construction
(`src/audio/engine.ts:290`) — a hint, not a size, and not user-editable.
`AudioContext.baseLatency` and `outputLatency` are never read (grepped
`baseLatency|outputLatency` — no hits), so the current buffer is not even
_reported_. Grepped `buffersize|buffer size|blocksize|block size` across `src/`:
the only hits are inside the FLAC encoder (`src/audio/encode/flac.ts`), which is
unrelated file-format blocking.

**Gap:** The Web Audio API genuinely does not expose a settable device buffer —
`latencyHint` accepts `'interactive' | 'balanced' | 'playback'` or a seconds
value, which is a coarse three-way at best. Classify the settable size as
`DIVERGENT-BY-DESIGN`; classify **the missing latency readout** as `MISSING` and
**P0**, because AD-6 depends on it.

## AD-6 · Latency, sample rate and bit depth readout — **P0**

**FSP8 does:** "When the aforementioned settings are selected, your system's
current total input and output latency, sample rate, and bit depth are reported
below the Audio Setup menus." Three live figures, in the same window as the
controls that change them.

**MotionLab does:** Sample rate only, and in two places. The Preferences _Audio_
section shows `${(engine.context.sampleRate/1000).toFixed(1)} kHz` or "not
started". The diagnostics report carries `Sample rate` as `${t.sampleRate} Hz`
(`src/diagnostics/report.ts:277`) alongside `AudioContext` state
(`report.ts:273`). **Latency is never displayed** — neither round-trip input
latency nor output latency. **Bit depth is never displayed**, because the Web
Audio graph is float32 throughout and the device depth is not exposed.

**Gap:** `PARTIAL`. Sample rate: `PARITY`. Latency readout: `MISSING` and **P0** —
`AudioContext.baseLatency + outputLatency` is directly available and would give a
truthful output-latency figure today. Bit depth: `DIVERGENT-BY-DESIGN` (the
browser never tells the page the device's converter depth).

## AD-7 · Release Audio Device in Background (Windows only)

**FSP8 does:** "Release Audio Device in Background (Windows only) is disabled by
default. When engaged, the current audio device is made available to other
applications when Fender Studio Pro is minimized."

**MotionLab does:** No preference, but the _behaviour_ is implemented
unconditionally for **input**: `src/audio/inputManager.ts:305–311` installs a
`visibilitychange` listener that calls `audioInput.stopAll()` when the document
hides — but only when `recordingActive` is false. The comment states the reason:
"Releasing on hide prevents a stuck recording indicator when a phone locks."
There is no equivalent for output; the `AudioContext` is left running (and
`reflectContextState()` at `src/audio/engine.ts:~425` handles the browser
suspending it, with one automatic resume attempt and a 250 ms fallback that stops
the transport).

**Gap:** `PARTIAL` — the input half is hard-wired ON where FSP8 defaults it OFF
and makes it a choice. There is no toggle either way, and no output-side release.

## AD-8 · Import/Export Device Configurations — **P0**

**FSP8 does:** "If you have already created a device configuration on a different
setup, you can import that configuration into Fender Studio Pro. You can also
export your device configuration … Those features are available on the Session
Setup page and are described in the Audio Device Input/Output Setup section."
Full behaviour is documented in IO-9 below.

**MotionLab does:** Absent. Grepped `ioconfig|I/O config|ioConfig` — no hits.

**Gap:** `MISSING`. See IO-9.

## AD-9 · Audio Dropout Protection / Process Buffer Size

**FSP8 does:** A _Dropout Protection_ drop-down at `Studio Pro / Options / Audio
Setup / Processing` (macOS `Preferences / Audio Setup / Processing`), with an
"Off" position and named levels. Its selection determines the **Process Buffer
Size**, displayed beside it. The architecture: "the tasks of audio playback and
monitoring of audio inputs and virtual instruments are handled as separate
processes … lets you use a large processing buffer to handle heavy audio playback
and effects processing tasks, while keeping latency low for audio input and
virtual instrument monitoring." Setting it to Off "allows for the lowest latency
possible at the risk of introducing dropouts when this setting is combined with
very small Buffer Size settings." Higher levels can affect meter/display
responsiveness even when they do not affect audible latency.

**MotionLab does:** Absent. Grepped `dropout protection|dropoutProtection` — no
hits. There is one render thread (the browser's audio thread) and no split
process/device buffer.

**Gap:** `DIVERGENT-BY-DESIGN` — the two-buffer architecture requires owning both
the driver callback and a separate processing graph, which a page cannot do. The
_user-visible goal_ (trade latency for headroom) has no equivalent lever at all,
which is worth recording as a follow-on for the WASM core era.

## AD-10 · Native Low-Latency Monitoring

**FSP8 does:** Monitoring runs on the small device buffer while playback runs on
the large process buffer. Availability condition, quoted: "As long as the Process
Buffer Size is larger than the Device Buffer Size you've specified, you have the
option to use Native Low-Latency Monitoring." Instrument monitoring is a separate
toggle: _"Enable low latency monitoring for instruments"_ — "If you run into
performance issues when using a virtual instrument with particularly high CPU
usage, you may want to disable this option."

**MotionLab does:** Monitoring exists and is per-track:
`engine.startMonitoring(trackId, deviceId)` / `engine.stopMonitoring(trackId)`,
driven from `TrackInputControls`'s _Monitor_ button
(`src/components/recording/RecordControls.tsx:132–158`) and from
`src/app/monitorActions.ts:51`. It routes the `MediaStreamAudioSourceNode`
through the track's own channel — same inserts, same fader — so it is a
"standard software monitoring" path in FSP8's taxonomy. There is no low-latency
variant, no separate buffer, and no instrument-monitoring toggle. On enabling,
the app toasts "Monitoring on — use headphones to avoid feedback into the
microphone."

**Gap:** `PARTIAL` — monitoring works, one mode only, at whatever latency the
browser gives.

## AD-11 · Insert-FX behaviour under low-latency monitoring (3 ms rule)

**FSP8 does:** "any inserted FX on the corresponding Channel continues to function
and can be heard in real time, **provided that they add 3 ms or less of
latency**. Plug-ins that meet this latency requirement show a green power button
in the Console (rather than blue or gray). Any inserted plug-ins that introduce
more than 3 ms of latency are not audible in the monitoring path while a Channel
is armed for monitoring or recording … They begin functioning again when
recording/monitoring mode is disengaged." Three plug-in classes are _never_
supported on such channels: external-effect insert routing, analyzer plug-ins,
and FX Chains containing Splitter devices.

**MotionLab does:** No latency-tiered monitoring path, so no 3 ms rule and no
green/blue/grey power-button state. **But the underlying measurement exists and
is unusually rigorous**: `src/audio/latencyProbe.ts` renders an impulse through
each insert against a dry wire in an `OfflineAudioContext` and returns
`measuredSamples` vs the node's own `declaredSamples`
(`measureInsertLatency()`, `latencyProbe.ts:88–119`). Every insert can therefore
already state its delay. Nothing consumes that number for a monitoring decision.

**Gap:** `MISSING` for the behaviour; the _data_ to implement a 3 ms tier is
already in the codebase, which makes this cheaper than it looks.

## AD-12 · Monitoring Latencies table

**FSP8 does:** A _Monitoring Latencies_ display with two columns — "Standard" and
"Low Latency" — showing round-trip audio-input latency and virtual-instrument
latency for the current Device Buffer Size and Dropout Protection settings.

**MotionLab does:** Absent — no latency figure of any kind is displayed anywhere.
Grepped `round.?trip|latency` in `src/components/` — the only hits are inside
effect parameter names (e.g. limiter lookahead).

**Gap:** `MISSING`. **P0** as the display half of AD-6.

## AD-13 · Hardware (DSP) Direct Monitoring and the "D" button

**FSP8 does:** With a supported DSP-enabled interface, monitoring may run on the
interface's own DSP. The choice is a checkbox: _"Use native low latency
monitoring instead of onboard DSP"_ — enabled = native, disabled = hardware. When
hardware monitoring is used, "Insert FX do not function on the related Channel,
since the audio input is being monitored before it reaches Fender Studio Pro."
In the Console, Direct Monitoring is toggled per output by an **Enable Direct
Monitoring** button labelled "D", below the volume fader of the Main output and
of every Cue Mix output. Colour is the state: dark = disabled, **green** = native
direct monitoring, **blue** = hardware direct monitoring.

**MotionLab does:** Absent in every part. No hardware-DSP concept, no "D" button,
no per-output monitoring toggle. Cue mixes exist as a data structure
(`CueMix` at `src/model/types.ts:377–386`, with `id`, `name`, `level`, `sends`,
`ignoreSolo`) and `uiStore.monitorCueId` selects one for monitoring, but they are
software balances, not hardware outputs.

**Gap:** `DIVERGENT-BY-DESIGN` for the hardware-DSP half (no browser access to
interface DSP). `MISSING` for the per-output monitoring enable, which is a
software affordance MotionLab could have.

## AD-14 · Monitoring Mode Attributes table

**FSP8 does:** A four-row table naming every monitoring mode and its conditions:

| Mode                                 | Direct Input | Necessary conditions                                                                      | Monitoring           | Insert FX                                | Send FX      |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------- | ------------ |
| Standard Software Monitoring         | Disabled     | Large Device Buffer Size, low Process Buffer Size (Dropout Protection)                    | Standard latency     | All function                             | All function |
| Native Direct Monitoring             | Enabled      | Process Buffer Size must exceed Device Buffer Size                                        | Native low-latency   | ≤3 ms plug-ins function, others disabled | All function |
| Virtual Instrument Direct Monitoring | Enabled      | Process Buffer Size must exceed Device Buffer Size                                        | Native low-latency   | ≤3 ms plug-ins function, others disabled | All function |
| Hardware Direct Monitoring           | Enabled      | "Use Native Direct Monitoring instead of Hardware Direct Monitoring" must be **disabled** | Hardware low-latency | No Insert FX function                    | All function |

**MotionLab does:** Exactly one of these four modes exists — Standard Software
Monitoring — and it is unnamed in the UI.

**Gap:** `PARTIAL` (1 of 4 modes).

## AD-15 · Process Precision

**FSP8 does:** "By default, Fender Studio Pro's process precision is set at Single
(32-bit). You may choose double precision (64-bit) from the Process Precision
drop-down menu."

**MotionLab does:** Absent as a control. Web Audio is float32 (single) throughout
and there is no double-precision graph to switch to. Grepped
`processPrecision|double precision` — no hits.

**Gap:** `DIVERGENT-BY-DESIGN` — the browser's audio graph has one precision.

## AD-16 · Supported drivers and WASAPI Exclusive/Shared

**FSP8 does:** "supports most audio devices, including those that run on ASIO or
WASAPI (Windows) or Core Audio (macOS) drivers." For WASAPI: "Shared mode is the
default setting. In Exclusive mode lower latency can be achieved, but other
applications (such as Windows Media Player) cannot use the audio device at the
same time." Configuration is delegated to the OS: "navigate to Windows Control
Panel/Hardware and Sound/Sound to configure the options for your WASAPI device."

**MotionLab does:** No driver model is visible. The nearest observable behaviour
is the `NotReadableError` branch of `describeGumError()`
(`src/audio/inputManager.ts:~285`), which reports "The audio input is in use by
another application." — the same _symptom_ a foreign exclusive-mode grab
produces, correctly explained.

**Gap:** `DIVERGENT-BY-DESIGN`. Driver selection is not reachable from a page;
the failure mode is at least named honestly.

## AD-17 · Use efficiency cores for audio processing

**FSP8 does:** "Enabling the 'Use efficiency cores' option overrides the macOS
system settings and allows efficiency cores of a Apple Silicon (ARM) processor to
be used for processing audio."

**MotionLab does:** Absent; no thread-affinity control is reachable from a page.

**Gap:** `DIVERGENT-BY-DESIGN`.

## AD-18 · Performance Monitor

**FSP8 does:** Opened from the _View_ menu or the **[Performance]** button in the
Transport. Displays "the current relative overall CPU and disk performance, as
well as the performance of instruments and automation." Guidance: "When these
meters approach or reach the top of their range, you may need to consider
altering your audio device settings … it is common to lower the Device and/or
Internal Buffer Size while recording to keep monitoring latency low but then to
increase Buffer Size while mixing."

**MotionLab does:** No CPU/disk meter. The diagnostics sheet
(`src/components/diagnostics/DiagnosticsPanel.tsx`, report built by
`src/diagnostics/report.ts`) reports structural counts rather than load:
`Active audio sources`, `Insert effects`, `Active sends`, `Audio graph`,
`Decoded buffers`, `Storage used`, `Open input streams`, `Monitoring`. Grepped
`cpu|performance meter|Performance` in `src/components/` — no load meter.

**Gap:** `MISSING`. A browser cannot read process CPU, but `AudioContext`
render-quantum overrun/underrun is observable in practice (dropout counting via
`AudioWorklet` timing) and glitch reporting is a real workflow need while
tracking.

## AD-19 · Third-party plug-in multiprocessing advice

**FSP8 does:** "If any playback issues are encountered with third-party virtual
instrument or effect plug-ins that have their own multiprocessor support
implementation … it is recommended that this support be disabled in the plug-ins.
In this case, Fender Studio Pro manages all processor scheduling."

**MotionLab does:** N/A — plug-ins are WAM modules (`src/audio/wam/`) running on
the browser's single audio thread; there is no competing scheduler.

**Gap:** `DIVERGENT-BY-DESIGN`.

---

# 3. Audio Device Input/Output Setup — **the P0 section**

_(FSP8 manual pp. 18–19; extract lines 1017–1073)_

This is the section the directive flags as the single most important. It is
reproduced here in more detail than the rest, with the manual's own wording where
the wording carries the behaviour.

## IO-1 · The software-I/O layer itself — **P0**

**FSP8 does:** Interposes a named, portable indirection between hardware channels
and tracks. Quoted in full because the design intent is the behaviour:

> "In most recording applications, audio tracks are directly correlated to the
> channels of your hardware audio device. In Fender Studio Pro, there is a layer
> of software I/O (input and output) channels between your hardware audio device
> channels and your Tracks."

The portability payoff, quoted:

> "let's say you produce a song in your studio using a multi-channel interface,
> then take your Session file to your friend's studio, where you use a different
> audio interface. Simply connect your friend's hardware audio device channels to
> the correct software I/O channels. When you get back to your studio, the
> original I/O configuration for the Session is automatically loaded for you, as
> if you never left."

And the storage rule, quoted:

> "Fender Studio Pro stores I/O configurations with your Session, **per computer
> and per audio device driver**, ensuring that your Session remains highly
> portable and is never 'broken' by changing audio devices."

**MotionLab does:** **No software-I/O layer exists.** A track's input is a raw
device id string — `Track.inputDeviceId?: string` (`src/model/types.ts:181`),
documented in the model as "audio tracks: selected input device id, or 'default'".
That string is the browser's opaque `MediaDeviceInfo.deviceId`, taken straight
from `enumerateDevices()` (`src/audio/inputManager.ts:118–125`). It is persisted
into the project by `projectRepo` — `src/persistence/projectRepo.ts:383–384`
validates only that it is a string and drops it otherwise. There is no named
channel, no per-device configuration record, and no per-machine keying.

Consequence, concretely: a browser `deviceId` is **origin-scoped and rotates when
site data is cleared**, and is different on every machine. So a project saved on
one machine and opened on another carries a device id that resolves to nothing.
The failure is silent at load and shows up as a track whose Device select falls
back to "Default input" without saying so.

**Gap:** `MISSING`. **The single largest gap in this chapter.** The named-channel
indirection is a pure software construct with no platform dependency: MotionLab
could hold a per-project list of named input buses, each mapping to a device id
_per machine_, and the whole portability story would follow.

## IO-2 · Where the setup lives, and its per-Session scope — **P0**

**FSP8 does:** `Session / Session Setup / Audio I/O Setup`. Reachable also with
`[Ctrl]/[Cmd]+,` to the Options/Preferences page, then the **Session Setup**
button at the bottom of the page and the **Audio I/O Setup** menu at the top.
Quoted: "The configuration of the Audio I/O Setup is done **within each
Session**, so that it is possible for each Session to have a separate I/O setup."

**MotionLab does:** No such page. Grepped `Session Setup|SessionSetup|Audio I/O`
in `src/components/` and `src/pages/` — no hits. The four pages are
`StartPage.tsx`, `SongPage.tsx`, `MasteringPage.tsx`, `ShowPage.tsx`; none has an
I/O tab. Device choice is per-track, and _is_ stored per project (in `Track`), so
the "per-session" half accidentally holds — but only as a side effect of storing
the raw device id on the track.

**Gap:** `MISSING`.

## IO-3 · Two tabs, and the Matrix Routing view — **P0**

**FSP8 does:** "In the Audio I/O Setup menu there are two tabs: one for input
configuration and one for output configuration. In each tab a Matrix Routing view
shows the current configuration, with the **vertical columns indicating hardware
audio device channels (hardware I/O)** and the **horizontal rows indicating
created software I/O channels**." Software I/O channels "function as the input
sources and output destinations available to individual Tracks."

**MotionLab does:** Absent. No matrix, no input tab, no output tab, no hardware
channel axis. Grepped `ChannelMerger|ChannelSplitter` — the only uses are internal
stereo processing: `src/audio/analysis.ts:140` (2-way split for metering),
`src/audio/effectChain.ts:1836–1837` and `2250–2251` (stereo effect internals),
and the master meter tap in `src/audio/engine.ts` `buildMasterChain()`. None of
these is a user-facing routing matrix.

**Gap:** `MISSING`.

## IO-4 · Add (Mono) / Add (Stereo) — **P0, quote-critical**

**FSP8 does:** Quoted exactly, because this is the behaviour the directive asks
about:

> "Click on the **[Add (Mono)]** or **[Add (Stereo)]** button to add an Input or
> Output Channel, depending on which tab you are currently viewing. **When a new
> channel is added, the next unassigned hardware inputs or outputs are assigned to
> the new channel by default.**"

So: mono vs stereo is chosen at creation time by which of two buttons is pressed,
the tab decides whether it is an input or an output, and hardware assignment is
automatic and greedy — the next _unassigned_ hardware channels.

**MotionLab does:** There is no channel-creation act at all. A track's input is
implicitly whatever the chosen device delivers, and the manager **forces mono**.
`src/audio/inputManager.ts:33–38` declares a module-level `CONSTRAINTS` of type
`MediaTrackConstraints` with `echoCancellation: false`, `noiseSuppression: false`,
`autoGainControl: false`, and `channelCount: { ideal: 1 }`.

`channelCount: { ideal: 1 }` is a _preference_, not a demand, so a stereo
interface may still deliver two channels — but nothing downstream chooses, names
or splits them. There is no stereo-input concept, and no way to make a mono input
from the right channel of a stereo pair.

The comment on `CONSTRAINTS` explains the three `false` flags — "Recording/
monitoring want raw signal, not voice-call processing" — which is correct and
worth preserving; the `channelCount` line carries no such rationale.

**Gap:** `MISSING`. **P0.** Mono/stereo input channel creation is the specific
thing the directive names, and it does not exist in any form.

## IO-5 · Add… (multichannel dialog) — **P0**

**FSP8 does:** A separate **[Add…]** button opens a dialog with four fields:

- **Label** — the channel's name.
- **Format** — the channel format, from the multichannel options. "Fender Studio
  Pro supports multichannel input formats **up to 9.1.6**."
- **Color** — a colour for the channel.
- **Number** — "Use the Number option to create many Inputs or Outputs at once.
  … If you are adding more than one channel the names will increment
  automatically (Name, Name+1, etc.)."

Then **OK** creates them and they are added to the configuration.

**MotionLab does:** Absent entirely. No label, no format, no colour, no bulk
creation. Track colours exist (`TRACK_COLORS` in `src/model/types.ts`) but belong
to tracks, not to I/O channels. Maximum channel count anywhere in the app is
stereo, except the FLAC encoder which accepts up to 8
(`src/audio/encode/index.ts:128–130`, "FLAC carries at most 8 channels").

**Gap:** `MISSING`.

## IO-6 · Per-channel format drop-down and channel dragging — **P0**

**FSP8 does:** "You can also use the drop-down field to the right of an Input
source or Output destination to choose the desired format, then **drag the
individual channels ( L, C, R, etc.) to the desired interface Input or Output
assignments**." So a channel's format is editable after creation, and each
constituent leg is individually re-assignable by drag.

**MotionLab does:** Absent.

**Gap:** `MISSING`.

## IO-7 · Remove, Rename, Apply, Reset to Default — **P0**

**FSP8 does:** Four operations, quoted:

- Remove: "click on the channel to select it and then click the **[Remove]**
  button."
- Rename: "**double-click** on the name of the channel, type a new name, and press
  **Enter**."
- Apply: "in order for these software I/O changes to occur, be sure to click
  **[Apply]** before exiting this menu." — changes are staged, not live.
- Reset: "If you decide you want to start over with the original configuration for
  your device, click **[Reset to Default]**."

**MotionLab does:** No channels to remove, rename, apply or reset. Device changes
in `TrackInputControls` are applied **immediately and live** — the `onChange`
handler at `src/components/recording/RecordControls.tsx:189–199` stops monitoring,
writes `inputDeviceId`, and restarts monitoring on the new device in the same
tick. There is no staged/Apply model anywhere in the app's device path.

**Gap:** `MISSING` for the channel operations; the live-vs-staged difference is
itself a `DIVERGENT-BY-DESIGN` note — a page with one device and no matrix has
nothing to stage.

## IO-8 · The default I/O configuration — **P0, quote-critical**

**FSP8 does:** Quoted exactly, because these are the names and counts:

> "By default, Fender Studio Pro creates **three Input Channels: one stereo and
> two mono**. These channels are labeled **Input L+R (stereo)**, **Input L
> (mono)**, and **Input R (mono)**. By default, the stereo Input Channel receives
> input from the first stereo hardware input pair of your selected audio device.
> **The two mono Channels receive input from the same stereo hardware input
> pair.**"

And for output:

> "The Output Channel is labeled **Main Out (stereo)** and is routed by default to
> the first stereo hardware output pair of your selected audio device."

Note the overlap: the two mono channels are _not_ exclusive with the stereo one —
all three read the same hardware pair, so a user can record L alone, R alone, or
the pair, without reconfiguring.

Routing marks, quoted: "A colored square appears with an **M**, **L**, or **R**
label, indicating whether the route is a mono route (M) or the left or right side
of a stereo route (L or R)."

**MotionLab does:** Absent. A track has one device and no channel legs. There is
no "Input L", no "Input R", no "Input L+R", and no "Main Out". The master output
is a node chain terminating at `ctx.destination` and is never named as a routable
channel. Related but different: a track can be summed to mono _after_ input via
`Track.monoSum?: boolean` ("sum the channel to mono at the input") and
polarity-flipped via `phaseInvert?: boolean` — these are channel processing, not
channel _mapping_.

**Gap:** `MISSING`. **P0.** The three-input default is the concrete shape a
MotionLab equivalent should copy: a generic "Input Bus" list, pre-populated with
one stereo bus and two mono buses reading the same device, is the minimum viable
parity target.

## IO-9 · Import / Export device I/O configurations — **P0**

**FSP8 does:** Two access paths: `Session / Session Setup`, or `[Ctrl]/[Cmd]+,`
→ Session Setup button (bottom of page) → Audio I/O Setup menu (top). The
Import/Export buttons sit on the **lower right** of the page.

- **Import:** "click Import, navigate to the location of the file, and click
  Open. **The I/O configuration will replace your current one** then."
- **Drag-and-drop import behaves differently and the manual says so:** "You can
  also simply drag-and-drop the device configuration file onto the Audio I/O Setup
  window. **Then the I/O setup will be added to your current configuration.**"
  (Replace vs. add — the same file, two different merge semantics depending on how
  it arrives.)
- **Apply is still required:** "Be sure to click **[Apply]** to confirm the
  configuration change before you exit the menu."
- **Export:** "click the Export button. The default location for the file is
  `Documents\Studio Pro\IO Configurations` … Click the Save button and the file
  will be exported with the extension **`.ioconfig`**. You will only need to do
  this once; **the `.ioconfig` file contains the data for both the Input and
  Output tabs**."

**MotionLab does:** Absent. Grepped `ioconfig|I/O config|ioConfig` — no hits. The
app does have file import/export machinery (`src/app/exportActions.ts`,
`src/audio/importAudio.ts`, drag-and-drop onto the arrangement) so the plumbing
exists; there is simply no I/O configuration object to carry.

**Gap:** `MISSING`. Note the replace-vs-add distinction: if MotionLab builds this,
copying the two semantics is the detail that will otherwise be got wrong.

## IO-10 · Make Default (default device I/O setup)

**FSP8 does:** "We recommend that you create a default Audio I/O Setup that can be
a starting point for all new Sessions." Procedure: create and name the software
I/O channels, then "click on the **[Make Default]** button in the Audio I/O Setup
menu, and a pop-up window appears to confirm that you wish to make the current I/O
setup the default for new Sessions. Click Yes, and from that point forward all new
Sessions are created with this audio I/O setup." `[Reset to Default]` re-applies
it to an existing Session.

**MotionLab does:** Absent for I/O. The closest analogue is the template system:
`TEMPLATES` in `src/model/templates.ts` ships starting sessions (`empty`,
`songwriter`, `band`, `electronic`, `podcast`, …) each carrying `bpm`, `timeSig`
and a `tracks[]` list with names, colours, presets, inserts, sends and arm state.
Templates are pure data with a builder and are explicitly documented as never
touching the store or the engine. But a template carries **no input assignment** —
`TemplateTrack` (`src/model/templates.ts:24–36`) has `name`, `type`, `color`,
`preset`, `output`, `armed`, `inserts`, `sendTo`, `folder`, and no input field.

**Gap:** `MISSING` for I/O defaults; `PARTIAL` for "new sessions start
pre-configured", which templates do better than the reference in every respect
_except_ I/O.

## IO-11 · Meters beside the software I/O channels

**FSP8 does:** "When making new routes in the Audio I/O Setup menu, notice the
meters to the left of the software I/O channels. By displaying signal levels on
each channel, these meters help you ensure that the appropriate routings have been
made." — the meter is a routing-verification tool, not a mixing tool.

**MotionLab does:** There _is_ an input meter, but it is per-track and only live
while monitoring: `InputMeter` (`src/components/recording/RecordControls.tsx:17–39`)
subscribes to `engine.onFrame` and scales a fill bar from
`engine.inputLevel(trackId)`, with a `data-hot` flag above 0.92. It is rendered
with `trackId` passed only when the track is monitoring — i.e. **it shows nothing
unless the track is actively monitoring**. There is no always-on per-input meter
for verification before routing.

**Gap:** `PARTIAL` — the meter exists and is driven from the same evaluation the
audio uses (house rule satisfied), but it is gated on monitoring and there is no
channel list to meter.

## IO-12 · Routing changes mid-production

**FSP8 does:** "While it is uncommon for Audio I/O Setup changes to be required in
the middle of production, the audio I/O routing can be changed at any time.
However, you should be aware that routing changes affect all associated Tracks,
possibly switching inputs for audio Tracks, changing the hardware output for the
Main Output, and so on."

**MotionLab does:** Device changes are per-track and take effect immediately
(IO-7), so there is no cross-track consequence to warn about — because there is no
shared channel to change.

**Gap:** `DIVERGENT-BY-DESIGN` (consequence of IO-1 being absent).

## IO-13 · Audition Channel

**FSP8 does:** "The Preview Player in the Browser and in the Import File menu uses
the **Audition channel** for audio playback. **Any stereo Output Channel** can be
used as the Audition channel, allowing you to audition sounds from an output other
than your main output."

**MotionLab does:** The Browser has preview/audition playback
(`src/components/browser/`), but it plays through the same single destination as
everything else — there is no separate audition output, because there is no output
channel list. Grepped `audition` in `src/` — no hits under that name.

**Gap:** `MISSING`. Depends on AD-3 (output device selection) to be meaningful.

## IO-14 · What happens when a device disappears — **P0**

**FSP8 does:** Not documented explicitly for _audio_ devices in this chapter. The
manual's device-loss story is told for **MIDI** devices (see MD-11) and for the
portability case (IO-1), where a Session opened against a different interface
resolves through the software I/O layer rather than breaking.

**MotionLab does:** This is the one P0 area where MotionLab is **at or ahead of
parity**, and it deserves the detail. Three independent mechanisms:

1. **Hot-plug re-enumeration.** `attachDeviceListener()`
   (`src/audio/inputManager.ts:135–155`) attaches a single `devicechange`
   listener on `navigator.mediaDevices`, logs "Audio input devices changed",
   re-enumerates, and then — the important part — walks every held lease and
   releases any whose device id is no longer present:
   `Input device "<id>" disappeared — releasing its stream`. The `DEFAULT_INPUT`
   lease is deliberately exempt, because "default" always resolves.
2. **Track-ended handling.** Every acquired `MediaStreamTrack` gets an `ended`
   listener (`src/audio/inputManager.ts:~182`) that hard-releases the lease and
   logs `Input track ended unexpectedly (<label>)`. The comment gives the reason:
   "A track ending (unplugged, taken by another app) must not linger."
3. **Named failure text.** `describeGumError()`
   (`src/audio/inputManager.ts:~275–295`) maps every `DOMException` name to a
   sentence a musician can act on — `NotAllowedError` → "Microphone access was
   blocked. Allow it in your browser site settings."; `SecurityError` → "requires
   a secure (https) connection."; `NotFoundError` → "No audio input device was
   found."; `NotReadableError` → "The audio input is in use by another
   application."; `OverconstrainedError` → "The selected input device is no
   longer available."; `AbortError` → "Opening the audio input was aborted."

What is _not_ handled: a track whose saved `inputDeviceId` no longer exists shows
the stored id in the `<select>` with no matching option, which renders as a
blank/first selection rather than an explicit "this device is gone" state. The
select is built from the enumerated devices minus `DEFAULT_INPUT`, plus a
hardcoded `Default input` option (`RecordControls.tsx:180–188`) — a stale id
simply is not in the list.

**Gap:** `PARITY` for live disappearance (arguably better than the reference,
which documents no audio-side behaviour). `PARTIAL` for the stale-saved-id case:
the app should surface "the input this track was recorded with is not present"
rather than silently showing an unmatched value. **This is a P0 sub-item.**

---

# 4. Set Up Your MIDI Devices

_(FSP8 manual pp. 20–24; extract lines 1075–1240)_

## MD-1 · External Devices as one concept

**FSP8 does:** "All MIDI-capable hardware devices are collectively referred to as
**External Devices**. There are three types of External Devices: **Keyboards**,
**Instruments**, and **Control Surfaces**. While each device type functions in a
slightly different way, there is **one menu** to add and configure any External
Device." Path: `Studio Pro / Options / External Devices / Add Device`
(macOS `Preferences / External Devices / Add Device`).

**MotionLab does:** One device type only — a MIDI _input_. `MidiManager`
(`src/audio/midi.ts:88–224`) enumerates `access.inputs` and nothing else. There
is no persisted device record, no manufacturer/name fields, and no device list;
the selection is transient session state (`transportStore.midiSelectedId`).

**Gap:** `PARTIAL` — one of three device classes, with no device configuration
object behind it.

## MD-2 · Where MIDI setup lives, and how it is reached

**FSP8 does:** `Studio Pro / Options / External Devices` (macOS `Preferences /
External Devices`), with an **[Add…]** button. Also: "Click on the '+' button in
the External window of the Console to quickly set up a new Keyboard or other
External Device."

**MotionLab does:** MIDI setup is **not in Preferences**. It lives in the
instrument panel: `MidiSection` inside
`src/components/synth/SynthPanel.tsx:213–259`, rendered as an
`InstrumentSection` titled "MIDI in". `SettingsSheet.tsx` has no MIDI section at
all.

**Gap:** `PARTIAL` — placement diverges the same way AD-2 does: the setting is
where the work is, not in a device dialog.

## MD-3 · Enabling MIDI, and unsupported browsers

**FSP8 does:** MIDI is available once a device is added; no permission model.

**MotionLab does:** Web MIDI needs an explicit enable and may not exist at all.
`MidiManager.supported` (`src/audio/midi.ts:89–90`) tests
`navigator.requestMIDIAccess`. When unsupported the panel renders "Web MIDI is not
supported in this browser. The on-screen and computer keyboards still work."
(`SynthPanel.tsx:224–226`). When supported but not enabled, a button "Enable MIDI
input" calls `midi.enable()`, which requests `requestMIDIAccess({ sysex: false })`
— **SysEx is deliberately not requested**, which also means SysEx-based device
protocols are out of reach. Failure logs `MIDI access denied/failed: <msg>` and
leaves `midiEnabled` false.

**Gap:** `DIVERGENT-BY-DESIGN` — the permission gate is a browser requirement, and
the app handles both the absent and the denied case with named states.

## MD-4 · Predefined device list vs. New Keyboard

**FSP8 does:** "Choose your device from the predefined device list or set this to
**New Keyboard** if you do not see your device in the list. If set to New
Keyboard, you may wish to type in a **Manufacturer Name** and a **Device Name** in
the appropriate fields. This makes identifying your Keyboard easier."

**MotionLab does:** Absent. Inputs are listed by `MIDIInput.name`, falling back to
the literal `'MIDI Input'` (`src/audio/midi.ts:122`). No manufacturer field, no
user-editable device name, no predefined device library.

**Gap:** `MISSING`.

## MD-5 · MIDI channel selection and Split Channels — **P0-adjacent**

**FSP8 does:** For a **Keyboard**: "Specify which MIDI channels to use to
communicate with this Keyboard. **All MIDI channels are selected by default.**"
Plus: "Engage **Split Channels** if you would like to create a separate Instrument
Track input for each MIDI channel from the Keyboard."
For an **Instrument**: "Specify which MIDI channels to use … **MIDI Channel 1 is
selected by default.**"

**MotionLab does:** Channel filtering exists and is **per-track, not per-device**.
`Track.midiChannel?: number` (`src/model/types.ts`, "MIDI input channel filter for
instrument tracks (0 = omni)"). `acceptsMidiChannel()` (`src/audio/midi.ts:26–29`)
implements it: `filter === 0 || filter === channel`. The comment records the
convention explicitly and it matters for parity: "Channels are 1..16 here, as they
are on every instrument's front panel — the wire's 0..15 is converted once, at the
message."

Routing is `midiTargetTrackIds()` (`src/audio/midi.ts:48–66`), and its rules are
worth recording because they are a _different_ answer to the same problem Split
Channels solves: **every** armed track accepting the channel receives the note,
not just the first — the comment says layering two instruments under one key is a
technique and a multi-timbral controller on two channels is the whole reason the
filter exists. With nothing armed, the selected track answers; failing that, the
first instrument in the song. Frozen tracks are never targets. When nothing
matches, the note is dropped and the transport says so — the description gains
" — no track listening" plus a one-shot diagnostic warning
(`src/audio/midi.ts:~163–172`), because "a silent keyboard with no explanation is
the worst of the three."

**Gap:** `PARTIAL`. The per-channel filter reaches parity with the channel-select
field and is arguably a cleaner design than Split Channels (no auto-created track
inputs), but it is per-track: there is no device-level channel mask, and no
one-action "give me a track input per channel".

## MD-6 · Receive From / Send To

**FSP8 does:** "Specify the device to which the Keyboard is sending and the device
from which it is receiving via Fender Studio Pro. Select your device driver name
from the drop-down menu for both **Receive From** and **Send To**." For an
External Instrument the same two fields exist, with Send To required and Receive
From optional. The manual also documents the workstation case: an instrument that
is also a controller "needs to be set up twice. First, set it up as an External
Instrument **without a Receive From selection**, and then set it up as a Keyboard,
**without a Send To selection**."

**MotionLab does:** Input only. `MidiManager` never touches `access.outputs` —
grepped `MIDIOutput|midiOutputs|access.outputs` across `src/`: **zero hits**. The
app cannot send MIDI to anything.

**Gap:** `MISSING`. Web MIDI supports outputs; this is unbuilt, not blocked.

## MD-7 · Default Virtual Instrument Input

**FSP8 does:** "You can choose to use this Keyboard as your **Default Virtual
Instrument Input** by checking the appropriate box. If you are using only one
Keyboard with Fender Studio Pro, you should check this box."

**MotionLab does:** Implicit and automatic: `refreshInputs()`
(`src/audio/midi.ts:118–131`) selects the first input when nothing is selected —
`if (!this.selectedId && inputs.length > 0) this.select(inputs[0].id)`. There is
one selected input at a time (`select()` clears `onmidimessage` on all inputs
before assigning to one), so "the default" and "the only one" are the same thing.
The selection is **not persisted** — it is session state on `transportStore`.

**Gap:** `PARTIAL` — the single-keyboard case works with no configuration, which
is the goal; the multi-keyboard case (choose which is default, keep the others
active) is unsupported, and nothing survives a reload.

## MD-8 · MPE

**FSP8 does:** For Keyboards: "Enable **MPE** if your Keyboard is able to transmit
MPE data (MIDI Polyphonic Expression). Use the **Pitch Range** field to specify
the range of the keyboard (the number of keys in chromatic steps). Note that when
the Enable MPE box is checked, the **MIDI Channels and Split Channels fields are
disabled**." Also: "Enable MPE must be active for a virtual instrument if you want
to take advantage of this feature. This is done in the Instrument Editor window."
For Instruments the same, with only the MIDI Channels field disabled.
Cross-referenced caveat (extract 1080–1084): MPE data is subject to Note Data
Reduction, so `Studio Pro / Options / Advanced / Automation / Reduction Level`
must be **0%** to avoid MPE playback differences.

**MotionLab does:** Absent. Grepped `MPE|polyphonic expression` — no hits. Pitch
bend is handled as a single global control source
(`controlSourceOf()`, `src/audio/midi.ts:70–74`, `{ kind: 'pitchbend', channel }`)
and is 14-bit-aware (`controlValueOf()` narrows to 0..127 for bindings), but
per-note channel-rotated expression is not modelled.

**Gap:** `MISSING`.

## MD-9 · External hardware instruments, Aux Channels and the single-track workflow

**FSP8 does:** An External Instrument is "an external MIDI hardware synthesizer,
workstation, or other device that can generate or manipulate sound." Set up
globally, then available in any Session. Its audio returns through one or more
**Aux Channels**: "An Aux Channel allows an external audio source to be monitored
through the Console without the need for an associated track." Procedure:
Console Navigation → **External Devices** tab → menu arrow for the device →
**Edit** → **Outputs** button → **Add Aux Channel** (bottom of window) → repeat
per output → **Save Default** before closing. Once saved the device appears in
Browser / Instruments / **External Instruments**, and dragging it onto an empty
Track "automatically creates the Instrument Track with the AUX channels already
mapped."

Additional documented options for an External Instrument:

- **Send MIDI Clock** and **MIDI Clock Start** checkboxes — "You should send MIDI
  Clock to your Instrument if it has a built-in sequencer or components (such as
  LFOs) that need to sync."
- **Send MIDI Time Code**, with a **Display Offset** set under
  `Session / Session Setup / General` "to correct for time-code variances with
  external devices."
- **CC Automation Interval** slider: "You can vary the value between **10–100 ms**,
  with the **default value being 10 ms**."

And the export consequence, quoted: "since you're recording with an External
Instrument rather than a Virtual Instrument, you will have to do a **real-time
export** when exporting the Session. Running external audio signals through the
Console means that bouncing, rendering and mixdown **automatically switches to
real-time**."

**MotionLab does:** Absent in every part — no external instruments, no aux
channels, no MIDI clock, no MTC, no CC automation interval. Grepped
`MTC|MIDI Time Code|MMC|Machine Control` — zero hits. `Track.type` is
`'audio' | 'instrument' | 'drum' | 'bus' | 'fx' | 'folder' | 'vca'`
(`src/model/types.ts:90`) — there is no `aux`. Bounce is always offline
(`src/audio/exportMix.ts` renders through the same `InsertChain` as the realtime
engine, asserted by e2e parity tests), so a real-time export mode does not exist
and has never needed to.

**Gap:** `MISSING`, but note that the whole external-hardware workflow is
substantially `DIVERGENT-BY-DESIGN` for a browser: MIDI _output_ is reachable
(MD-6), audio return would ride on the same absent I/O layer as IO-1, and
real-time bounce contradicts the offline-parity contract in `CLAUDE.md`'s "What
NOT to refactor". If any of this is ever built, the aux return depends on IO-1
first.

## MD-10 · Control Surfaces and Mackie Control

**FSP8 does:** "a Control Surface is a hardware device that includes transport
controls, faders, and other specialized controls. The control surface might use
MIDI directly or via a special control layer such as Mackie Control." Setup is the
same Add… dialog with **New Control Surface**, Manufacturer/Device Name, and
Receive From / Send To. Explicitly: "You do **not** need to specify the MIDI
channels your Control Surface should use, as control surfaces use alternative
protocols, such as Mackie Control."

**Custom Placement:** click **Placement** in the External Devices menu after
adding surfaces. "All ungrouped surfaces appear under the **Ungrouped** tab. To
place a surface in a group, select a Group tab, then click-and-drag the surface
from the Ungrouped area to the selected group area. To adjust the order … click-
and-drag them left or right. Channels in the Console appear in order across the
surfaces from left to right." **Up to four Groups** can be created, "to allow for
mirroring of Channels across multiple surfaces … (e.g. an A room and B room or a
control room and live room)." Constraint: "Only supported and predefined Control
Surfaces appear in the Placement window. **User-defined devices do not appear**."

**MotionLab does:** No control-surface _device_ class and no Mackie protocol —
grepped `Mackie|control surface|ControlSurface`: zero hits. What exists instead is
**Control Link**: a generic learn-based binding layer.
`src/audio/controlLink.ts` + `src/components/settings/ControlLinks.tsx`, surfaced
in Preferences under the heading "Control Link" with the blurb "Bind a hardware
knob, fader, pedal or button to anything in the product: pick the target, press
Learn, then move the control." Bindings live in the project
(`ProjectData.controlLinks?: ControlLink[]`, "hardware controls bound to
parameters, macros and the transport").

The MIDI path gives Control Link first refusal on continuous controls
(`src/audio/midi.ts:~140–158`): `offerToLearn(source)` captures a learn, then
`applyControl(source, value)` routes a bound control — and **notes are never
stolen this way**, with the comment recording why: "a keyboard has to keep playing
while a mapping is learned." CC 64 (sustain) is deliberately bindable, per the
comment on `controlSourceOf()`: "a pedal is the control most players want on
'start/stop' or a macro, and the instrument path still gets it when nothing is
bound to it."

**Gap:** `PARTIAL`. Control Link covers the _user goal_ (a hardware fader moves a
thing) generically and portably, without a device database. It does not cover
what Mackie Control provides: bank-following, motorised fader feedback, scribble
strips, transport LEDs, or multi-surface placement — all of which need MIDI
**output** (MD-6), which does not exist.

## MD-11 · Reconnect Devices, and the missing-device warning — **P0**

**FSP8 does:** Quoted, because the contrast is the documented selling point:

> "In most applications, when MIDI devices become disconnected while the
> application is running, you usually have to restart the application, and the
> software may crash. In contrast, if an external MIDI device becomes disconnected
> while Fender Studio Pro is running … the device can be reconnected **without
> restarting**."

Procedure: `Studio Pro / Options / External Devices` → **Reconnect** at the bottom
of the menu → reconnect the devices → **OK**.

Startup with missing gear: "If an external device is not present when Fender
Studio Pro is started … the application still runs normally. You should see a
**warning message**." The warning is suppressible: "you may wish to turn off this
warning message by disengaging the **Notify Me If Devices Are Unavailable When
Fender Studio Pro Starts** option." And on later runs: "when you start Fender
Studio Pro with the device connected … Fender Studio Pro recognizes the device
automatically, and it can be used exactly as before with no further setup
required."

**MotionLab does:** Reconnection is automatic and needs no command.
`this.access.onstatechange = () => this.refreshInputs()` (`src/audio/midi.ts:106`)
fires on every connect and disconnect. `refreshInputs()`
(`src/audio/midi.ts:118–131`) handles the loss explicitly: if the currently
selected input is no longer in the list it logs `Selected MIDI input
disconnected` and calls `this.select(null)`; if nothing is selected and inputs
exist it selects the first. So unplug → the app deselects and says so; replug →
the app re-selects automatically. The UI updates because `midiInputs` is store
state.

Not present: a persisted device identity, so "used exactly as before with no
further setup" is only true for the first-input case; and no missing-device
startup warning or its suppression toggle, because nothing is remembered to be
missing. The empty case reads "No MIDI devices found — connect one and it will
appear here." (`SynthPanel.tsx:250–252`).

**Gap:** `PARITY` for hot reconnect (better — no explicit Reconnect command is
needed). `MISSING` for remembered-device identity and the unavailable-at-startup
notice.

## MD-12 · QWERTY keyboard as a MIDI keyboard

**FSP8 does:** A device you _add_: `Studio Pro / Options / External Devices / Add
Device`, choose the **QWERTY Keyboard** device from the Fender device folder.
Then "open the interface for the QWERTY Keyboard device by double-clicking on it
in the External panel of the Console. Any record-enabled Instrument Track then
receives input from the QWERTY Keyboard … **Your keyboard only transmits data to
Instrument Tracks while the QWERTY Keyboard device interface is open.**"

**MotionLab does:** Present, always on, no device to add. `src/hooks/useKeyboard.ts`
scopes the computer keyboard's held notes; `src/components/synth/Keyboard.tsx:98`
notes that "A-L on the computer keyboard already plays". Both the on-screen and
computer keyboards feed the same live-note path as MIDI —
`src/audio/midiRecorder.ts:10` records that MIDI, the on-screen keyboard and the
computer keyboard "all arrive through this" single path, and
`src/audio/engine.ts:1924` says the same at the engine end. Octave is a UI state
(`uiStore.keyboardOctave`).

**Gap:** `PARITY`, and simpler — no device add, no window-open precondition. One
divergence worth noting: FSP8's gate ("only while the interface is open") is a
deliberate guard against typing into a text field and triggering notes; MotionLab
achieves the same with focus scoping in `useKeyboard.ts` rather than a window.

## MD-13 · Recognised control surface with zero setup

**FSP8 does:** A named first-party control surface connected to macOS or Windows
is "automatically recognize[d] … and configure[d] for use. Just open a Session,
Mastering, or Show Page to use [it] immediately."

**MotionLab does:** No device recognition of any kind. Control Link requires an
explicit Learn per binding.

**Gap:** `MISSING`. Note the IP boundary: a MotionLab equivalent would be a
generic "recognised controller profile" mechanism with no reference names in it.

---

# 5. Managing Your Content

_(FSP8 manual pp. 24–27; extract lines 1242–1339)_

Path for this whole section: `Studio Pro / Options / Locations`
(macOS `Preferences / Locations`).

## MC-1 · User Data location

**FSP8 does:** "Any content you create … is automatically stored in the location
you specify. This includes **Sessions, Mastering Projects, Shows, Effects
Presets**, and all of the files these categories contain." It is the default save
location for every new document, though any location may be chosen per document.

**MotionLab does:** No location concept — storage is IndexedDB, opened by
`src/persistence/db.ts`, with projects in `projectRepo.ts` and media blobs/peaks/
recovery records in `mediaStore.ts`. The user cannot choose where anything lives.
The Welcome sheet states the model plainly: "Projects autosave to this browser
(with a backup of the previous save). Export your mix as WAV anytime."
(`src/components/common/WelcomeSheet.tsx:49`).

**Gap:** `DIVERGENT-BY-DESIGN` — a page cannot write to arbitrary filesystem
paths. (The File System Access API would allow a user-granted directory handle in
Chromium; that would be the parity route if it is ever wanted.)

## MC-2 · Enable Autosave, at a specified interval

**FSP8 does:** "Engage the **Enable Autosave** option to automatically save any
open document at a **specified interval of time**." So: a toggle and an interval.

**MotionLab does:** Autosave is unconditional, not a preference, and is
**debounce-based rather than interval-based**. `installAutosave()`
(`src/app/projectActions.ts:318–330`) subscribes to the project store and
schedules `saveCurrent(true)` **1500 ms** after the last change. It also flushes
immediately on `pagehide`, on `visibilitychange` to hidden, and on `beforeunload`
(where it also calls `e.preventDefault()` so the browser asks for confirmation
while the page is still dirty) — `projectActions.ts:332–348`.

Failure is never silent: `projectActions.ts:66–70` warns once per failure run with
`Autosave failed: <msg>. Your latest changes are NOT saved.` and keeps the detail
in the diagnostics log; the flag resets on the next success (`:60`).

**Gap:** `PARTIAL` — the behaviour is present and stronger (debounced + three
flush points + explicit failure surfacing), but there is no toggle and no
user-visible interval. A 1500 ms debounce is a better default than any interval,
so the gap is the _absence of the control_, not the behaviour.

## MC-3 · Use cached plug-in data on save

**FSP8 does:** "Engage the **Use cached plug-in data on save** option to make sure
that any changes that have been made to the plug-in parameters are saved when the
Session is saved."

**MotionLab does:** N/A as an option — native effect parameters are plain data in
`Track.effects[].params` and are always saved. For WAM plug-ins
(`src/audio/wam/`) state capture follows the WAM state API; there is no cached-vs-
queried choice.

**Gap:** `DIVERGENT-BY-DESIGN` — the option exists in the reference because VST
state retrieval can be slow or unreliable; that failure mode has no analogue here.

## MC-4 · Ask to Copy External Files when Saving Session

**FSP8 does:** "Engage the **Ask to Copy External Files when Saving Session**
feature to be given the option to consolidate any outside files to the central
data folder when saving a Session."

**MotionLab does:** Consolidation is unconditional and structural — imported audio
is decoded and its bytes stored in IndexedDB via `putMediaBlob()`
(`src/persistence/mediaStore.ts`), referenced by `MediaRef` in
`ProjectData.media`. There are no external file references to consolidate. Missing
media is detected and reported: `warmMedia()` (`src/app/projectActions.ts:139–148`)
logs `<n> media file(s) referenced by "<name>" are missing`, and the diagnostics
report carries a `Missing media` field (`src/diagnostics/report.ts:187`).

**Gap:** `DIVERGENT-BY-DESIGN` — always-consolidated, so the question never
arises.

## MC-5 · File Types

**FSP8 does:** `Studio Pro / Options / Locations / File Types`. "All supported file
extensions are listed … **Only these supported file types are displayed in the
Browser.**" Extensions are user-editable: "[Add…]" opens a pop-up where you "choose
an icon, enter the file extension, and provide a description for the file type."
User-added extensions can be selected and removed; built-ins cannot.

**MotionLab does:** Absent as a preference. Accepted formats are whatever
`decodeAudioData` accepts, decided in `src/audio/importAudio.ts`; the Browser
shows the project's own media pool (`src/components/browser/PoolTab.tsx`) rather
than a filesystem.

**Gap:** `DIVERGENT-BY-DESIGN` — there is no filesystem browser to filter.

## MC-6 · Sound Sets, and custom sound-set paths

**FSP8 does:** Preconfigured loop/sample packages, surfaced in the Browser's
**Sound Sets** folder, carrying vendor information and a **Visit Website** link.
"While default paths can't be removed, it is possible to add custom folder paths
for Sound Sets" — done from the installer's Install Options, via the `[…]` beside
the Sound Sets file location box. Two documented caveats: a custom location on an
external drive must be re-pointed in the Installation dialog after reconnecting
the drive ("it does not reset the file paths"); and syncing the Documents folder
to OneDrive relocates the path — "This is Operating System behavior and not
something Fender Studio Pro can control."

**MotionLab does:** No sound-set/content-pack system. There is a media pool per
project and a sampler with presets (`src/audio/samplerInstrument.ts`,
`src/model/presets.ts`), but no installable vendor content and no content paths.

**Gap:** `MISSING` for the content-library concept; `DIVERGENT-BY-DESIGN` for the
path management.

## MC-7 · Instrument Library

**FSP8 does:** `Studio Pro / Options / Locations / Instrument Library`. Tells the
app where sample libraries live so they appear as presets in the bundled sampler
instrument. Supported library formats named: the native cross-platform sample
format, plus Giga, EXS, Kontakt (version 4 and below), and SoundFont (SF2).
"[Add…]" adds a location; "You can specify as many locations as you need."

**MotionLab does:** No external library formats. The sampler loads from the
project's own media (`src/audio/samplerInstrument.ts`, `SamplerParams` on the
track). Grepped `sf2|SoundFont|Kontakt|EXS` — no hits.

**Gap:** `MISSING`. Format support is a separate question from the _locations_
preference; only the former is plausible in-browser (SF2 parsing is feasible).

## MC-8 · VST plug-in locations, scan at startup, blocklist

**FSP8 does:** `Studio Pro / Options / Locations / VST Plug-ins`. "[Add…]" adds a
scan path; folders can also be drag-and-dropped from Explorer/Finder into the
Locations list. "Fender Studio Pro then scans these locations at startup,
including searching for new plug-ins you've added." AU and VST3 are excluded from
path options because "AU and VST 3 have their own pre-set file path in the OS".
Formats supported: **VST 2.4 (including VSTXML for hierarchical parameter
structure) and VST 3**.

**Failed plug-ins:** a plug-in that fails at scan gets a notice next to its name in
the startup message list plus a warning; repeated failure (unauthorised, missing
iLok) puts it on a **blocklist** and it is ignored thereafter. Reset with
`Studio Pro / Options / Locations / VST Plug-ins` → **[Reset Blocklist]**; the
same page carries a **Scan at startup** tickbox. The manual warns about turning
scanning off: "it also means that Fender Studio Pro won't know when an existing
plug-in has been updated or a new plug-in has been installed" (extract 902–907).
A plug-in that malfunctions without crashing produces: _"The following plug-ins
didn't work as expected: <Plugin_Name.vst3>. Please save your work and restart
Fender Studio Pro."_ with an option to add it to the blocklist.
"Update Plug-Ins" in the Plug-in Manager forces a full rescan.

**MotionLab does:** Plug-ins are WAM modules loaded over the network, not scanned
from disk. `src/audio/wam/` resolves them; `onPluginsResolved()`
(used at `src/audio/engine.ts:~300`) rebuilds the graph when a plug-in lands after
the graph was built — the comment calls it "the return half of the seam". There is
no scan, no scan-at-startup toggle, and no blocklist: grepped
`blocklist|blockList` — zero hits.

**Gap:** `DIVERGENT-BY-DESIGN` for locations and scanning. **`MISSING` for the
blocklist concept**, which is _not_ platform-blocked: a WAM module that throws on
load or that stalls the graph is exactly as capable of ruining a session, and
there is currently no mechanism to remember "this one is bad, don't load it".
Worth flagging as a real robustness gap rather than an artefact of the plug-in
model.

## MC-9 · Backup and Restore (cloud)

**FSP8 does:** For subscribers, cloud backup of **complete user settings**, with
multiple named backups ("for different computers, artists or projects"), limited
only by available cloud storage. Path: the **Studio Pro** menu → **Backup and
Restore** → **[Backup Now]**. Existing backups are listed in the Restore section.
Restore is selective — pick a backup, then tick which parts to restore from the
**Restore Options** list: **program settings, plug-in thumbnails, I/O
configurations, presets, templates and macros**. "Any options unchecked will
remain unchanged." One documented edge case: "When restoring a backup that
originates from another system and contains Sound Set paths that cannot be
resolved on the current system, **the path is reset to default**."

**MotionLab does:** No account, no cloud backup, no settings sync. The word
"backup" in the codebase means something different: `loadProjectBackup()`
(`src/app/projectActions.ts:173–181`) is a **local previous-version copy** kept by
every save, restored when the current copy will not parse — "The stored copy is
unreadable (corrupted write or newer schema). Every save keeps the previous
version — offer it rather than a dead end."

**Gap:** `MISSING` for settings backup/restore. Note that MotionLab's preferences
are per-device by explicit design — `src/state/prefsStore.ts` header: "They are
per-device, not per-project — a musician's second machine is allowed to be set up
differently" — so a sync feature would need that decision revisited, not just
built.

## MC-10 · Content Installation and rescan

**FSP8 does:** (Adjacent chapter, referenced from Setup.) "You can trigger a
complete rescan of your installed plug-ins by clicking **Update Plug-Ins** in the
Plug-in Manager."

**MotionLab does:** No plug-in manager. Reload is the rescan.

**Gap:** `DIVERGENT-BY-DESIGN`.

---

# 6. Creating a New Session

_(FSP8 manual pp. 28–30; extract lines 1341–1444)_

## NS-1 · Three ways to create

**FSP8 does:** From the Start page, the **New Session… [+]** button; or
`File / New Session`; or **[Ctrl]/[Cmd]+N**. The New Document Window appears; for
a recording session choose **Record and Mix**.

**MotionLab does:** Start page template cards create directly —
`TemplateCard`'s onClick calls `newProjectFromTemplate(template)` then `go('song')`
(`src/pages/StartPage.tsx:60–78`). There is no intermediate New Document dialog:
picking a template _is_ the creation act. Keyboard shortcuts live in
`src/app/shortcuts.ts` (`SHORTCUTS` registry, rebindable via
`src/state/keymapStore.ts`).

**Gap:** `PARTIAL` — creation exists with a richer starting point (see IO-10), but
the pre-creation settings dialog does not (see NS-3 … NS-11).

## NS-2 · Default session name and location

**FSP8 does:** "The default name of each new Session is derived from **today's
date and the Artist name** you've selected in the Artist Profile on the Start
page. You can set your own title by editing the text in the **Name** field."
Location defaults to the User Data location, changeable with the `[…]` button.
Sticky-folder behaviour: "Fender Studio Pro will remember the last folder you used
for a new Session and assume you would like to save your work in the same
location. If you would like to restore to the default location, **right-click the
file path and choose 'Reset Folder'**."

**MotionLab does:** Name comes from the template; renaming happens after creation.
There is no artist profile on the Start page, though `ProjectData.artist?: string`
and `genre?: string` exist as export metadata (`src/model/types.ts`). No location,
so no sticky folder.

**Gap:** `PARTIAL` for naming; `DIVERGENT-BY-DESIGN` for location.

## NS-3 · Sample Rate at session creation — **P0**

**FSP8 does:** A **Sample Rate** field in the New Document dialog. Behaviour,
quoted, because the coupling is the point:

> "The Fender Studio Pro sample rate should match the sample rate of your audio
> interface, so by default, the sample rate is set to your current audio
> interface's sample rate, and **changing this setting initiates a sample rate
> change in that device**. If the sample rates don't match, Fender Studio Pro
> resamples all audio files to match the sample rate of the hardware, but this can
> cause performance problems and should be avoided."

Range: "supports sample rates up to **768 kHz**". Restart/ordering rule: "Not all
devices allow a third-party software application to change the hardware sample
rate. **The desired sample rate should be set before creating a New Session.**"
And the storage consequence: "File size is directly proportional to the sample
rate and bit depth."

**MotionLab does:** The session has no sample rate. The engine's rate is whatever
the browser gives — `new AudioContext({ latencyHint: 'interactive' })`
(`src/audio/engine.ts:290`), logged as `AudioContext created (<rate> Hz)`, and
reflected into `transportStore.sampleRate` by `reflectContextState()`
(`src/audio/engine.ts:412`). Preferences state the position honestly: the _Engine_
row's hint reads **"Sample rate is chosen by the browser"**.

Where a rate _is_ choosable is at **export**: `ExportSettings.sampleRate` defaults
to **48000** (`src/app/exportActions.ts:95`) and the Export sheet offers a `RATES`
segmented control (`src/components/common/ExportSheet.tsx:263–278`).

**Gap:** `DIVERGENT-BY-DESIGN` for the session/device rate (a page cannot set a
device's clock; `AudioContext({sampleRate})` merely requests a resampled context
and is not universally honoured). **`MISSING` for the _disclosure_** — nothing
tells the user their project is running at, say, 44.1 kHz while they are exporting
at 48 kHz, which is a real and silent quality decision. **P0-adjacent.**

## NS-4 · Resolution (bit depth) at session creation

**FSP8 does:** A **Resolution** field. "Fender Studio Pro can record audio with
**16, 24, 32, or 64-bit (floating point)** resolution." The manual explains the
stakes: 16-bit ≈ 96 dB dynamic range ("CD-quality"), 24-bit ≈ 144 dB and "the most
common resolution setting in professional recording."

**MotionLab does:** No recording bit depth. Capture is `MediaRecorder` with a
negotiated **compressed** codec — `MIME_CANDIDATES` in `src/audio/recorder.ts:28–35`
prefers `audio/webm;codecs=opus`, then WebM, Ogg/Opus, `audio/mp4;codecs=mp4a.40.2`,
MP4, AAC; the chosen type is reported in diagnostics rather than assumed
(`recorder.ts` header comment). The graph itself is float32.

Export bit depth _is_ choosable: `ExportSettings.bitDepth` defaults to **24**
with `float: false` (`src/app/exportActions.ts:93–94`), and the sheet offers the
format's own `bitDepths` plus a **32-bit float** button whose tooltip reads "No
clipping and no dither needed — the right choice for a file that will be
processed again" (`ExportSheet.tsx:246–259`).

**Gap:** `DIVERGENT-BY-DESIGN` for record depth — `MediaRecorder` is the only
cross-browser capture API and it encodes lossily; the recorder's own header comment
says exactly that. **This is the single most consequential quality divergence in
the whole chapter and should be stated in the UI, which it currently is not.**
Export depth: `PARITY`.

## NS-5 · Timebase

**FSP8 does:** A **Timebase** selector in the New Document dialog, changeable at
any time afterwards, with four options: **Seconds** (hours : minutes : seconds :
milliseconds), **Samples**, **Bars** (bars and beats), **Frames**.

**MotionLab does:** Two of four. `Prefs.primaryTimeDisplay: 'bbt' | 'clock'`
(`src/state/prefsStore.ts`), defaulting to `'bbt'`, exposed in Preferences →
_Metering & time_ → "Primary time display" as a two-button segmented control
labelled **Bars** / **Clock**. Samples and Frames do not exist.

**Gap:** `PARTIAL` (2 of 4). Frames requires a video/SMPTE frame rate the app does
not have; Samples is trivially derivable and simply absent.

## NS-6 · Session Length

**FSP8 does:** A length field with a **default of five minutes**. Changeable later
by moving the **Session End** marker, or via `Session / Session Setup` →
**Session End**.

**MotionLab does:** No session length. The timeline is open-ended; the arrangement
enforces a "72-bar minimum so there is always somewhere to scroll to"
(`src/components/arrangement/Arrangement.tsx:894–895`). Export range is chosen at
bounce time — `ExportSettings.range: 'song' | 'loop'` with a `tailSeconds` default
of **2** (`src/app/exportActions.ts:97–99`).

**Gap:** `DIVERGENT-BY-DESIGN` — a session end marker is a fixed-buffer-era
concept; an open timeline plus an explicit export range is the modern equivalent
and is present.

## NS-7 · Tempo

**FSP8 does:** Starting tempo field, "or go with the default setting of **120
BPM**."

**MotionLab does:** `ProjectData.bpm` (`src/model/types.ts:712`), set by the
template — `TEMPLATES` each carry a `bpm`: `empty` **120**, `songwriter` **96**,
`band` and `electronic` per style (`src/model/templates.ts`). Full tempo mapping
exists beyond the reference's single field: `ProjectData.tempoMap?: TempoMap`,
documented as "`bpm` and `timeSig` above remain the value at beat 0 and are kept
in sync, so every older reader still sees a valid song."

**Gap:** `PARITY` — set at creation (via template rather than a field) and
editable after, with ramps the reference's New Document dialog does not offer.

## NS-8 · Time Signature

**FSP8 does:** Starting time signature, "or use the default setting of **4/4**. A
Session can change time signatures as many times as needed" via the Signature
Track.

**MotionLab does:** `ProjectData.timeSig: TimeSignature`, set per template (all
current templates are 4/4), with signature changes carried in the tempo map
(`beatsPerBarAt()` in `src/model/tempo.ts` is used by the recording count-in and
the metronome scheduler).

**Gap:** `PARITY`.

## NS-9 · Key Signature

**FSP8 does:** "Use this field to specify a **global key signature** for your
Session. If no selection is made, **a key signature is not assigned**." Changeable
as often as needed via the Signature Track.

**MotionLab does:** No project-level key signature. There is a **piano-roll**
key and scale — `uiStore.prKey`, `uiStore.prScale`, and `uiStore.prScaleLock`
(`src/state/uiStore.ts:136–139`) — which is editor state, not a song property, and
does not appear on a signature lane or in exports. A chord track exists
(`ProjectData.chords?: ChordEvent[]`).

**Gap:** `PARTIAL` — a key exists but at the wrong scope (per-editor, not
per-song) and with no "unassigned" state distinct from a default.

## NS-10 · File Import at creation

**FSP8 does:** A drop field in the New Document dialog: "If you have any audio
and/or video files you would like to import to your new Session, drag and drop
them to this field. **Each will receive its own Track when the Session is
created**, with video being placed appropriately in the Video Track. If multiple
videos are imported, they will be placed one after another horizontally with no
overlap."

**MotionLab does:** Import exists but **after** creation, not during it —
`src/audio/importAudio.ts` plus drag-and-drop onto the arrangement. No video track
of any kind.

**Gap:** `PARTIAL` for audio (right capability, wrong moment); `MISSING` for video.

## NS-11 · Stretch Audio Files to Session Tempo

**FSP8 does:** A creation-time option: "Enable this option to automatically
timestretch imported audio files (**that have tempo information**) to match your
Session's current tempo. This is highly recommended…" With the counter-case
stated: "if you do not intend to work with Timestretching … make sure this option
is deselected." And the precondition: "**Only** audio files with encoded tempo
information are stretched automatically."

**MotionLab does:** Timestretching exists and is substantial —
`src/audio/timestretch.ts` (WSOLA), `src/audio/stretchCache.ts`,
`src/audio/warpRender.ts` — but there is no auto-stretch-on-import preference and
no reading of encoded tempo metadata from imported files. Grepped
`stretchOnImport|autoStretch` — no hits.

**Gap:** `MISSING` for the option and for tempo-tag reading; the stretch engine
underneath it is present.

## NS-12 · Apply Customization at creation

**FSP8 does:** "Choose a **Customization Preset** from this list, if desired."
(See CU-1.) Also cross-referenced: loading a document created from a Smart
Template with a Customization Preset applied may prompt **Keep** (use the preset
the document was created with) or **Revert** (use your currently selected preset).

**MotionLab does:** Absent; see CU-1.

**Gap:** `MISSING`.

---

# 7. Working with the Companion Notation Application

_(FSP8 manual pp. 30–32; extract lines 1446–1520)_

## NT-1 · Sending a session to the notation app

**FSP8 does:** `Session / Send to Notion` opens a dialog with:

- **Computer Selector** — "This Computer", or any instance discovered on the local
  network.
- **Send Note Data of Entire Session** — creates a new Score whose instrument
  parts mirror the Instrument Tracks.
- **Send Note Data of Selected Tracks** — same, restricted to selection.
- **Send Audio Mixdown** — legacy; mixes to a stereo WAV and attaches it to a new
  Score.
- **Create lead sheet** — applies lead-sheet formatting using the Chord Track.
- **Merge into open document** — merge (overwriting a previous transfer) vs. create
  new.

Tempo map information is sent alongside note data "ensuring that tempo and time
signature changes remain in sync." Audio files can also be right-clicked in the
Browser and sent, **16-bit/44.1 kHz WAV only**. Lyrics in Lyrics Lanes transfer;
Global Lyrics Track content does not.

**MotionLab does:** No companion application and no network peer discovery. Score
rendering exists in-app (`src/components/score/ScoreView.tsx`) — the notation is
_displayed_, not exchanged. Grepped for any peer/network transfer — none.

**Gap:** `DIVERGENT-BY-DESIGN` — LAN peer discovery is not available to a page.
The transferable equivalent (MIDI file / MusicXML export) would be the parity
route and is worth recording as a separate gap: grepped `MusicXML|musicxml` — no
hits, so **`MISSING`** for standards-based score interchange.

## NT-2 · Receiving from the mobile notation app

**FSP8 does:** In the mobile app: Export → **Transmit**, choose the target
computer, choose **Merge into open document** or new, and pick a **Format** from
Score Exchange, MIDI, or Wave.

**MotionLab does:** Absent. MIDI _file_ import: the app records MIDI
(`src/audio/midiRecorder.ts`) but no `.mid` file import/export path was found.

**Gap:** `MISSING`.

## NT-3 · Round-trip update by re-sending

**FSP8 does:** "Repeating the sending procedure from the application in which the
change was made to the other application **updates all previously sent notes and
audio files** to match the new information."

**MotionLab does:** N/A.

**Gap:** `DIVERGENT-BY-DESIGN`.

---

# 8. Custom Colors

_(FSP8 manual pp. 32–34; extract lines 1522–1571)_

## CC-1 · Where the Color Selector opens from

**FSP8 does:** Session Page — **Track**: click the leftmost tab of a Track header;
**Channel**: click and hold on any Channel name at the bottom of the Console;
**Event**: right-click the Event and click the coloured bar in the pop-up menu.
Show Page — **Player** and **Setlist Item**: leftmost tab. Mastering Page —
**Track**: the colour field on the far left of the Track List.
Rule: "Applying a color to a Track will color all Events on that Track,
**excluding Events that have been colored manually**."

**MotionLab does:** Track colour is a first-class field (`Track.color: string`,
"hex color used across arrangement + mixer") and is edited from the Inspector
(`src/components/inspector/Inspector.tsx`, which references `TRACK_COLORS`).
Clip-level colour also exists — `src/components/arrangement/ClipView.tsx` and
`TakeLanes.tsx` consume colours. The multi-page entry points (Show players,
setlist items, mastering track list) are not all wired to a colour control;
`ShowPage.tsx` and `MasteringPage.tsx` were not found to open a colour picker.

**Gap:** `PARTIAL` — track and clip colouring exist; the per-page entry points and
the manual-override precedence rule are not uniformly implemented.

## CC-2 · The default 128-swatch palette

**FSP8 does:** "The Color Selector's default view lets you choose any of the below
**128 colors** by a quick left-click."

**MotionLab does:** `TRACK_COLORS` (`src/model/types.ts`) is a curated short
list — the visible entries begin `#37b89a`, `#4a90c4`, `#9070c9`, `#d9a13c`,
`#d97455`, `#6aa84f` — nothing like 128.

**Gap:** `PARTIAL`. Deliberate curation is defensible (a small palette that works
in all three themes is a feature, not a shortfall) but there is no free choice.

## CC-3 · The Advanced Color Selector

**FSP8 does:** Opened by the drop-down arrow at the bottom of the Color Selector.
Contains:

- **+/−** — add or remove swatches.
- **Store/Load Preset** — swatch-set presets; "Several custom themes are included;
  you may also create and save your own."
- **Reset** — "Resets the Color Picker Preset to the last loaded Preset."
- **Hex Value** — displayed and editable; "You can copy out of this field to match
  a color in another application, or enter your desired color's hex value here."
- **HSL** — hue by rotation of the triangle's point on the colour circle;
  saturation and lightness by the pip inside the triangle; values also
  directly enterable.
- **RGB** — sliders with pips, values directly enterable.

**MotionLab does:** Absent — no arbitrary colour entry, no hex field, no HSL/RGB
model, no swatch presets. Grepped `ColorPicker|colorPicker` in `src/components/` —
no such component.

**Gap:** `MISSING`.

## CC-4 · Where the overall colour scheme is edited

**FSP8 does:** "Edits to Fender Studio Pro's overall color scheme are managed in
`Studio Pro / Options / General / Appearance`." (See GO-4.)

**MotionLab does:** Preferences → **Appearance**, with a four-way theme radiogroup
(`SettingsSheet.tsx`, `THEMES`): **System** ("Follow the operating system"),
**Dark** ("The studio default"), **Light** ("For bright rooms"), **Contrast**
("Maximum legibility"). Written to the document root by `applyAppearance()`
(`src/state/prefsStore.ts`), which honours the three-theme contract in `CLAUDE.md`:
`system` removes `data-theme` entirely, everything else stamps it.

**Gap:** `PARITY` on placement.

---

# 9. Customization

_(FSP8 manual pp. 34–36; extract lines 1573–1668)_

## CU-1 · What Customization is

**FSP8 does:** "Customization allows you to selectively toggle the visibility of
specific Fender Studio Pro features from its user interface to create a
streamlined … experience best-suited to your work." Settings are edited and
recalled from `View / Customization`; the editor is `View / Customization / Edit
Customization`, or right-click any customisable area (Toolbar, Inspector,
Transport, Browser) → **"Customize…"**. Constraint: "**Customization is only
available for the Session Page.**"

**MotionLab does:** No feature-visibility system. What exists is _panel_ layout:
`useWorkspaceStore` (`src/state/workspaceStore.ts`) persists
`browserSize` (default **16**), `inspectorSize` (**17**), `editorSize` (**38**),
`showBrowser` / `showInspector` / `showEditor` (all **true**), `maximized`
(**null**, one of `arrange|editor|browser|inspector`), plus global-lane toggles
`showMarkers` (**true**), `showSections` (**true**), `showChords` (**false**),
`showTempoLane` (**false**), and `showOverview` (**true**). Persisted to
localStorage under `txpps-motionlab-workspace-v1`, with `normalizeLayout()`
clamping every field so "a layout saved by an older build (or at a very different
viewport) can never reproduce an unusable workspace."

**Gap:** `PARTIAL` — panel and lane visibility yes; per-_control_ visibility no.

## CU-2 · The Customization tabs

**FSP8 does:** Tabs, each a checkbox list toggling individual features:
**Toolbar** (top of the Arrange window), **Inspector** (left of Arrange),
**Track Controls** (left of Arrange), **Transport** (bottom), **Browser**
(right). "Any change made immediately is stored in user Settings. If a factory
Setting was selected, a new user Setting is generated based on the factory Setting
name."

**MotionLab does:** Absent at control granularity.

**Gap:** `MISSING`.

## CU-3 · Storing, renaming and deleting Customization Settings

**FSP8 does:** The drop-down at the top of the Customization Edit Window offers
**"Store…"**, plus **Rename** and **Delete** for existing Settings.
**"Delete User Customization"** restores all Customization Settings to factory
defaults — "Note that this will remove any Settings you have created yourself!"

**MotionLab does:** One layout, no named presets. `workspaceStore.reset()` returns
to `DEFAULT_LAYOUT` and is exposed in Preferences as the **"Reset panel layout"**
button.

**Gap:** `PARTIAL` — reset yes, named presets no.

## CU-4 · Keep vs Revert on document load

**FSP8 does:** "When loading a Document that has had a Customization Preset applied
from a Smart Template … you may be asked to **Keep** or **Revert** the
Customization Preset if it is different than the one you are currently using.
Choose **Keep** to use the Preset chosen when the Document was created. Choose
**Revert** to use the previously selected Preset."

**MotionLab does:** N/A. Note that `ProjectData.workspace: WorkspaceState`
(`src/model/types.ts:717`) _does_ store a per-project workspace, so the collision
the Keep/Revert dialog resolves is structurally possible here; the app currently
resolves it silently.

**Gap:** `MISSING`.

## CU-5 · Appearance preferences are not part of Customization

**FSP8 does:** "The Appearance (color) preferences are available in the General
Options menu." — an explicit separation of concerns.

**MotionLab does:** Same separation: appearance in Preferences, panel layout in
the workspace store (with its reset button also surfaced in Preferences).

**Gap:** `PARITY`.

---

# 10. General Options

_(FSP8 manual pp. 36–37; extract lines 1670–1740)_
Path: `Studio Pro / Options / General` (macOS `Preferences / General`), one tab
per group.

## GO-1 · General ▸ Language

**FSP8 does:** "**Language**: Choose your language from the list."

**MotionLab does:** English only, no locale system. Grepped `i18n|locale|language`
across `src/` — the only hit is `localeCompare` used for sorting in
`src/components/browser/PoolTab.tsx:49`.

**Gap:** `MISSING`.

## GO-2 · General ▸ When Studio Pro starts

**FSP8 does:** A list choosing the default startup action, with these options:

- **Do Nothing** — no Session, Mastering Project or Show opens by default.
- **Open Last Session/Mastering Project/Show** — the most recent opens.
- **Open Default Session/Mastering Project/Show** — opens the item saved with the
  name **"default"** in the appropriate folder under the current User Data
  location.
- **Create a New Session** — a new Session is created and opened.
- **Check for Updates** — check for software updates on startup.

**MotionLab does:** Fixed behaviour, no choice. Boot restores the last project —
`savePrefs({ lastProjectId: p.id })` on every open
(`src/app/projectActions.ts:~166`), consumed by `bootProject()`. The Start page is
the landing surface and offers "Continue "<name>"" plus a Recent list
(`src/pages/StartPage.tsx`). So MotionLab is permanently on the equivalent of
"Open Last Session", with a Start page in front of it. No update check (the
service worker handles updates transparently).

**Gap:** `MISSING` for the choice; the default behaviour matches the most useful
option.

## GO-3 · General ▸ graphics / DPI toggles

**FSP8 does:** Two platform-specific toggles, both **enabled by default** and both
accompanied by "We do not recommend disabling this":

- **Enable graphics hardware acceleration** (macOS only) — "unless it is necessary
  to improve downward compatibility between Fender Studio Pro and third-party
  plug-ins."
- **Enable High-DPI Mode** (Windows only) — "improves the look and feel … on
  high-DPI monitors when running on Windows."

With a cross-reference: older plug-ins may appear small on Windows high-DPI, fixed
per plug-in by **Enable System DPI Scaling** in the plug-in's settings menu
(requires Windows 10 v1803+), with the caveat that scaled interfaces appear blurry
and that plug-ins with their own scaling should not use it.

**MotionLab does:** No acceleration toggle (the browser compositor is not
addressable). DPI is observed, not controlled — `devicePixelRatio` is reported in
diagnostics (`src/diagnostics/report.ts:264`). The nearest user control is
`Prefs.uiScale`, range **0.85–1.4**, clamped by `clampScale()`
(`src/state/prefsStore.ts`), offered as six presets **85 / 90 / 100 / 110 / 125 /
140 %** and applied as the CSS custom property `--ui-scale` on the document root.

**Gap:** `DIVERGENT-BY-DESIGN` for the toggles. The interface-scale control has no
counterpart in the reference's General tab and is a MotionLab advantage.

## GO-4 · Appearance

**FSP8 does:** "Set the **color balance** for the user interface … with separate
controls for **Background** and **Arrangement** elements. Independent settings for
**Plug-Ins** and the **Score View** let you choose between **Dark** and **Light**
viewing modes." Scope caveat: "these options only affect certain Fender Studio Pro
plugins, not third-party plugins. They also do not affect Fender Studio Pro
plugins with a custom interface". A **"Colored"** option "links the Fender Studio
Pro plugin color to the Background and Arrangement settings." Settings can be
stored as **Presets** and shared or archived; "Dozens of presets are provided".
**[Reset]** returns colour balance and viewing modes to factory settings.

**MotionLab does:** Four global themes (CC-4), applied uniformly — including to
plug-in faces (`src/components/mixer/PluginFace.tsx`) and the score view — with no
independent sub-scopes and no colour-balance sliders. `usePrefsStore.reset()` is
surfaced as **"Reset preferences"** with the title attribute "Back to 100% scale
and the system theme". Related and beyond the reference: `Prefs.reduceMotion`
(default **false**), which stamps `data-reduce-motion` on the root and is exposed
as "Reduce motion — Beyond the system setting".

**Gap:** `PARTIAL` — global theming with a contrast mode and a motion control
(none of which the reference has); no per-scope light/dark, no colour balance, no
appearance presets.

## GO-5 · Keyboard Shortcuts

**FSP8 does:** "This panel lets you assign and change keyboard shortcuts for
features and functions."

**MotionLab does:** Present, in Preferences under **"Key commands"** —
`src/components/settings/KeyCommands.tsx`, backed by `useKeymapStore`
(`src/state/keymapStore.ts`, localStorage key `motionlab.keymap.v1`). The design is
worth noting for parity quality: `SHORTCUTS` in `src/app/shortcuts.ts` is "the
default map and the documentation of record", and the store holds **only what the
user changed**, "so a default that moves in a later release moves for everyone who
never touched it". Rebinding is implemented as a translation to the action's
default combo rather than a dispatcher rewrite. Conflicts are resolved by
steal-and-clear: "Binding a combo takes it from whoever had it: two actions on one
key is never what the user meant, and silently ignoring the second is worse."
`resetAll()` exists.

**Gap:** `PARITY`.

## GO-6 · Network ▸ remote-control discovery

**FSP8 does:** "Toggle the **'Allow remote control apps to discover this DAW'**
option on to let compatible networked controllers connect."

**MotionLab does:** Absent — no network discovery service. Grepped `discover|
mDNS|bonjour` — no hits.

**Gap:** `DIVERGENT-BY-DESIGN` — a page cannot advertise a LAN service. (A
WebSocket/WebRTC companion is conceivable but is a different architecture.)

## GO-7 · Touch Input

**FSP8 does:** "you can **enable multi-touch operation** (if you have a compatible
display attached to your system), as well as **specify which monitor is to be used
for touch input**. To specify the current monitor, click the **[This]** button."

**MotionLab does:** Touch is always on and per-viewport; there is no monitor
concept in a browser tab. Layout adapts via `PhoneLayout` / `TabletLayout` /
`DesktopLayout`, with `uiStore.forcedLayout: 'phone' | null` as a QA/testing
override (`src/state/uiStore.ts:71`).

**Gap:** `DIVERGENT-BY-DESIGN`.

## GO-8 · Preferences MotionLab has that the reference's General tab does not

Recorded for completeness, since the directive asks for the full option set on
both sides. From `Prefs` (`src/state/prefsStore.ts`), with defaults from
`DEFAULT_PREFS`:

| Preference           | Type / range                             | Default  | Where surfaced                            |
| -------------------- | ---------------------------------------- | -------- | ----------------------------------------- |
| `theme`              | `system` / `dark` / `light` / `contrast` | `system` | Appearance                                |
| `uiScale`            | 0.85–1.4, clamped, 2 dp                  | `1`      | Appearance → Interface scale              |
| `meterScale`         | `peak` / `rms`                           | `peak`   | Metering & time → Meter reading           |
| `meterFallDbPerSec`  | slider 8–60, step 1                      | `26`     | Metering & time → Meter fall              |
| `followPlayhead`     | boolean                                  | `true`   | Editing → Follow the playhead             |
| `primaryTimeDisplay` | `bbt` / `clock`                          | `bbt`    | Metering & time                           |
| `confirmDestructive` | boolean                                  | `true`   | Editing → Confirm before deleting a track |
| `reduceMotion`       | boolean                                  | `false`  | Appearance → Reduce motion                |

Two design notes that bear on parity reviews. First, `meterScale` is deliberately
two-valued, and the comment says why a third was refused: "A BS.1770 loudness
reading needs K-weighting, a gate and a three-second window; the Release page
measures that properly and a channel strip does not measure it at all, so a 'LUFS'
option here could only ever have relabelled the peak meter." Second, `readStored()`
re-validates on load — an unknown `theme` falls back to `system`, and `meterScale`
is forced to `'peak'` unless it is exactly `'rms'`, so "A project saved while the
third option existed must not load with a meter mode nothing implements."

Storage: `localStorage` key `motionlab.prefs.v1`, chosen over IndexedDB because
"These are read before the first paint … a theme that arrives one frame late is a
visible flash."

**Gap:** N/A (MotionLab-only surface).

---

# 11. Additional Options

_(FSP8 manual p. 37; extract lines 1742–1748)_

## AO-1 · The tab cross-reference

**FSP8 does:** Not a settings group of its own — a signpost listing the remaining
tabs in the Options dialog and where each is documented:

- **Locations** → Managing Your Content (§5 here)
- **Audio Setup** → Set Up Your Audio Device (§2 here)
- **External Devices** → Set Up Your MIDI Devices (§4 here)
- **Advanced** → Advanced Options (§13 here)

So the full Options dialog tab set for FSP8 is: **General, Locations, Audio Setup,
External Devices, Advanced** (plus Session Setup reachable from the same page).

**MotionLab does:** The Preferences sheet has six sections in one scrolling
column, not tabs: **Appearance**, **Metering & time**, **Editing**, **Key
commands**, **Control Link**, **Audio**.

**Gap:** `PARTIAL` — three of the five reference tabs have no MotionLab section at
all (Locations, Audio Setup as a device dialog, External Devices), and two
MotionLab sections have no reference counterpart (Metering & time, Control Link).

---

# 12. Recovery Options

_(FSP8 manual pp. 37–39; extract lines 1750–1793)_

## RO-1 · The Safety Options dialog

**FSP8 does:** After a crash, a **Safety Options** dialog appears on next launch:
"you can choose to select or deselect **startup activations of Plug-ins by type**
in an effort to troubleshoot what might be causing your crash." It can be forced:
"**pressing and holding [Shift] during … startup**." It also appears after a hard
freeze requiring force-quit.

**MotionLab does:** Absent — no crash-detection-on-boot and no safe-mode. Grepped
`safe mode|safeMode|safety options` — no hits. (Note the enabling condition is
partly present: `getDbStatus()` and the diagnostics log survive a reload.)

**Gap:** `MISSING`. Not platform-blocked — a "last boot did not complete" flag in
localStorage plus a plug-in-disabled boot path is entirely implementable, and
relates directly to MC-8's missing blocklist.

## RO-2 · Crash recovery of unsaved work — **the one MotionLab does better**

**FSP8 does:** Autosave (MC-2) is the stated mitigation: "That's also why we have
auto-save."

**MotionLab does:** Two independent recovery paths.

1. **Project recovery.** Every save keeps the previous version; an unreadable
   current copy is met with `loadProjectBackup()` and the toast `"<name>" could
not be read — restored the previous saved version instead.`
   (`src/app/projectActions.ts:173–181`).
2. **Take recovery.** Interrupted recordings are stashed _during_ capture —
   `stashRecovery()` / `putRecovery()` in `src/audio/recorder.ts` and
   `src/persistence/mediaStore.ts` — scanned at startup into
   `inputStore.pendingRecoveries`, and surfaced by
   `src/components/recording/RecoveryPanel.tsx` as "Unfinished recordings (n)"
   with the explanation "These takes were captured but never made it onto the
   timeline. Recovering adds one to the current project." Each row offers
   **Recover** and **Discard**, plus **Discard all** when more than one is
   pending. Discarding is confirmed with a danger dialog reading "This permanently
   deletes the audio." The panel renders nothing when `pendingRecoveries === 0`,
   "so it never occupies space in the normal case."

**Gap:** `PARITY`, and richer — the reference documents no per-take recovery.

## RO-3 · Create Diagnostics Report

**FSP8 does:** A **Create Diagnostics Report** button on the bottom left of the
Recovery Options dialog, also reachable from the **Help** menu at any time.
Produces a **.Zip** to attach to a support ticket, containing, depending on
options: "Information about crashed and unexpected behavior", "Operating system
and hardware information", "A list of installed plug-ins", "Application log
files".

**MotionLab does:** Present and comparable in content, different in form.
`src/diagnostics/report.ts` builds a **plain-text** report explicitly "designed to
be copy-pasted into another AI conversation", surfaced by
`DiagnosticsPanel.tsx` / `DiagnosticsSheet.tsx` (`uiStore.diagnosticsOpen`).
Enumerated fields include: App version, Git commit, Build time, User agent,
Platform, Viewport, Online, PWA display mode, Service worker, AudioContext state,
Sample rate, Active audio sources, Transport, MIDI support, MIDI device, Project,
Tempo, Track count, Clip count, IndexedDB status, Mic permission, Input devices,
Recorder support, Recording state, Last record error, Last take, Open input
streams, Monitoring, Armed audio tracks, Project media refs, Stored media, Storage
used, Unrecovered takes, Decoded buffers, Missing media, Insert effects, Active
sends, Audio graph, Export status, Last export — plus layout report lines
(`src/diagnostics/layout.ts`). There is also an in-app smoke test (`SmokeResult` in
`src/state/diagnostics.ts`) and a command surface (`src/diagnostics/commands.ts`,
`DiagnosticCommands.tsx`).

**Gap:** `PARITY`. Format differs (text, not zip) for a good reason and the field
coverage is at least as complete for a web target.

## RO-4 · Open with Options

**FSP8 does:** "Right-clicking any document in the Start Page will present a
contextual menu that includes **'Open with Options…'** From here, you can choose
to enable or disable any plug-ins that might be causing issues."

**MotionLab does:** The Start page has per-project actions — open, duplicate
(`duplicateById`), delete (`deleteById`) — but no per-open plug-in gating.

**Gap:** `MISSING`. Same enabling work as RO-1.

## RO-5 · Document Profiling

**FSP8 does:** Two commands in the same contextual menu:

- **Profile Document Loading** — "will open the document with safety options and
  provide insights into plug-in load times."
- **Profile Document Saving** — "will provide similar insights related to the
  document's save."

**MotionLab does:** No load/save profiling. Related timing that _is_ logged:
`warmMedia()` reports `Preloaded <n> media file(s) for "<name>"`, and the
autosave/save path logs failures with reasons — but no durations and no
per-plug-in attribution.

**Gap:** `MISSING`.

---

# 13. Advanced Options — full enumeration

_(FSP8 manual pp. 40–43; extract lines 1795–2050)_
Path: `Studio Pro / Options / Advanced` (macOS `Preferences / Advanced`), eight
tabs. Note the manual's shortcut: "Many of the following options that pertain to
editing in Arrange view can be accessed and toggled on or off by clicking the
**Options** button in the Arrange view toolbar."

Every option is listed. Defaults are the manual's own words ("engaged by default"
/ "disengaged by default"); where the manual does not state one, the cell says so.

## 13.1 Advanced ▸ **Editing** tab

| #      | FSP8 option                                 | Default    | FSP8 behaviour                                                                                                                                                                                                                                                                                                                                      | MotionLab                                                                                                                                   | Gap                   |
| ------ | ------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| AX-E1  | **Enable Crosshair Cursor for Tools**       | engaged    | "a large, white, vertical-and-horizontal crosshair in the Arrange view that aids in displaying the exact position of the various mouse tools"                                                                                                                                                                                                       | Absent. `uiStore.tool: ArrangeTool` exists; no crosshair. Grepped `crosshair` — no hits                                                     | `MISSING`             |
| AX-E2  | **Locate When Clicked in Empty Space**      | disengaged | "allows the timeline cursor to be located based on clicking in empty space or clicking where there are no Events"                                                                                                                                                                                                                                   | Not exposed as an option; arrangement click behaviour is fixed                                                                              | `MISSING`             |
| AX-E3  | **Expand Layers After Recording Takes**     | engaged    | with _Record Takes To Layers_, "the layers of each recording take are shown as soon as recording stops"                                                                                                                                                                                                                                             | Take lanes exist (`src/components/arrangement/TakeLanes.tsx`); no expand-after-record preference                                            | `PARTIAL`             |
| AX-E4  | **Track/Channel names follow active Layer** | disengaged | "the name of the active Layer is displayed instead of the track name in the Track Header and corresponding Channel"                                                                                                                                                                                                                                 | Absent                                                                                                                                      | `MISSING`             |
| AX-E5  | **Apply Folder Track Color to Content**     | disengaged | "causes all content contained in a Folder Track to be color-coded with the same color you choose for the Folder Track"                                                                                                                                                                                                                              | Folder tracks exist (`TrackType` includes `folder`, plus `Track.folderId` and `Track.folded`); no colour propagation option                 | `MISSING`             |
| AX-E6  | **Colorize Track Controls**                 | disengaged | default state shows the track colour "in a small area in its controls"; engaged colours the whole control area                                                                                                                                                                                                                                      | Fixed appearance; no toggle                                                                                                                 | `MISSING`             |
| AX-E7  | **Auto-colorize Tracks and Layers**         | engaged    | "applies to importing files, when tracks are created without using the 'Add Tracks' dialog"                                                                                                                                                                                                                                                         | Templates assign colours (`TemplateTrack.color`); imports pick from `TRACK_COLORS`. Behaviour present, not optional                         | `PARTIAL`             |
| AX-E8  | **Show Channel Numbers in Tracks**          | disengaged | Tracks and Channels are numbered independently and can disagree; this marks each Track with its Channel number                                                                                                                                                                                                                                      | MotionLab has no separate channel numbering — one track is one channel                                                                      | `DIVERGENT-BY-DESIGN` |
| AX-E9  | **No Overlap When Editing Events**          | disengaged | "moving or pasting an Event over another Event deletes whatever is buried beneath, so there is no overlapping data (only the audio crossfades are preserved)"; a range including data outside an Event is treated as part of the Event and overwrites the identical range at the destination. Depends on _Cut long notes at part end_ for note data | Absent as an option                                                                                                                         | `MISSING`             |
| AX-E10 | **Show Event Names**                        | not stated | name labels inside each Event; "purely an aesthetic difference and does not change any functions"                                                                                                                                                                                                                                                   | Clip names always drawn (`ClipView.tsx`); no toggle                                                                                         | `PARTIAL`             |
| AX-E11 | **Show Envelopes on Instrument Parts**      | not stated | "overlays a graphic representation of controller activity (volume, sustain, etc.)"; disengage to display only notes                                                                                                                                                                                                                                 | Absent                                                                                                                                      | `MISSING`             |
| AX-E12 | **Show Chords on Events**                   | not stated | "adds an overlay to Audio Events in the Arrangement showing detected chords. This requires the track height to be set to Small or higher"                                                                                                                                                                                                           | Chord track exists (`ProjectData.chords`, `showChords` lane, default **false**) but no per-event chord overlay and no audio chord detection | `PARTIAL`             |
| AX-E13 | **Show Grid on Events**                     | disengaged | "enables the Timeline grid in the Arrange and Edit view to be seen on Events"                                                                                                                                                                                                                                                                       | Grid/snap exists (`uiStore.snap`, `uiStore.snapMode`); no on-event grid toggle                                                              | `PARTIAL`             |

## 13.2 Advanced ▸ **Automation** tab

| #     | FSP8 option                                                | Default                                      | FSP8 behaviour                                                                                                                                                                 | MotionLab                                                                                                                                                                                                                                     | Gap       |
| ----- | ---------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| AX-A1 | **Automation Follows Events**                              | engaged                                      | "automation envelopes lock to Events so that moving an Event with automation 'under' it also moves the automation"                                                             | Automation lanes exist (`Track.automation: AutomationLane[]`, `src/model/automation.ts`); no follow-events option found                                                                                                                       | `MISSING` |
| AX-A2 | **Disable Events Under Automation Envelopes**              | engaged                                      | "makes Events unavailable to the mouse tools while viewing an automation envelope, which helps prevent you from unintentionally editing underlying Events"                     | Absent; `uiStore.autoSel` selects automation points but events remain live                                                                                                                                                                    | `MISSING` |
| AX-A3 | **Automatically Create Automation Tracks for Channels**    | disabled                                     | "automatically adds an automation Track for every new FX Channel, Bus, or VCA Channel that you create in the Console"                                                          | Absent. All three channel types exist (`fx`, `bus`, `vca`)                                                                                                                                                                                    | `MISSING` |
| AX-A4 | **Automatically Add Envelopes for all Touched Parameters** | enabled                                      | "adds an automation envelope for any automation-friendly parameter when you touch its control"                                                                                 | Partially: `Track.automationMode` is `read` (default) / `touch` / `latch` / `off`, documented as "read (default) applies lanes; touch/latch also record control moves; off ignores lanes". Lane _creation_ on touch is the part not confirmed | `PARTIAL` |
| AX-A5 | **Reduction Level**                                        | not stated (must be **0%** for MPE fidelity) | "control the density of new automation data as it is written. This helps reduce the CPU load during playback… **this setting has no effect on existing automation envelopes**" | Absent. Grepped `reductionLevel                                                                                                                                                                                                               | thinning  | decimate` — no hits | `MISSING` |
| AX-A6 | **Default Envelopes for new Audio Tracks**                 | not stated                                   | selectors to "enable or disable **Volume**, **Pan**, and **Mute**" envelope creation per new track                                                                             | Absent                                                                                                                                                                                                                                        | `MISSING` |

## 13.3 Advanced ▸ **Audio** tab

| #     | FSP8 option                                           | Default    | FSP8 behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | MotionLab                                                                                                                                                                                                                                                                                                                   | Gap                                                                                                                                                                                  |
| ----- | ----------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AX-U1 | **Enable "Play Overlaps" for New Audio Tracks**       | disengaged | enables _Play Overlaps_ automatically on every newly created audio track                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Absent as a default-setter                                                                                                                                                                                                                                                                                                  | `MISSING`                                                                                                                                                                            |
| AX-U2 | **Enable "Layers Follow Events for New Tracks"**      | engaged    | new tracks default to layer audio following the Event above when moved; "When disabled, moving an Event with one or more Layers beneath it detaches that Event from the layers below, making it a permanent part of the primary Layer". Also per-track via the Inspector                                                                                                                                                                                                                                                                                                               | Absent                                                                                                                                                                                                                                                                                                                      | `MISSING`                                                                                                                                                                            |
| AX-U3 | **Use Cache for Timestretched Audio Files**           | engaged    | caches stretched renders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Present, unconditional**: `src/audio/stretchCache.ts`, cleared on project open (`clearStretchCache()` in `src/app/projectActions.ts`). No toggle                                                                                                                                                                          | `PARTIAL`                                                                                                                                                                            |
| AX-U4 | **Record Tempo Information to Audio Files**           | engaged    | "enables tempo tagging for any audio file recorded… The Session tempo at the time position of the recording is saved with the file, so that automatic timestretching can be accomplished. If another application has issues reading audio files from Fender Studio Pro, try disabling this option"                                                                                                                                                                                                                                                                                     | Absent. Recorded takes are Opus/AAC blobs with no tempo tag                                                                                                                                                                                                                                                                 | `MISSING`                                                                                                                                                                            |
| AX-U5 | **Use Dithering for Playback and Audio File Export**  | engaged    | "triangular dithering is applied when the audio signal's bit depth is reduced from a higher bit depth by a device or during file export. Turn this off if you would like to use a third-party dithering solution"                                                                                                                                                                                                                                                                                                                                                                      | **Present for export, and richer**: `ExportSettings.dither` is `none` / `tpdf` / `shaped`, default **`tpdf`** (`src/app/exportActions.ts:96`), implemented in `src/audio/encode/dither.ts`, disabled in the UI at 32-bit with the hint "Not needed at 32-bit". No playback-path dither (the graph is float32 to the device) | `PARITY` for export; playback dither `DIVERGENT-BY-DESIGN`                                                                                                                           |
| AX-U6 | **Use Realtime Processing to Update Mastering Files** | not stated | "ensures that real-time processing is used when the mastering file for a given Session is automatically updated. This is necessary when Sessions utilize certain devices, such as External Instruments, that require a real-time mixdown"                                                                                                                                                                                                                                                                                                                                              | N/A — no external instruments, and offline bounce parity is a protected invariant (`CLAUDE.md`, "What NOT to refactor": `src/audio/exportMix.ts` and the realtime engine build through the same `InsertChain`)                                                                                                              | `DIVERGENT-BY-DESIGN`                                                                                                                                                                |
| AX-U7 | **Pre-record Audio Input**                            | not stated | "creates a buffer of a length you can specify, which records continuously, even when the transport is stopped… Once recording concludes, the number of seconds of audio you've specified are available before the point at which recording started." Reveal by "pulling the Event-start handle to the left". Data is collected in the Input Channels "as long as physical inputs are connected". On re-record to the same Track, "the Pre-Record data is limited to the last recording's end, so that data is not repeated and a seamless join between the two recordings is possible" | Absent for audio. Grepped `preRecord                                                                                                                                                                                                                                                                                        | pre-record`— no hits (note`ProjectData.preRoll` is a different thing: bars of transport roll before the punch point). **MIDI has an equivalent in the reference only** — see AX-M5   | `MISSING`          |
| AX-U8 | **Record Offset** (samples)                           | not stated | "input a value, **in samples**, by which any recorded audio should be offset in the arrangement, thereby compensating for device/driver latency"                                                                                                                                                                                                                                                                                                                                                                                                                                       | Absent. Grepped `recordOffset                                                                                                                                                                                                                                                                                               | record offset` — no hits. **This is the manual latency-compensation escape hatch and MotionLab has none**, while also having no automatic compensation and no latency readout (AD-6) | `MISSING` — **P0** |
| AX-U9 | **Ignore Audio Device Timestamps** (Windows only)     | engaged    | "uses the system clock by default because some ASIO drivers have incorrect timestamps. This setting can be disengaged, but if you experience erratic behavior such as a jumping playback cursor, re-enable this setting"                                                                                                                                                                                                                                                                                                                                                               | N/A — the `AudioContext` clock is the only clock                                                                                                                                                                                                                                                                            | `DIVERGENT-BY-DESIGN`                                                                                                                                                                |

## 13.4 Advanced ▸ **MIDI** tab

| #     | FSP8 option                        | Default     | FSP8 behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | MotionLab                                                                                                                         | Gap                   |
| ----- | ---------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| AX-M1 | **Timecode Follows Loop**          | engaged     | "allows MIDI Timecode to remain in sync when Loop is active… With this disengaged, MIDI Timecode continues to run linearly (counting up) while the transport is looping"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | N/A — no MTC                                                                                                                      | `DIVERGENT-BY-DESIGN` |
| AX-M2 | **Reveal Precount Notes**          | disengaged  | "Engage this option to retain any MIDI notes played during the count-in when Precount is enabled. This can be helpful when playing in parts that start just before the downbeat"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Absent. Count-in exists (see §14) but notes played during it are not retained. Grepped `precount` — no hits                       | `MISSING`             |
| AX-M3 | **Chase Long Notes**               | engaged     | "if playback starts after a note start, the note is played as though its start time were at the position at which playback started. For instance, if a synth pad note starts at bar 1 and lasts through bar 8, and playback is started at bar 4, the note plays from bar 4… With this option disengaged… the note would not play at all"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Behaviour not confirmed as an option. `src/audio/heldNotes.ts` and `src/audio/notePipeline.ts` manage held notes; no chase toggle | `PARTIAL`             |
| AX-M4 | **Cut Long Notes at Part End**     | not engaged | "notes are cut at the end of a Part where it would otherwise extend beyond the Part end. This effectively places the note-off at the Part End." Also the precondition for AX-E9's note handling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Absent as an option                                                                                                               | `MISSING`             |
| AX-M5 | **Enable Retrospective Recording** | engaged     | "all incoming MIDI data is captured for each Track, even when not recording. This buffer can be recalled and placed at the desired location." Full behaviour in _Fundamentals_ (extract 2054–2090): an independent buffer **per Track**, active when a Track is record-armed or monitored; with the transport **playing** events are stored at the correct Session location with Input Quantize applied, with the transport **stopped** they are stored relative to each other; "the buffer does not combine" the two modes — "As soon as an event is received in one mode, the other mode will always delete the contents of the buffer." Recall via *_[Shift]+[NumPad_]**, right-click the Track control area → "Recall Retrospective Recording", or the Inspector button; recalled events use the standard recording options (Replace, Takes to Layers, etc.) and the key command is rebindable | Absent. `src/audio/midiRecorder.ts` records only during an armed take                                                             | `MISSING`             |
| AX-M6 | **Record Offset** (milliseconds)   | not stated  | "input a value, **in milliseconds**, by which any recorded musical performance should be offset in the arrangement, thereby compensating for device/driver latency"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Absent                                                                                                                            | `MISSING`             |

## 13.5 Advanced ▸ **Console** tab

| #      | FSP8 option                                              | Default    | FSP8 behaviour                                                                                                                                                                                                                                                                                                                                                                    | MotionLab                                                                                                                                                                                                                                        | Gap                                    |
| ------ | -------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| AX-C1  | **Enable Undo**                                          | not stated | "allow undo for changes in the Console, such as fader moves and channel mutes"                                                                                                                                                                                                                                                                                                    | Undo covers mixer changes; not optional. `Prefs.confirmDestructive` (default **true**) is a different guard, hinted "Clip edits are not asked about — undo covers those"                                                                         | `PARTIAL`                              |
| AX-C2  | **Colorize Channel Strips**                              | not stated | "apply channel color coding to full channel strips… Normally the color only shows on the channel labels"                                                                                                                                                                                                                                                                          | Fixed. `ChannelStrip.tsx` uses `track.color`; no toggle                                                                                                                                                                                          | `MISSING`                              |
| AX-C3  | **Colorize Plug-in Header**                              | not stated | "apply channel color coding to the open editor window of a plug-in. This is handy when the same plug-in is being used for several Console Channels"                                                                                                                                                                                                                               | Absent; `PluginWindow.tsx` / `PluginFace.tsx` do not tint by channel                                                                                                                                                                             | `MISSING`                              |
| AX-C4  | **Auto-expand Selected Channel**                         | not stated | "Double-click the first Channel to expand it, and when the next Channel is selected… The currently selected channel auto-expands, and the previously selected channel collapses. If you hold [Alt]/[Option] and click the second Channel, the previous Channel does not collapse"                                                                                                 | `uiStore.channelOverview` toggles an overview; no auto-expand-on-select                                                                                                                                                                          | `MISSING`                              |
| AX-C5  | **Automatically create buses for multi-out instruments** | enabled    | "an Instrument Bus is created automatically when [multi-out] instruments are inserted to a Session"                                                                                                                                                                                                                                                                               | N/A — no multi-out instruments; the drum rack sums to one channel                                                                                                                                                                                | `DIVERGENT-BY-DESIGN`                  |
| AX-C6  | **Fader Mode**                                           | not stated | mouse behaviour for channel faders: **Touch** = "require clicking on the fader handle itself before dragging"; **Jump** = "allow clicking anywhere on the travel of the fader to set its position"                                                                                                                                                                                | Fixed behaviour in `src/components/common/widgets.tsx`; no mode preference                                                                                                                                                                       | `MISSING`                              |
| AX-C7  | **Plug-In Menu**                                         | not stated | style of local plug-in menus in Console, Inspector and Channel Editor: **Basic** = "a simplified list of Plug-Ins sorted by folder (including custom user folders)"; **Advanced** = "an expanded browser-style view with search and sort options". "Changing this option changes the appearance of all local Plug-In menus throughout the Console"                                | One menu style                                                                                                                                                                                                                                   | `MISSING`                              |
| AX-C8  | **Audio Input follows Selection**                        | not stated | "automatically engage Record and Monitor mode for any Audio Track you select"                                                                                                                                                                                                                                                                                                     | Absent; arm and monitor are explicit per track                                                                                                                                                                                                   | `MISSING`                              |
| AX-C9  | **Instrument Input follows Selection**                   | not stated | same for Instrument Tracks                                                                                                                                                                                                                                                                                                                                                        | Absent — **but the routing fallback is equivalent in spirit**: `midiTargetTrackIds()` falls back to the _selected_ track when nothing is armed (`src/audio/midi.ts:60–64`), so selecting an instrument track makes it playable without arming it | `PARTIAL`                              |
| AX-C10 | **Solo Follows Selection**                               | not stated | "once a track is soloed, selecting a different track causes the newly selected track to be soloed. When… disabled, tracks stay soloed until solo is disengaged"                                                                                                                                                                                                                   | Absent (behaviour is the disabled case). Note `Track.soloSafe` exists — "never silenced by another track's solo (reverb returns, talkback)"                                                                                                      | `MISSING`                              |
| AX-C11 | **Channel Editor follows Selection**                     | engaged    | "causes currently viewable channel devices, such as virtual effects or instruments, to automatically switch when a Channel is selected. This ensures you are only viewing the devices related to the selected Channel"                                                                                                                                                            | Behaviour is present and unconditional — `uiStore.openDevice` and the inspector follow `selectedTrackId`                                                                                                                                         | `PARTIAL` (right behaviour, no toggle) |
| AX-C12 | **Audio Track Monitoring Follows Record**                | not stated | monitoring enables automatically when record is enabled on an audio track                                                                                                                                                                                                                                                                                                         | Absent — `armed` and `monitoring` are independent booleans on `Track` and independent buttons in `TrackInputControls`                                                                                                                            | `MISSING`                              |
| AX-C13 | **Instrument Track Monitoring Follows Record**           | not stated | same for instrument tracks                                                                                                                                                                                                                                                                                                                                                        | Absent (instrument tracks always sound when targeted)                                                                                                                                                                                            | `PARTIAL`                              |
| AX-C14 | **Audio Track Monitoring Mutes Playback (Tape Style)**   | not stated | "mutes playback of any pre-existing audio on Audio Tracks that have monitoring enabled"                                                                                                                                                                                                                                                                                           | Absent                                                                                                                                                                                                                                           | `MISSING`                              |
| AX-C15 | **Cue Mix Mute Follows Channel**                         | not stated | "mute all other tracks within a Cue Mix when a channel in that mix is soloed. Disable this option to cause other channels in the Cue Mix to continue playing when a channel within that mix is soloed." Consequence when disabled: "Cue Mix sends are not available in buses and FX channels. In this state, Cue Mix sends on channels are routed directly to the Cue Mix output" | Related but not equivalent: `CueMix.ignoreSolo: boolean` (`src/model/types.ts:385`), commented "a cue is a monitor path: solo on the main mix should not silence it". That is the _disabled_ case, made per-cue rather than global               | `PARTIAL`                              |

## 13.6 Advanced ▸ **Synchronization** tab

| #     | FSP8 option                                | Default    | FSP8 behaviour                                                                                                                                                                                                                                                                                                                                                                  | MotionLab                        | Gap                         |
| ----- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------- |
| AX-S1 | **Sync to External Devices**               | not stated | "make Fender Studio Pro follow incoming MIDI Time Code (MTC). Note that some MIDI devices only transmit MIDI clock data, not MTC. Fender Studio Pro requires a greater degree of accuracy than a simple MIDI clock can provide. For conversion from SMPTE, an outboard synchronizer is required. For additional accuracy, using an external word clock (master) is recommended" | Absent. Grepped `MTC             | MIDI Time Code` — zero hits | `MISSING`                                                                               |
| AX-S2 | **MIDI Time Code** (device selector)       | not stated | "Select the device that will receive MIDI Time Code (MTC). The gray field to the right of the device name indicates the current status of MTC transmission"                                                                                                                                                                                                                     | Absent (needs MIDI output, MD-6) | `MISSING`                   |
| AX-S3 | **MIDI Machine Control** (device selector) | not stated | "Select the device that will receive MIDI Machine Control (MMC)"                                                                                                                                                                                                                                                                                                                | Absent                           | `MISSING`                   |
| AX-S4 | **Activate Ableton Link**                  | off        | "synchronizes musical beat, tempo, and phase across multiple applications running on one or more devices… When starting playback from a Link peer's device (not Fender Studio Pro), tempo… is synchronized to other peers, **and the tempo track is disabled**"                                                                                                                 | Absent. Grepped `Ableton         | Link peer` — zero hits      | `DIVERGENT-BY-DESIGN` (the protocol is UDP multicast on the LAN; a page cannot join it) |
| AX-S5 | **Synchronize Start/Stop**                 | off        | "synchronize start or stop transport with other peers who also have the feature enabled. Start/stop state changes only follow user actions." Indicator: "a blue circle spinning around the On/Off button within the Transport Controls"                                                                                                                                         | Absent                           | `DIVERGENT-BY-DESIGN`       |

## 13.7 Advanced ▸ **Services** tab

| #     | FSP8 option                              | Default     | FSP8 behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MotionLab                                                                                                                                       | Gap       |
| ----- | ---------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| AX-V1 | **Services** (per-module enable/disable) | all enabled | "selectively enable and disable particular services, or modules, that enable specific features. This may be helpful when troubleshooting. For instance, if an ARA plug-in seems to be causing a problem, you can disable the ARA service." Procedure: Services tab → click the confirmation button, "paying special attention to the disclaimer message" → select a service → **Disable**. "**You must restart Fender Studio Pro for these changes to take effect.**" Re-enabling is symmetric and also needs a restart | Absent. The nearest thing is the diagnostics command surface (`src/diagnostics/commands.ts`) which can exercise subsystems but not disable them | `MISSING` |

Note the restart requirement — this and AX-V1 are the **only** settings in the
whole chapter that the manual explicitly says need an application restart.
Everything else (device, buffer size, dropout protection, all Advanced toggles)
takes effect live or on next use. That answers the directive's "what requires a
restart vs takes effect live" question directly: **almost nothing requires a
restart; Services is the exception**, with sample rate a near-miss ("The desired
sample rate should be set **before creating a New Session**", NS-3 — an ordering
constraint rather than a restart).

## 13.8 Advanced ▸ **Video** tab

| #     | FSP8 option                                                              | Default    | FSP8 behaviour                                                                                                                                                               | MotionLab                        | Gap       |
| ----- | ------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------- |
| AX-W1 | **Set Session frame rate to video frame rate when importing video file** | not stated | "an especially helpful option when you want to compose a soundtrack while viewing the video"                                                                                 | Absent — no video support at all | `MISSING` |
| AX-W2 | **Automatically create audio track for sound from video**                | not stated | "gives you the option to edit the video audio like any other audio event in the arranger window. Otherwise, the video's audio file is restricted within the Audio Sub-Track" | Absent                           | `MISSING` |

---

# 14. Metronome and count-in

The directive asks for metronome settings "if covered here". **They are almost
entirely not covered in the Setup chapter.** The only metronome-adjacent option in
lines 719–2090 is **AX-M2 Reveal Precount Notes** (extract 1919–1920), which
governs whether MIDI notes played during the count-in are retained. Metronome
level, sound, and count-in bar count are documented elsewhere in the manual, not
in this chapter, so no parity claim is made for them here.

For the record, MotionLab's metronome/count-in surface, so the next analyst does
not re-derive it:

| Item                       | MotionLab                                                                                                                                                  | Where                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Metronome on/off           | `ProjectData.metronome: boolean`                                                                                                                           | `src/model/types.ts:713`                                                                                                  |
| Click level                | `ProjectData.clickLevel?: number` (linear)                                                                                                                 | `src/model/types.ts:752`                                                                                                  |
| Click only while recording | `ProjectData.clickRecordOnly?: boolean`                                                                                                                    | `src/model/types.ts:754`                                                                                                  |
| Count-in bars              | `ProjectData.countIn?: number`, clamped **0–8**; UI offers Off / 1 bar / 2 bars                                                                            | `setCountInBars()` / `getCountInBars()`, `src/audio/recordingController.ts:39–48`; select in `RecordControls.tsx:216–228` |
| Pre-roll                   | `ProjectData.preRoll?: number` (bars before the punch point)                                                                                               | `src/model/types.ts`                                                                                                      |
| Punch region               | `ProjectData.punch?: { enabled, start, end }`                                                                                                              | `src/model/types.ts`                                                                                                      |
| Click scheduling           | Counts the signature's **denominator**, not quarter notes — 6/8 is called out in the comment; accent on the bar line                                       | `src/audio/scheduler.ts:94–104`                                                                                           |
| Click routing              | Joins **after** the master analyser, straight at `ctx.destination`, "so it is never compressed, never metered as programme, and never present in a bounce" | `src/audio/engine.ts` `buildMasterChain()`                                                                                |

One parity-relevant note from the code: `setCountInBars` carries a comment
recording a bug of exactly the class `CLAUDE.md` warns about — the count-in was
"both: a field the transport wrote and a module-level number the recorder read, so
changing the count-in from the transport changed nothing about a recording."
Single source of truth is now the project.

---

# 15. P0 register — the gaps the directive asked to weight

Ordered by consequence, not by section number.

| Rank | Gap                                                                                                                                                                                                  | Class                              | Where a fix would start                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | **No software-I/O channel layer** (IO-1 … IO-8). No named input channels, no mono/stereo channel creation, no hardware→software matrix, no `Input L+R` / `Input L` / `Input R` / `Main Out` defaults | `MISSING`                          | New model type (generic "Input Bus"), per-machine device binding, a setup surface. Pure software; no platform blocker |
| 2    | **Track input is a raw browser `deviceId`** — origin-scoped, machine-specific, rotates on site-data clear; saved into the project and silently unresolvable elsewhere                                | `MISSING`                          | `Track.inputDeviceId` (`src/model/types.ts:181`) should reference a named bus, not a device                           |
| 3    | **No output device selection** (AD-3)                                                                                                                                                                | `MISSING`                          | `AudioContext({ sinkId })` / `setSinkId`, feature-detected, in a device section of Preferences                        |
| 4    | **No latency figure anywhere** (AD-6, AD-12) — the app cannot tell a user what latency they are tracking at                                                                                          | `MISSING`                          | `ctx.baseLatency + ctx.outputLatency`, displayed in Preferences and diagnostics                                       |
| 5    | **No record offset / latency compensation** (AX-U8, AX-M6) — no automatic compensation _and_ no manual escape hatch                                                                                  | `MISSING`                          | Samples-or-ms offset applied at `captureWindow()` in `src/audio/recordingController.ts`                               |
| 6    | **Stale saved input device is silent** (IO-14) — a project opened elsewhere shows an unmatched `<select>` value with no explanation                                                                  | `PARTIAL`                          | `RecordControls.tsx:180–188`: detect an id absent from `devices` and render an explicit "device not present" state    |
| 7    | **Recording is lossy-compressed with no disclosure** (NS-4) — `MediaRecorder` Opus/AAC, while export offers 24-bit and 32-bit float                                                                  | `DIVERGENT-BY-DESIGN`, undisclosed | Say so in the record UI; investigate an `AudioWorklet` + WAV capture path for a lossless option                       |
| 8    | **Session sample rate is invisible** (NS-3) — the engine rate is browser-chosen and is never compared to the export rate                                                                             | `MISSING` (disclosure)             | Preferences already shows the rate; surface the mismatch at export                                                    |
| 9    | **No I/O configuration import/export** (AD-8, IO-9), incl. the replace-vs-add distinction                                                                                                            | `MISSING`                          | Follows item 1                                                                                                        |
| 10   | **No MIDI output** (MD-6) — blocks MTC, MMC, MIDI clock, control-surface feedback                                                                                                                    | `MISSING`                          | `access.outputs` in `src/audio/midi.ts`; nothing else is needed to start                                              |
| 11   | **No plug-in blocklist / safe mode** (MC-8, RO-1, RO-4) — a bad WAM module has no quarantine                                                                                                         | `MISSING`                          | A boot-completed flag plus a per-plug-in disable list                                                                 |
| 12   | **No retrospective MIDI recording** (AX-M5) and **no audio pre-record** (AX-U7)                                                                                                                      | `MISSING`                          | Both are ring buffers; the MIDI one is cheap and `src/audio/midiRecorder.ts` already sees every event                 |
| 13   | **No monitoring modes** (AD-10, AD-11, AD-14) — one software path, and the per-insert latency the 3 ms rule needs is already measured by `src/audio/latencyProbe.ts` but unused                      | `PARTIAL`                          | Consume `latencySamples()` to decide what stays in the monitor path                                                   |
| 14   | **MIDI device selection is not persisted** (MD-7) and there is no device identity (MD-11)                                                                                                            | `PARTIAL`                          | `transportStore.midiSelectedId` is session-only; persist by port name, not by id                                      |
| 15   | **Device setup is not in Preferences** (AD-2, MD-2) — audio device is in the track inspector, MIDI is in the instrument panel                                                                        | `PARTIAL`                          | A "Device Setup" section in `SettingsSheet.tsx`, without removing the in-context controls                             |

---

# 16. Where MotionLab already meets or beats the reference

Recorded so a remediation plan does not accidentally regress these.

| Area                                    | MotionLab behaviour                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Input device hot-unplug (IO-14)         | `devicechange` re-enumeration plus per-lease release plus per-track `ended` handling; the reference documents no audio-side equivalent       |
| Input failure messages (AD-16, IO-14)   | `describeGumError()` names six distinct `DOMException` cases in plain language                                                               |
| MIDI hot reconnect (MD-11)              | Automatic on `onstatechange`; the reference needs an explicit **Reconnect** command                                                          |
| Take recovery (RO-2)                    | Per-take stash during capture, scanned at boot, with Recover / Discard / Discard all; not in the reference                                   |
| Project backup on every save (RO-2)     | Previous version retained and offered when the current copy will not parse                                                                   |
| Diagnostics report (RO-3)               | ~40 enumerated fields plus a smoke test and layout report                                                                                    |
| Autosave (MC-2)                         | Debounced 1500 ms plus three flush points plus loud failure reporting                                                                        |
| Key commands (GO-5)                     | Overrides-only store, steal-and-clear conflict resolution, defaults that can move between releases                                           |
| Interface scale (GO-3)                  | 0.85–1.4 continuous UI scaling; no counterpart in the reference                                                                              |
| Contrast theme and Reduce motion (GO-4) | Two accessibility affordances the reference's Appearance tab does not have                                                                   |
| Templates (IO-10, NS-1)                 | Starting sessions with tracks, routing, inserts, sends and arm state — richer than the reference's New Document dialog, except for I/O       |
| Insert latency measurement (AD-11)      | `latencyProbe.ts` measures rather than assumes; the data a 3 ms monitoring tier needs already exists                                         |
| Export options (NS-4, AX-U5)            | Format, bit depth incl. 32-bit float, sample rate, three dither modes, normalisation to dBTP, trim, tail, stems/tracks scope, cue-mix render |

---

_End of parity analysis — Setup chapter, extract lines 719–2090, read in full._
