# Third-Party Plugins

**Status:** research + implementation plan. Nothing here is built yet.
**Date:** 2026-08-22
**Scope:** what "support third-party plugins" can mean for a browser DAW, what we
should build, and in what order.

---

## 1. The honest answer to "we want VST"

We cannot load VST, VST3, AU, AAX or CLAP binaries. Not "not yet" — not at all,
in any browser, on any platform, by any technique available to a web page.

The reason is worth stating precisely, because it is the thing that decides
everything downstream:

- A VST is a **native shared library** (`.dll` / `.dylib` / `.so`) built for a
  CPU and an OS. It runs as machine code in the host process.
- A browser tab has no mechanism to load or execute a native shared library.
  There is no API for it, and there is no sandbox that could contain one. The
  whole security model of the web is that a page cannot execute arbitrary
  native code on the machine.
- This is not an omission browser vendors intend to fix. Being unable to run
  native code from a web page _is_ the feature.

So "VST in the browser" is a category error, and any vendor claiming otherwise
is doing one of two things: running the plugin somewhere else (a native
companion app or a server) and streaming audio, or using a different plugin
format that was designed for the web.

What is real:

1. **A web-native plugin format.** Plugins written as JavaScript/WebAssembly
   that the browser can genuinely run. There is a standard for this — Web Audio
   Modules 2.0 — and there are around 58 free plugins available today.
2. **A native bridge.** A small app the user installs, which hosts their real
   VSTs and streams audio to/from the browser over a local socket. Two shipping
   products already do this. It is a product in its own right, not a feature.

Everything below is about choosing between those and sequencing the work.

**Recommendation in one line:** implement Web Audio Modules 2.0 as our plugin
format, self-hosted and curated first, arbitrary URLs later; document the native
bridge as a future path and do not build it now.

---

## 2. Web Audio Modules (WAM) 2.0

### 2.1 What it is, and how alive it is

WAM 2.0 is an open plugin standard for the web, published in 2021 by a working
group centred on Université Côte d'Azur (Wimmics/GRAME) and independent authors.
It is the closest thing the web has to VST: plugins ship a JSON descriptor and
an ES module, hosts load them and get back an `AudioNode`.

Package state, read from the npm registry on 2026-08-22:

| Package                         | Latest          | Licence           | Last published |
| ------------------------------- | --------------- | ----------------- | -------------- |
| `@webaudiomodules/api`          | `2.0.0-alpha.6` | MIT               | 2023-03-06     |
| `@webaudiomodules/sdk`          | `0.0.12`        | MIT               | 2024-07-26     |
| `@webaudiomodules/sdk-parammgr` | `0.0.13`        | MIT               | 2024-02-24     |
| `burns-audio-wam` (25 plugins)  | `0.2.54`        | MIT               | 2024-03-05     |
| `wam-community` (58 plugins)    | `0.4.9`         | **none declared** | 2024-03-05     |

Read that honestly:

- **The API has been frozen since March 2023** and still carries an `alpha`
  version string. The SDK saw one maintenance release in July 2024. There has
  been no publish in roughly two years.
- That is _stability without momentum_. It is not abandonware — the spec is
  coherent, the SDK is small and readable (about 2,000 lines), the plugins work
  — but nobody should expect the standard to grow features on our schedule, and
  we should expect to own our copy of the SDK eventually.
- The upside of a frozen spec is that it cannot break us. The downside is that
  bugs will not be fixed upstream.

**Verdict on the standard: adopt it, but vendor it.** Pin the SDK, treat it as
source we maintain, and do not take a dependency on upstream ever shipping again.

### 2.2 The host-side contract (verified against SDK source, not docs)

Everything below was read out of `@webaudiomodules/api@2.0.0-alpha.6/src/types.d.ts`
and `@webaudiomodules/sdk@0.0.12/src/*.js`, because the published documentation
is out of date in at least one load-bearing place (see the `createInstance`
note).

**One-time, per `BaseAudioContext`:**

```js
import { initializeWamHost } from '@webaudiomodules/sdk';
const [groupId, groupKey] = await initializeWamHost(audioContext);
```

`initializeWamHost` stringifies two setup functions, wraps each in a Blob URL and
calls `audioContext.audioWorklet.addModule(url)`. That installs a `WamEnv`
singleton on the `AudioWorkletGlobalScope` as `globalThis.webAudioModules`, which
is how plugin processors find each other for event routing. It takes a
`BaseAudioContext`, so it works on an `OfflineAudioContext` too — this matters a
great deal in §4.2.

**Per plugin, per instance:**

```js
const { default: WAM } = await import(/* @vite-ignore */ pluginUrl);
if (typeof WAM !== 'function' || !WAM.isWebAudioModuleConstructor) throw …;
const wam = await WAM.createInstance(groupId, audioContext, initialState);
const node = wam.audioNode;   // a WamNode, which extends AudioNode
```

> **Trap:** the `api` README still documents `createInstance(audioCtx, initialState)`.
> The actual signature in `alpha.6` — in both `types.d.ts` and
> `sdk/src/WebAudioModule.js` — is `createInstance(groupId, audioContext, initialState)`.
> Follow the types, not the README.

**Audio graph.** `wam.audioNode` is an `AudioNode`. `upstream.connect(node)` and
`node.connect(downstream)` — nothing special. A WAM appears to the host as a
single node even when it is internally a subgraph.

**GUI.**

```js
const el = await wam.createGui(); // Promise<Element>, may be undefined
container.appendChild(el);
// later
el.remove();
wam.destroyGui(el);
```

The GUI is a plain DOM `Element` — not an iframe. It runs **in our page, with
our privileges**. See §4.4.

**State.**

```js
const blob = await node.getState(); // opaque, structured-cloneable
await node.setState(blob);
```

Opaque by design. We store it and hand it back; we never interpret it.

**Parameters.**

```js
const info = await node.getParameterInfo();
// Record<string, { id, label, type: 'float'|'int'|'boolean'|'choice',
//                  defaultValue, minValue, maxValue, discreteStep, exponent,
//                  choices: string[], units,
//                  normalize(v), denormalize(n), valueString(v) }>
await node.setParameterValues({ cutoff: { id: 'cutoff', value: 0.5, normalized: true } });
```

The descriptor is rich enough to build our own generic control surface and to
populate an automation lane with a real name, range, unit and formatter. Note
that `getParameterInfo`/`getParameterValues` are `async` and the API explicitly
warns they "should not be used in time-critical situations" — they are for
building UI and lanes, not for per-block automation.

**Automation and MIDI — the sample-accurate path.**

```js
node.scheduleEvents(
  { type: 'wam-automation', time: t, data: { id: 'cutoff', value: 0.7, normalized: true } },
  { type: 'wam-midi', time: t, data: { bytes: [0x90, 60, 100] } },
  {
    type: 'wam-transport',
    time: t,
    data: { currentBar, currentBarStarted, tempo, timeSigNumerator, timeSigDenominator, playing },
  },
);
node.clearEvents();
```

`time` is in `AudioContext` seconds. Events are queued **inside the processor**
and applied at sample position — this is the correct path for automation, and
critically it is the path that also works offline, because nothing depends on
the main thread being serviced during the render.

**Latency.** `await node.getCompensationDelay()`.

> **Trap:** the API is self-contradictory about units. `WamNode.getCompensationDelay`
> is documented "in samples"; `WamProcessor.getCompensationDelay` is documented
> "in seconds". The SDK's `WamNode` simply proxies the processor's raw number
> with no conversion. The unit is therefore whatever the plugin author believed.
> We must treat the value as a hint, sanity-check its magnitude, and never
> silently shift audio by it. See §6, risk R4.

**Teardown.** `node.destroy()` stops the processor and removes it from the WAM
event graph.

**Event routing between plugins.** `node.connectEvents(toInstanceId, output?)`
lets one WAM feed another's event stream (a sequencer driving a synth). We do not
need this for insert effects and should not implement it in stage 1.

### 2.3 What the host must provide

1. **`AudioWorklet` support.** Required. Note that **our engine uses no
   `AudioWorklet` today** — `grep -rn "audioWorklet" src/` returns nothing. Every
   node in `effectChain.ts` is a native Web Audio node. Adopting WAM introduces
   the audio-worklet thread to this codebase for the first time.
2. **`WamEnv` installed in the worklet global scope**, once per context, before
   any plugin is instantiated. This is `initializeWamHost` above.
3. **Dynamic ESM import** of an arbitrary URL. Vite must not try to resolve it:
   `import(/* @vite-ignore */ url)`.
4. **Plugins served as a directory, not a file.** Plugin bundles use
   `import.meta.url` to locate their own descriptor, worklet processor and GUI
   assets relative to the entry module. Rehosting `index.js` alone breaks them.
5. **CORS, if loading cross-origin.** The SDK's `_loadDescriptor` does a plain
   `fetch(descriptorUrl)` and `_loadGui` does a dynamic `import()`. Both are
   subject to CORS. A plugin host that does not send `Access-Control-Allow-Origin`
   cannot be loaded by us at all. Self-hosting sidesteps this entirely, which is
   one more argument for the curated shelf being stage 1.

### 2.4 Cross-origin isolation — the certainty you asked for

**We do not need `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy`.
Hosting WAM plugins does not require cross-origin isolation.**

This is not an inference from documentation; it is what the SDK source does.

`@webaudiomodules/sdk@0.0.12/src/WamProcessor.js`, line 81:

```js
this._useSab = !!useSab && !!globalThis.SharedArrayBuffer;
```

Two independent gates:

1. **`useSab`** arrives in `processorOptions` — the SAB transport is **opt-in by
   the plugin**, not a baseline requirement.
2. **`!!globalThis.SharedArrayBuffer`** — a feature test.

And the feature test is exactly the right one, because of how browsers gate SAB:
since Chrome 92 on desktop and Chrome 88 on Android, and correspondingly in
Firefox, **the `SharedArrayBuffer` constructor is hidden from the global object
unless the page is cross-origin isolated.** The V8/Mozilla rationale was
explicitly that exposing the constructor while `postMessage` of a SAB throws is
not web-compatible — so the global is absent rather than present-but-broken.

Therefore, on a page without COOP/COEP:

- `globalThis.SharedArrayBuffer` is `undefined` in both the window and the
  `AudioWorkletGlobalScope`.
- `_useSab` evaluates to `false` for every plugin, whatever it asked for.
- The SDK falls back to its `MessagePort` transport: `WamNode._onMessage`
  handles the plain `{ event }` branch instead of the `{ eventSab }` branch.
- Everything works. The only cost is that main-thread→audio-thread event
  delivery goes through `postMessage` rather than a lock-free ring buffer.

What that cost actually is, in our terms: **nothing that matters.** The SAB path
exists to make high-rate _live_ parameter streaming from a plugin GUI cheaper. Our
automation is scheduled ahead of time with explicit `time` values via
`scheduleEvents`, which is queued in the processor and is unaffected. Offline
rendering never uses the SAB path at all.

**What we avoid by not setting COOP/COEP** — and this is why the answer matters:

| Would break under `COEP: require-corp`                                          | Our exposure                                                                                                                                                         |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`)                      | Would need `crossorigin` + CORP headers from Google, which it does send — but every other cross-origin asset would need auditing                                     |
| Any cross-origin image, audio, or script without `Cross-Origin-Resource-Policy` | Blocked outright                                                                                                                                                     |
| **Loading plugins from third-party URLs**                                       | Ironic but real: under `require-corp`, a plugin host that does not send CORP/CORS becomes unloadable. COEP makes third-party plugin loading _harder_, not easier     |
| `window.open` / popups to other origins                                         | Severed by `COOP: same-origin`                                                                                                                                       |
| Service worker / PWA                                                            | The SW itself survives, but **every cross-origin response it caches** must satisfy CORP, and our `navigateFallback` and precache manifest would need re-verification |

So enabling cross-origin isolation would cost us real functionality and buy us a
micro-optimisation on a path we do not use. **Decision: do not set COOP/COEP.**

We should, however, **assert** the absence of isolation rather than assume it —
a future dependency could quietly enable it. Stage 1 includes a startup
diagnostic that logs `crossOriginIsolated` and warns if it ever becomes `true`
without us intending it, because that would change plugin behaviour underneath us.

### 2.5 Licensing

- **`@webaudiomodules/api` and `@webaudiomodules/sdk` are MIT.** Safe to vendor,
  modify and ship in a commercial product, with attribution.
- **`burns-audio-wam` is MIT** (25 plugins, `package.json` `"license": "MIT"`,
  repo `boourns/burns-audio-wam`). Safe to bundle with attribution.
- **`wam-community` declares no licence.** The npm package has no `license`
  field and the GitHub repo has no `LICENSE` file (verified: 404). It is an
  _aggregation_ repo — the licence of each plugin is whatever its own collection
  carries, and the aggregate carries none.
- **The `wimmics` collection is the one to be careful about.** Several of its
  plugins are Faust ports of DSP with its own provenance — `Grey Hole`,
  `OwlShimmer`, `KppFuzz`, `Temper` and others descend from Faust library code
  and third-party pedal models. Faust-derived DSP frequently inherits **GPL**,
  and some of the modelled devices carry trademark exposure ("Big Muff", "TS9
  Overdrive", "Vox Amp 30" are all named after commercial products).

**Rule for shipping:** we bundle _only_ plugins whose licence we have read and
recorded, per plugin, in a manifest. Stage 1 ships the MIT `burns-audio` effects
and nothing else. Anything else is user-loaded from a URL, where the user — not
us — is the one obtaining it. Do not bundle `wam-community` wholesale; besides
the licence question it is 186 MB unpacked.

### 2.6 Real plugins for a smoke test

58 plugins are indexed in `wam-community@0.4.9` at `dist/plugins.json`. The best
first targets are pure audio effects with no host-extension requirements:

| Plugin            | Path                                  | Why it is a good probe                                                                                        |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Simple Distortion | `burns-audio/distortion/index.js`     | MIT, tiny, waveshaper — trivially audible, easy to verify                                                     |
| Microverb         | `burns-audio/reverb/index.js`         | MIT, has a tail — proves our render tail handling                                                             |
| Simple Delay      | `burns-audio/delay/index.js`          | MIT, time-based — proves transport/tempo events                                                               |
| Simple EQ         | `burns-audio/simpleEQ/index.js`       | MIT, many parameters — proves the automation bridge                                                           |
| PingPongDelay     | `wimmics/pingpongdelay/dist/index.js` | Built from **native Web Audio nodes only** — isolates "is our host wiring right" from "does the worklet work" |
| QuadraFuzz        | `wimmics/quadrafuzz/dist/index.js`    | Multiband — a genuine CPU load test                                                                           |

I inspected the bundles: each embeds its own copy of the SDK (hence the
`SharedArrayBuffer` references, all behind the feature gate above), each calls
`audioWorklet.addModule`, and each uses `import.meta.url` twice to locate its own
assets. `pingpongdelay` uses no `setInterval` and two `requestAnimationFrame`
calls (GUI animation only) — i.e. these are well-behaved plugins whose DSP does
not depend on the main thread ticking. That is the property that makes offline
rendering viable, and §4.2 explains why we must verify it per plugin rather than
assume it.

---

## 3. Alternatives and complements

### 3.1 A plain ES module implementing our own interface

Load a URL, expect a default export matching a small interface of our own design
(`create(ctx) -> {input, output, params, getState, setState, dispose}`).

- **For:** trivial to implement — perhaps 150 lines. No SDK, no worklet global
  scope, no `WamEnv`. Full control of the contract. Debuggable.
- **Against:** it is a format with exactly zero plugins in it. Nobody has written
  for it and nobody will. It solves "let _us_ add DSP out-of-band", not "support
  third-party plugins", which is what the client asked for.

**Verdict: build now — but not as the answer.** Build it as the _internal seam_.
`EffectNode` already is very nearly this interface. What we actually need in
stage 1 is the ability for `InsertChain` to hold a node that was built
asynchronously and came from outside `buildEffectNode`'s switch. That seam is the
hard part, it is shared with WAM, and WAM then becomes one adapter behind it.
Building the seam first de-risks everything else.

### 3.2 Faust (`.dsp` → WebAssembly → AudioWorklet)

`@grame/faustwasm` is the Faust compiler itself compiled to WebAssembly. It runs
**in the browser**: hand it Faust source, get back a WASM module and an
`AudioWorkletNode`.

- **Version `0.16.7`, LGPL-3.0, published 2026-08-16 — six days ago.** Compare
  that with the WAM SDK's last publish two years ago. Faust is the _actively
  maintained_ half of the web audio plugin world right now.
- Can a user bring their own Faust code? **Yes, genuinely.** Paste `.dsp` source
  into a box, compile in-page, get a working insert. Faust also emits WAM
  bundles, so the two are complementary rather than competing.
- Costs: the compiler payload is **26.8 MB unpacked** — it must be lazy-loaded
  behind an explicit user action, never in the main bundle. LGPL-3.0 on the
  compiler means we link to it unmodified and keep it replaceable (dynamic
  import of an unmodified artefact satisfies this comfortably for a web app, but
  legal should confirm before ship). Compiled output is the user's own code.

**Verdict: build later — stage 5+, and it is the most interesting differentiator
here.** "Write a compressor in ten lines and drop it on a track" is a feature no
competitor at our tier has. But it is a _second plugin runtime_ on top of the
first, and shipping two runtimes before one is solid would be a mistake. It also
becomes much cheaper once the WAM work is done, because Faust can emit WAMs and
we would already host those.

### 3.3 A native bridge (companion app hosting real VSTs)

A small signed desktop app runs a real VST host, opens a WebSocket (or WebRTC
data channel) on `127.0.0.1`, and exchanges MIDI and PCM with the browser.

- **Feasible? Yes — it is a shipping product category.** Audiotool's "VST Bridge"
  and Amped Studio's "VST Remote" both do exactly this today, on Windows and
  macOS. Reported overhead is roughly 1–5 ms on top of the plugin's own latency.
- What it would take, honestly: a native app for Windows and macOS; **code
  signing and notarisation on both** (Apple notarisation is a recurring
  operational cost, not a one-off); an installer and an auto-update channel; a
  localhost TLS story or an origin-check handshake so any web page cannot drive
  the user's plugins; a protocol with buffer negotiation and clock sync; and a
  support burden that scales with the entire third-party plugin ecosystem's
  bugs, not ours. It also breaks the product promise — "MotionLab runs
  anywhere" stops being true for any project that uses it, and a project that
  opens on a phone will not sound the same.
- And the offline bounce becomes very hard: a faster-than-realtime render cannot
  be done through a realtime bridge without either a non-realtime protocol mode
  (which the plugin may not tolerate) or falling back to realtime capture.

**Verdict: do not build. Document as a future path.** It is the correct answer to
"I own £3,000 of plugins and want to use them", and we should say so plainly in
the FAQ rather than pretending WAM substitutes for it. Revisit only if paying
customers ask for it by name and are on desktop. If we ever do build it, the
`EffectNode` seam from stage 1 is where it plugs in — which is another reason to
get that seam right.

### 3.4 WCLAP (CLAP compiled to WebAssembly)

The CLAP ecosystem has a web initiative: a WCLAP is a CLAP module compiled to
`wasm32` that exports `clap_entry`, imports memory and exports a growable
function table so the host can patch in its own functions. Signalsmith Audio
maintains an example browser host that fetches the `.wasm`, builds an
`AudioWorkletProcessor` around it, and processes blocks. There is a draft
`clap.web/1` extension for web-based plugin UIs.

The catch: `free-audio/web-clap` describes itself as a _"sandbox repository for
drafting web-clap"_ — MIT, ~15 commits, aspirational language throughout, no
ratified spec, no production statement, and essentially no plugins distributed in
the format yet.

**Verdict: do not build. Watch it.** This is plausibly what replaces WAM in three
years, because it inherits CLAP's real plugin ecosystem and its authors are
active. Building on a draft with no plugins would be building on nothing. Revisit
when the spec is ratified _and_ a recognisable commercial plugin ships in the
format. Our `EffectNode` seam means adopting it later is an adapter, not a
rewrite.

### 3.5 Summary

| Option                   | Verdict          | Reason                                                                            |
| ------------------------ | ---------------- | --------------------------------------------------------------------------------- |
| Internal ES-module seam  | **Build now**    | It is the shared foundation; WAM, Faust and any future format are adapters on it  |
| WAM 2.0                  | **Build now**    | The only web plugin standard with real plugins; MIT; no COI needed                |
| Faust in-browser compile | **Build later**  | Actively maintained, real differentiator, but a second runtime and 27 MB          |
| Native VST bridge        | **Do not build** | Real but it is a separate product; breaks "anywhere"; wrecks the bounce guarantee |
| WCLAP                    | **Do not build** | Draft spec, no plugins, no ratification                                           |

---

## 4. What this means for our engine

Read alongside `src/audio/engine.ts`, `src/audio/effectChain.ts`,
`src/audio/exportMix.ts`, `src/audio/freeze.ts`, `src/model/effects.ts` and
`src/model/types.ts`.

### 4.1 Fitting the `EffectNode` contract

The good news: `EffectNode` (`src/audio/effectChain.ts:57`) is already almost the
right shape.

```ts
export interface EffectNode {
  id: string;
  kind: string;
  input: AudioNode;
  output: AudioNode;
  update(effect: Effect, bpm: number, bypass: boolean): void;
  gainReductionDb?(): number;
  tap?: AnalyserNode;
  sidechain?: AudioNode;
  setSidechain?(external: boolean): void;
  dispose(): void;
}
```

A WAM adapter maps onto it cleanly:

| Member                        | WAM mapping                                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input` / `output`            | **Not** `wam.audioNode` directly. We own a `GainNode` on each side and put the plugin between them. This gives us a stable identity across a plugin reload and — critically — a place to implement bypass                                        |
| `update(effect, bpm, bypass)` | Diff `effect.params` against last applied; push changes via `node.setParameterValues`. On `bpm` change, emit a `wam-transport` event. On `bypass`, crossfade our own wet/dry gains                                                               |
| `dispose()`                   | `node.destroy()`, `wam.destroyGui(el)` if a GUI is open, disconnect our two gains                                                                                                                                                                |
| `tap`                         | We can offer one: an `AnalyserNode` fed from our output gain, side-chained not in series. Free, and keeps the spectrum display working over plugins                                                                                              |
| `gainReductionDb`             | **Not implementable.** WAM has no standard gain-reduction report. Omit it; the meter shows nothing, which is honest                                                                                                                              |
| `sidechain` / `setSidechain`  | **Not implementable.** `WamIODescriptor` describes only `hasAudio/Midi/Sysex/Osc/Mpe/Automation` × `Input/Output` — there is no standard key input. Omit them. A WAM cannot be keyed from another channel. This is a real limitation to document |

Two things do **not** fit, and they are the actual work:

**(a) Bypass.** WAM 2.0 has no bypass concept. Our `InsertChain` passes `bypass`
into `update` and each builder handles it. For a WAM we must do it in the host:
carry a dry path around the plugin and crossfade. Note the existing comment in
`exportMix.ts` about bypass crossfades needing pre-roll to settle — the same
applies here, and our pre-roll machinery already covers it.

**(b) Asynchronous construction.** This is the one that touches everything.

```ts
// effectChain.ts — synchronous, today
this.nodes = effects.map((e) => buildEffectNode(this.ctx, e));
```

`InsertChain.rebuild()` is synchronous. `buildEffectNode` is synchronous.
`AudioEngine.syncGraph(p, initial): void` (`engine.ts:407`) is synchronous and
runs on **every** project-store change. WAM instantiation is `await`.

We must not make the graph build async. `exportMix.ts` already says why, and the
reason is exactly right:

> _"Media must already be decoded (`preloadForRender`) because the offline graph
> is built synchronously — an await mid-build would let the render start before
> every source is connected."_

**So we use the pattern the codebase already established for audio buffers.**
A plugin instance is a resource that is _resolved asynchronously ahead of time_
and then _looked up synchronously_ during the build, exactly like a decoded
`AudioBuffer` via `getBufferSync`. Concretely:

- A `PluginPool` keyed by `(contextId, effectId)` holding live instances.
- `preloadPlugins(project, ctx)` — async, instantiates anything missing.
- `getPluginSync(ctx, effectId)` — synchronous lookup during `rebuild`.
- If a plugin is not yet resolved, `buildEffectNode` returns a **pass-through**
  placeholder and the pool schedules a re-sync when it lands. Audio flows
  immediately; the plugin appears a moment later. Never a stall, never a gap.

This is the single most important design decision in the plan, and it is also
what makes the offline path work.

### 4.2 The offline bounce — the hard part

Our guarantee is that a bounce matches what was monitored. `exportMix.ts` earns
it by rebuilding the render graph from the _same primitives_ as the live engine —
same `InsertChain`, same `computeClipSchedule`, same `resolveChannels`. Adding a
plugin format that behaves differently offline would break the central promise of
the product.

**Can a WAM instantiate and render in an `OfflineAudioContext`? Yes — the
contract is offline-capable by construction.** The evidence, in descending order
of strength:

1. **The API is typed on `BaseAudioContext` throughout**, not `AudioContext`:
   `WebAudioModule.audioContext: BaseAudioContext`,
   `createInstance(groupId, audioContext: BaseAudioContext, …)`,
   `initializeWamHost(audioContext: BaseAudioContext, …)`. `OfflineAudioContext`
   inherits `audioWorklet` from `BaseAudioContext`, so `addModule` works.
2. **The SDK core has no realtime dependency.** I grepped it: no
   `new AudioContext()`, no `.resume()`, no `requestAnimationFrame` in the DSP
   path. `performance.now()` appears only for ID generation. The one
   `setInterval` is inside the SAB branch, which is dead for us (§2.4).
3. **The event path is sample-accurate in the processor.** `scheduleEvents` with
   an explicit `time` pushes onto `WamProcessor._eventQueue`, which is drained
   against sample position inside `process()`. Nothing requires the main thread
   to be serviced mid-render — which is the property that usually breaks worklets
   offline.
4. **Precedent.** WAM-studio, the reference WAM DAW from the same group, exports
   its final mix through `OfflineAudioContext`.

**But per-plugin correctness is not guaranteed, and nothing in the API lets us
detect it in advance.** A plugin is free to drive its own parameters from the
main thread on a `requestAnimationFrame` or `setInterval` tick — an LFO animated
by the GUI, a meter-driven auto-gain. Offline, the render completes faster than
wall-clock, those ticks never fire in step, and the plugin renders _differently
from what was monitored_ — silently, with no error. Our smoke-test plugins are
well-behaved (§2.6), but a plugin from an arbitrary URL is not something we can
promise anything about.

There is also a second-order risk: `addModule` must complete before
`startRendering()`, and each plugin instantiation is a separate `await`. For a
project with many plugin instances this adds real latency to the _start_ of an
export. Mitigated by module-level caching — `addModule` per context, ESM import
cached process-wide — but it must be measured.

**The options, judged:**

| Option                                  | Assessment                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Render offline like everything else** | Correct by default, deterministic, fast, reuses the whole existing renderer. Fails silently for a badly-behaved plugin                                                                                                                                                                                                                               |
| **Real-time capture as a fallback**     | Works for anything, but it is a _second renderer_. It would be slow (1× minimum), vulnerable to the tab being backgrounded (`exportMix.ts` calls this out as a reason it chose offline), and it introduces a second code path that can drift from the first — the exact failure the current architecture was built to prevent. **Do not build this** |
| **Per-track freeze**                    | We already have it (`src/audio/freeze.ts`). It prints through `renderProject` on a single-track project, so it is the _same_ renderer — no drift is possible. The print is a real 24-bit WAV the user can listen to, and mixer/sends/automation stay live                                                                                            |

**Recommendation — offline by default, freeze as the guarantee, parity as the
gate:**

1. **Render plugins offline, like everything else.** No second renderer.
2. **Add an automated parity probe.** After a plugin is first instantiated,
   render a short fixed stimulus through it twice — once realtime-captured, once
   offline — and compare. Cache the result against the plugin's identifier and
   version. This turns "we hope it renders correctly" into a measured fact, once
   per plugin, invisible to the user.
3. **If a plugin fails parity, mark it `print-required`.** The bounce then
   refuses to render it live and instead requires the track be frozen first — and
   the UI offers to do that in one click. The user gets a correct bounce either
   way; they just pay for it with a freeze on the tracks that need one.
4. **Never silently produce a wrong bounce.** If a `print-required` plugin is
   un-frozen at export time, the export sheet says so, names the track and the
   plugin, and offers "Freeze and export".

That gives us: the fast path for the 95% case, a deterministic correct path for
the rest, one renderer, and no new failure mode that ships silence.

### 4.3 Persistence, missing plugins, and orphaned automation

Three concrete problems in the current code.

**(a) The model is numbers-only.**

```ts
export interface Effect {
  id: string;
  kind: EffectKind; // a closed union
  bypass: boolean;
  params: Record<string, number>;
}
```

A plugin needs a URL, an identifier, a version, and an **opaque state blob** that
is not a number. So `Effect` gains an optional `plugin` field and `EffectKind`
gains `'wam'`:

```ts
export interface PluginRef {
  /** Stable plugin identity from its WamDescriptor, e.g. "com.sequencerParty.simpleDistortion". */
  identifier: string;
  /** Where it was loaded from. A shelf id ("shelf:distortion") or an absolute URL. */
  source: string;
  name: string;
  vendor: string;
  version: string;
  /** Opaque, from WamNode.getState(). We never interpret it. */
  state?: unknown;
  /** Cached parameter descriptors, so lanes and macros survive the plugin being absent. */
  paramCache?: PluginParamCache[];
}
```

`Effect.params` stays `Record<string, number>` and holds the plugin's parameter
values keyed by its own parameter ids. That keeps automation, macros and control
links working unchanged — they only ever see `fx:<effectId>:<paramKey>`.

**(b) A missing plugin currently vanishes silently — this must change.**

Today, `src/persistence/projectRepo.ts` filters effects on load:

```ts
.filter((e) => isRecord(e) && typeof e.id === 'string'
            && typeof e.kind === 'string' && isKnownEffect(e.kind))
```

and then `normaliseParams(kind, …)` (`src/model/effects.ts`) rebuilds `params`
from the spec, **keeping only keys the spec declares**. For a WAM, whose
parameters are discovered at runtime, that would delete every parameter value.

So the load path needs two changes:

1. `kind: 'wam'` must be _known_ (so the filter keeps it) but must **bypass
   `normaliseParams`** — its params are validated as "finite numbers", nothing
   more, because only the plugin knows their ranges.
2. A plugin that fails to load at runtime must become a **tombstone, not a
   deletion**. The `Effect` stays in the chain, in order, with its state blob and
   its parameter values intact. `buildEffectNode` returns a pass-through. The
   insert slot renders as a greyed strip reading _"Simple Distortion — not
   loaded"_ with the source URL and a Retry button.

That gives the required behaviour: **the project always opens, the user is always
told, and nothing is destroyed.** If the plugin becomes available later — the CDN
comes back, the user reconnects — a retry restores it with its saved state, because
we never threw the state away. This also protects against a project saved on a
machine with a plugin and opened on one without: on a phone, on a colleague's
laptop, in a browser with a stricter network policy.

The export path must refuse to silently bounce a project with tombstoned plugins:
the export sheet lists them and requires an explicit "Export without them".

**(c) Automation of a parameter the plugin no longer exposes.**

`findAutoParam` (`src/model/paramRegistry.ts:325`) is
`listAutoParams(track, project).find((p) => p.id === paramId)` — it returns
`undefined` for a parameter that no longer exists, and the existing consumers
(`Arrangement.tsx:120`, `macros.ts:47`, `controlLink.ts:89`) already handle
`undefined`. So the failure mode is **already safe** — the lane is simply not
found and is not applied.

What is missing is that the lane must not be _destroyed_, and the user must know.
Policy:

- **Never delete an orphaned lane.** A plugin updating from v1.2 to v1.3 and
  renaming a parameter must not silently drop the user's automation.
- `PluginRef.paramCache` retains each parameter's id, label, range and units from
  the last successful load. An orphaned lane therefore still renders with a real
  name and range — as _"Cutoff (not in this version)"_, drawn dimmed and marked
  inactive — rather than as an unnamed grey line.
- On load, diff the live `getParameterInfo()` against `paramCache` and report:
  _"Simple EQ updated: 2 automated parameters no longer exist."_ One toast, with
  a link to the lanes.
- Offer re-targeting: because we have the old descriptor and the new list, the
  lane's context menu can offer "Re-assign to…", and an exact-label match can be
  suggested first.
- A tombstoned plugin's lanes behave the same way: retained, dimmed, inactive.

### 4.4 Security

We would be loading and executing third-party code. The exposure must be stated
plainly, because the honest answer is _not_ "the browser sandbox handles it".

**What the browser sandbox does protect.** A WAM cannot read the filesystem,
cannot execute native code, cannot open a raw socket, cannot escape the tab. It
cannot see other origins' cookies or storage. It cannot read the user's
microphone without the permission prompt the user already answered for us. These
are strong guarantees and they are the reason this is tractable at all.

**What it does not protect — the real exposure.** A WAM's GUI is a DOM `Element`
appended to _our_ page, and its ES module executes in _our_ origin. It therefore
has, by default, everything our origin has:

- **Our IndexedDB** — every project and every media blob (`src/persistence/db.ts`,
  `mediaStore.ts`). A malicious plugin could read or destroy the user's work.
- **Our `localStorage`, our service worker registration, our `fetch` credentials.**
- **The DOM.** It can read and rewrite any part of our UI, including anything the
  user types.
- **Exfiltration.** It can `fetch()` anywhere. There is no same-origin restriction
  on outbound requests to a permissive endpoint.
- **Denial of service.** An infinite loop in `process()` kills the audio thread
  for the whole tab. This is the _likely_ failure, far more than malice.

**What we should allow, and how to contain it.**

1. **Curated, self-hosted shelf is the default and the only thing available in
   stage 1.** We serve the bytes, we read the licence, we pin the version. The
   user is not trusting a stranger; they are trusting us, which is a trust they
   already extended.
2. **A Content-Security-Policy, which we do not have today.** `grep` finds no CSP
   anywhere in the repo. We should add one _before_ shipping plugins, not after.
   `script-src 'self'` plus an explicit allowlist for plugin origins turns
   "any URL" into "URLs we permit", and `connect-src` limits exfiltration. This
   is the single highest-value security control available to us and it is cheap.
3. **Do not implement arbitrary-URL loading until stage 5**, and when we do, gate
   it behind a real consent dialogue, not a checkbox.
4. **Consider an iframe-sandboxed GUI later.** The _audio_ side of a WAM cannot be
   isolated — an `AudioWorkletProcessor` must share our context. But the GUI could
   be hosted in a `sandbox`ed cross-origin iframe communicating over
   `postMessage`. This breaks the WAM contract (`createGui` returns an `Element`
   for direct insertion), so it would be a deliberate deviation, and it should be
   evaluated only if we ever open the door to untrusted plugins at scale.
   **It does not remove the exposure**, because the module itself still runs in
   our origin — it only limits the GUI's DOM access. Do not oversell it.

**What the UI must tell the user before loading a plugin from a URL they typed.**
Not a EULA. A short, specific, honest dialogue that names the actual risk:

> **Load a plugin from the internet?**
>
> `https://example.com/plugins/thing/index.js`
>
> This plugin's code will run inside MotionLab with the same access
> MotionLab has. It can read and change **your projects and recordings**,
> and it can send data over the internet.
>
> Only load plugins from sources you trust. We have not reviewed this one.
>
> [ Cancel ] [ Load plugin ]

Plus: the origin shown in full and never truncated; a one-time-per-origin
confirmation (not per plugin, or people click through it); a persistent "loaded
from example.com" badge on the insert strip; and a Settings page listing every
trusted origin with a Revoke button. A revoke must also drop the plugin from
open projects.

We must also be honest in `docs/KNOWN-LIMITATIONS.md` that we cannot vet
third-party plugin code, and that a plugin can crash audio for the tab.

---

## 5. Implementation plan

Six stages. Each is independently shippable — it can go to production on its own
and leave the product better than it found it. Each has an explicit "done when".

### Stage 0 — Spike (throwaway, not shipped)

**Goal:** kill the two unknowns before committing to the design.

Behind a dev-only flag, in a scratch branch: initialise a WAM host on our live
`AudioContext`, load `burns-audio/distortion`, connect it across a track's insert
point, and confirm it makes sound. Then do the same on an `OfflineAudioContext`
and confirm the rendered buffer is non-silent and differs from the dry signal.

**Answers:** does `initializeWamHost` work on an `OfflineAudioContext` in
Chrome, Firefox and Safari; and does `crossOriginIsolated === false` genuinely
leave us on the `postMessage` path (assert `_useSab` is false).

**Done when:** both questions are answered in writing. Delete the branch.

**Estimate: 1 day.**

---

### Stage 1 — The async node seam + a curated shelf of one

**Goal:** a user can add one real, self-hosted plugin to an insert chain, hear it,
save the project, reload, and hear it again. No GUI, no automation.

This stage is mostly _architecture_, not features. It builds the seam described in
§4.1(b), which everything else stands on.

**Create**

| File                                       | Purpose                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `src/model/plugins.ts`                     | `PluginRef`, `PluginParamCache`, `PluginStatus`; pure helpers; the shelf manifest type incl. a required `licence` field |
| `src/audio/plugins/wamHost.ts`             | Per-`BaseAudioContext` `WamEnv` init (`initializeWamHost`), memoised by context; group id/key; module-URL import cache  |
| `src/audio/plugins/pluginPool.ts`          | `preloadPlugins(project, ctx)`, `getPluginSync(ctx, effectId)`, instance lifecycle, re-sync callback                    |
| `src/audio/plugins/wamEffectNode.ts`       | The `EffectNode` adapter: in/out gains, host-side bypass crossfade, param diffing, `dispose`                            |
| `src/audio/plugins/shelf.ts`               | The curated catalogue and its licence manifest                                                                          |
| `public/plugins/burns-audio/distortion/**` | Self-hosted plugin bytes (whole directory — `import.meta.url` needs its siblings)                                       |
| `tests/plugins.test.ts`                    | Pure-model tests                                                                                                        |

**Change**

| File                                  | Change                                                                                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/model/types.ts`                  | `EffectKind` gains `'wam'`; `Effect` gains `plugin?: PluginRef`; `SCHEMA_VERSION` 6 → 7                                                                                                         |
| `src/model/effects.ts`                | `isKnownEffect` accepts `'wam'`; `normaliseParams` **skips** WAM effects (finite-number validation only); a synthetic `EffectSpec` so the picker and `describeEffect` do not need special cases |
| `src/audio/effectChain.ts`            | `buildEffectNode` gains a `'wam'` branch that calls `getPluginSync` and falls back to `buildPassThrough`; `InsertChain.rebuild` unchanged in shape                                              |
| `src/audio/engine.ts`                 | Kick `preloadPlugins` from the project-store subscription; on resolution, re-run `syncGraph`. `syncGraph` itself stays synchronous                                                              |
| `src/audio/exportMix.ts`              | `preloadForRender` also awaits `preloadPlugins(project, ctx)` — same pattern as media decode                                                                                                    |
| `src/persistence/projectRepo.ts`      | v6 → v7 migration (no-op forward); WAM effects preserved verbatim including `plugin.state`; tombstone rather than drop                                                                          |
| `src/components/mixer/DeviceRack.tsx` | A "Plugins" group in the console strip's picker, fed by the shelf                                                                                                                               |
| `src/components/mixer/InsertRack.tsx` | The same, for the Inspector / Mastering / channel-overview picker — **both racks are live**, and both build their picker from `EFFECT_GROUPS`, so both need the entry                           |
| `public/_headers`                     | Long-lived immutable caching for `/plugins/*` (see §6)                                                                                                                                          |

**Done when:** add Simple Distortion to a track, hear it, save, reload, hear it
again with its settings. Export the project and the plugin is audible in the WAV.

**Estimate: 1 week.** The plugin loading is the easy part; the async-resource seam
touching `engine.ts`, `effectChain.ts`, `exportMix.ts` and the schema is the week.

---

### Stage 2 — Plugin GUI

**Goal:** the plugin's own interface, in a window, working.

**`src/components/mixer/PluginWindow.tsx` already exists** (uncommitted in the
working tree at the time of writing) and is most of this stage already done. It
is a floating, draggable device window that remembers where it was put and
carries the frame every professional plugin has — name, preset, A/B compare,
bypass, and the in/out level it is working on — with the device's own face as its
body. That frame is exactly what a WAM GUI needs to sit inside.

**Change:** `src/components/mixer/PluginWindow.tsx` — its `EffectBody` gains a WAM
branch that mounts the `Element` from `createGui()` into a ref'd container,
wrapped in an error boundary (a plugin GUI that throws must not take our React
tree down) and calling `destroyGui` on unmount. The existing A/B compare needs a
WAM path too: snapshot through `getState()` rather than the numeric `Snapshot`
the built-ins use.

**Change:** `src/components/mixer/DeviceRack.tsx` and
`src/components/mixer/InsertRack.tsx` — an "Open" affordance on WAM strips.
`DeviceRack` already opens windows for built-in devices, so this may be free.
`src/state/uiStore.ts` — which plugin windows are open (UI state, not project
state).

Also in this stage: read `getState()` back on close and on save, so GUI edits
reach the project file. This is the moment the state blob becomes real.

**Done when:** open a plugin, turn its own knobs, hear the change, close it, save,
reload, and the settings are as left. Closing the app with a plugin window open
does not lose edits.

**Estimate: 2–3 days** — lower than it would otherwise be, because the window
frame already exists.

---

### Stage 3 — Parameters, automation and transport

**Goal:** plugin parameters are first-class MotionLab parameters.

**Change:** `src/model/paramRegistry.ts` — `listAutoParams` emits
`fx:<effectId>:<wamParamId>` entries built from `PluginRef.paramCache`, mapping
`WamParameterInfo` onto `AutoParam` (`exponent` → our `log` scale, `choices` →
stepped, `units` → unit, `valueString` → `format`). Because the id scheme is
unchanged, automation lanes, macros (`src/model/macros.ts`) and control links
(`src/model/controlLink.ts`) light up with no changes of their own.

**Change:** `src/audio/plugins/wamEffectNode.ts` — automation ticks go out as
`scheduleEvents({type:'wam-automation', time, data})` rather than
`setParameterValues`, so they are sample-accurate and offline-correct; tempo
changes emit `wam-transport`.

**Change:** `src/components/mixer/PluginFace.tsx` — a generic host-drawn control
surface from `paramCache`, so a plugin with no GUI is still usable and every
plugin is automatable from our own UI.

Plus the orphaned-parameter handling from §4.3(c): diff-on-load, the dimmed
inactive lane, the re-assign menu.

**Done when:** draw an automation lane on a plugin parameter, hear it move in
playback, and hear the identical movement in a bounce. Rename-a-parameter is
simulated in a test and the lane survives.

**Estimate: 1 week.**

---

### Stage 4 — Bounce parity and the freeze gate

**Goal:** make the bounce guarantee true for plugins, and provable.

**Create:** `src/audio/plugins/parityProbe.ts` — the two-render comparison from
§4.2, run once per plugin identifier+version, result cached in `prefsStore`.

**Change:** `src/audio/exportMix.ts` — refuse to render a `print-required` plugin
live; report it through the existing `ExportError` path. `src/audio/freeze.ts` —
a `freezeForExport(trackIds)` helper. `src/app/exportActions.ts` and
`src/components/common/ExportSheet.tsx` — surface "these tracks must be frozen
first", with a one-click "Freeze and export".

**Change:** `docs/PARITY.md` and `docs/KNOWN-LIMITATIONS.md` — say plainly what we
do and do not guarantee for third-party DSP.

**Done when:** `e2e/bounceparity.spec.ts` gains a plugin case proving a WAM's
contribution to a bounce matches playback within tolerance; and a deliberately
misbehaving test plugin is caught by the probe, marked `print-required`, and
produces a correct bounce via freeze.

**Estimate: 1 week.**

---

### Stage 5 — Loading from a URL

**Goal:** the actual "third-party" part — a user brings a plugin we have never seen.

**Create:** `src/components/settings/PluginSources.tsx` — the trust dialogue from
§4.4, the trusted-origin list, revocation.

**Change:** `src/state/prefsStore.ts` (trusted origins), `src/audio/plugins/shelf.ts`
(URL entries alongside shelf entries), `public/_headers` (CSP — see §6),
`docs/USER-MANUAL.md` and `docs/FAQ.md` (including a straight answer to "can I use
my VSTs?": no, and why, and what the bridge would be).

**Done when:** paste a URL to a plugin hosted elsewhere with CORS enabled, get the
consent dialogue, load it, use it, and see it correctly tombstoned when the same
project is opened on a machine that cannot reach it.

**Estimate: 4–5 days.**

---

### Stage 6 — Instruments and MIDI (optional, scope on demand)

WAM instruments (`isInstrument: true`) receive `wam-midi` events and generate
audio. This is a larger change than inserts because it touches the note pipeline
(`src/audio/notePipeline.ts`, `scheduler.ts`, `synth.ts`, `samplerInstrument.ts`)
and `src/model/freeze.ts`'s picture of what a track owns. Worth doing — Synth-101,
DRM-16 and the Soundfont player are all MIT `burns-audio` — but it should be
scoped separately once stages 1–4 are proven.

**Estimate: 1.5–2 weeks.**

---

## 6. Deployment and headers

We deploy on Cloudflare Workers Static Assets (`wrangler.toml`, `[assets]
directory = "./dist"`). Custom headers come from a `_headers` file inside the
assets directory — natively supported by Workers Static Assets, exactly as on
Pages. **We already use this**: `public/_headers` sets `Cache-Control: no-cache`
on `sw.js`, `manifest.webmanifest` and `index.html`, and Vite copies it to
`dist/_headers` at build.

**No `wrangler.toml` change is needed.** All of this is `public/_headers`.

### Headers we DO need

```
# Self-hosted plugin bundles are versioned by path and never change in place.
/plugins/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *
```

`Access-Control-Allow-Origin: *` on `/plugins/*` is deliberate: it lets _other_
WAM hosts load the plugins we serve, which costs us nothing and is good
citizenship in a small ecosystem. Drop it if we would rather not serve others'
bandwidth.

### Headers we DO NOT need

```
# NOT REQUIRED — do not add these.
#   Cross-Origin-Opener-Policy: same-origin
#   Cross-Origin-Embedder-Policy: require-corp
```

Per §2.4: WAM's SharedArrayBuffer path is opt-in _and_ feature-gated, so without
cross-origin isolation the SDK falls back to `postMessage` and everything works.
Enabling isolation would risk Google Fonts and every other cross-origin asset,
complicate the service worker's precache, and — perversely — make third-party
plugin loading harder by requiring CORP from plugin hosts. **The cost is real and
the benefit is zero for our usage.**

### The CSP we should add (stage 5, before arbitrary URLs)

We have **no CSP today**. Adding one is the highest-value security control
available and belongs in `public/_headers`:

```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'
```

Notes on that policy, because two entries look alarming and are not optional:

- **`blob:` in `script-src` and `worker-src` is required by WAM itself.** The
  SDK's `addFunctionModule` stringifies a function into a `Blob` and calls
  `audioWorklet.addModule(blobUrl)`. Without `blob:`, no WAM will ever load.
- **`'wasm-unsafe-eval'`** is required by any plugin carrying WebAssembly DSP
  (most of the Faust-derived ones). It permits WASM compilation only, not `eval`.
- **`style-src 'unsafe-inline'`** reflects plugin GUIs injecting styles; verify
  against our own build before committing to it.
- **`connect-src 'self'`** is the exfiltration control. When stage 5 adds a
  trusted origin, that origin is appended to `script-src` and `connect-src`.
  Because `_headers` is static, a per-user allowlist is not expressible there —
  either ship a broad-but-bounded list, or promote the app to a Worker script
  that emits the header dynamically. **Decide this in stage 5, not before**;
  stages 1–4 need only the static policy above with our own origin.

Validate the policy against a real build before shipping it — a CSP that breaks
the PWA is worse than no CSP.

---

## 7. Risks

| #       | Risk                                                                                                                                                                | Likelihood | Impact       | Mitigation                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | **A plugin renders differently offline than live, silently.** The bounce stops matching the monitor — the product's central promise                                 | Medium     | **Critical** | The parity probe (stage 4) turns this from a hope into a measurement. `print-required` + freeze gives a correct bounce regardless. Never ship stage 1 to users without stage 4 following closely                                |
| **R2**  | The async-resource seam destabilises `syncGraph`, causing dropouts or stale graphs on rapid project edits                                                           | Medium     | High         | Keep `syncGraph` synchronous — this is non-negotiable. Placeholder pass-through on miss, re-sync on resolve. Fuzz it (`tests/fuzz.test.ts` already exists as a model)                                                           |
| **R3**  | The WAM standard is effectively unmaintained — API frozen since 2023, SDK since 2024                                                                                | **High**   | Medium       | Vendor the SDK from day one. It is ~2,000 readable lines of MIT. Own it rather than depend on it. Keep the adapter thin so a future format (WCLAP) is a new adapter, not a rewrite                                              |
| **R4**  | Plugin latency (`getCompensationDelay`) is reported in ambiguous units — the API says "samples" in one place and "seconds" in another, and the SDK converts neither | Medium     | Medium       | Treat as a hint. Sanity-check magnitude (reject implausible values), and prefer measuring latency empirically via an impulse through the plugin — we already have the machinery in `e2e/masterlatency.spec.ts`                  |
| **R5**  | A plugin's `process()` hangs or throws, killing the audio thread for the whole tab                                                                                  | Medium     | High         | Cannot be prevented from the host — this is a genuine platform limitation. Detect via a main-thread watchdog on context state, surface a clear error, offer to disable the offending insert. Document in `KNOWN-LIMITATIONS.md` |
| **R6**  | Licence contamination from bundling GPL-derived DSP (several `wimmics` plugins)                                                                                     | Low        | **High**     | Per-plugin licence manifest, enforced by a build-time check. Ship only MIT `burns-audio` in stage 1. Never bundle `wam-community` wholesale                                                                                     |
| **R7**  | A malicious plugin reads or destroys the user's projects via our IndexedDB                                                                                          | Low        | **Critical** | Curated shelf only until stage 5. CSP before arbitrary URLs. Explicit, specific consent dialogue. Trusted-origin list with revocation                                                                                           |
| **R8**  | Instantiating many plugins slows export start noticeably                                                                                                            | Medium     | Low          | Cache `addModule` per context and ESM imports process-wide. Measure in `e2e/perfScale.ts`. Report progress through the existing `onProgress` hook                                                                               |
| **R9**  | Safari-specific AudioWorklet or `OfflineAudioContext` divergence — we have never shipped a worklet                                                                  | Medium     | Medium       | Stage 0 tests all three engines before any commitment. `docs/BROWSER-COMPATIBILITY.md` gains a plugin row                                                                                                                       |
| **R10** | A cross-origin plugin host without CORS simply cannot be loaded, and users blame us                                                                                 | Medium     | Low          | Detect the CORS failure specifically and say so — "example.com does not allow other sites to load its plugins" — rather than a generic load error                                                                               |

**The single biggest risk is R1**, and it is the reason stage 4 is not optional.

---

## 8. Tests

Following existing conventions: `tests/*.test.ts` for Vitest/jsdom units,
`e2e/*.spec.ts` for Playwright against a real browser. Note that anything needing
a real `AudioWorklet` or `OfflineAudioContext` **must** be an e2e test — jsdom has
neither. `e2e/bounceparity.spec.ts` already establishes the pattern of building a
project in-page via the `__ml` bridge and measuring rendered audio; plugin tests
extend it.

### Stage 1

- `tests/plugins.test.ts` — `PluginRef` round-trips; shelf manifest entries all
  carry a licence; a manifest entry without one fails the build.
- `tests/migration.test.ts` (extend) — a v6 project loads as v7 unchanged; a v7
  project containing a WAM effect survives save→load with `plugin.state` and every
  parameter value byte-identical; **an effect whose plugin is unknown is retained
  as a tombstone, not dropped** (this directly guards the current
  `isKnownEffect` filter).
- `tests/effects.test.ts` (extend) — `normaliseParams` does not touch a WAM
  effect's params; a WAM effect with 40 arbitrary parameter keys keeps all 40.
- `e2e/plugins.spec.ts` (new) — load Simple Distortion into an insert; assert the
  rendered buffer differs measurably from the dry signal; assert
  `crossOriginIsolated === false` and that audio works anyway (**this is the test
  that proves §2.4 in a real browser**); assert no console errors
  (`e2e/console.spec.ts` conventions).

### Stage 2

- `e2e/plugins.spec.ts` — open the GUI, assert an element is mounted; a GUI that
  throws on `createGui` is caught by the error boundary and the app stays usable;
  close → `destroyGui` called → no leaked DOM.
- Round-trip: change a parameter through the plugin's own GUI, close, save,
  reload, and assert the value persisted via `getState`.

### Stage 3

- `tests/paramRegistry.test.ts` (new or extend) — `WamParameterInfo` → `AutoParam`
  mapping for each of `float`/`int`/`boolean`/`choice`, including `exponent` → log
  scale and `choices` → stepped.
- `tests/automation.test.ts` (extend) — a lane targeting a parameter absent from
  `paramCache` is **retained and marked inactive**, never deleted; `findAutoParam`
  returning `undefined` does not throw anywhere in the consumer chain.
- `e2e/automation.spec.ts` (extend) — automate a plugin parameter; assert the
  offline render's RMS follows the lane's shape across windows.

### Stage 4 — the important one

- `e2e/bounceparity.spec.ts` (extend) — render a project containing a WAM insert
  twice: once offline, once captured in realtime. Assert per-window RMS agrees
  within tolerance. **This is the test that proves the product guarantee holds
  for third-party DSP.**
- `tests/parityProbe.test.ts` — the comparison logic, and cache
  invalidation on plugin version change.
- `e2e/freeze.spec.ts` (extend) — a `print-required` plugin blocks export with a
  named, actionable error; "Freeze and export" produces a bounce whose RMS matches
  playback; freezing a track containing a plugin produces a print that no longer
  instantiates it.

### Stage 5

- `e2e/plugins.spec.ts` — the consent dialogue appears for an untrusted origin and
  blocks loading until accepted; a revoked origin cannot load; a URL that fails
  CORS produces the specific CORS message, not a generic error.
- `tests/persistence.test.ts` (extend) — a project referencing an unreachable
  plugin URL opens, warns, and preserves state and lanes.

### Continuous

- `e2e/perfScale.ts` — export start-time with 0, 4 and 16 plugin instances, to
  catch R8 before users do.
- `e2e/accessibility.spec.ts` — the plugin window and consent dialogue pass axe;
  note we cannot enforce accessibility _inside_ a third-party GUI, and should say
  so in `KNOWN-LIMITATIONS.md`.

---

## 9. Sources

- WAM API type definitions and README — `@webaudiomodules/api@2.0.0-alpha.6`
  (npm tarball, `src/types.d.ts`), MIT
- WAM SDK source — `@webaudiomodules/sdk@0.0.12` (npm tarball,
  `src/WamProcessor.js`, `src/WamNode.js`, `src/initializeWamHost.js`,
  `src/addFunctionModule.js`, `src/WebAudioModule.js`), MIT
- Plugin index and bundles — `wam-community@0.4.9`, `dist/plugins.json` (58 plugins)
- [webaudiomodules/api on GitHub](https://github.com/webaudiomodules/api)
- [Web Audio Modules 2.0: An Open Web Audio Plugin Standard (ACM)](https://dl.acm.org/doi/fullHtml/10.1145/3487553.3524225)
- [WAM-studio, a Digital Audio Workstation for the Web (ACM)](https://dl.acm.org/doi/fullHtml/10.1145/3543873.3587987)
- [wam-community](https://github.com/boourns/wam-community) · [burns-audio-wam](https://github.com/boourns/burns-audio-wam)
- [SharedArrayBuffer updates in Android Chrome 88 and Desktop Chrome 92](https://developer.chrome.com/blog/enabling-shared-array-buffer)
- [A guide to enable cross-origin isolation (web.dev)](https://web.dev/articles/cross-origin-isolation-guide)
- [SharedArrayBuffer — MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)
- [Mozilla bug 1624266 — Conditionally hide the SharedArrayBuffer constructor](https://bugzilla.mozilla.org/show_bug.cgi?id=1624266)
- [Cloudflare Workers Static Assets — Headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- [faustwasm](https://github.com/grame-cncm/faustwasm) · [@grame/faustwasm on npm](https://www.npmjs.com/package/@grame/faustwasm) (0.16.7, LGPL-3.0, 2026-08-16)
- [free-audio/web-clap](https://github.com/free-audio/web-clap) · [Signalsmith WCLAP browser host](https://github.com/Signalsmith-Audio/wasm-clap-browserhost)
- [Audiotool VST Bridge](https://help.audiotool.com/manuals/vst-bridge.html) · [Amped Studio VST Remote](https://ampedstudio.com/vstremote/)
- [OfflineAudioContext — MDN](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext)
