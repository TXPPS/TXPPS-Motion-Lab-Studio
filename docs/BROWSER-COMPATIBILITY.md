# Browser Compatibility

Two evidence sources, clearly separated:

1. **Engine test runs** — the full 158-test e2e suite executed on real
   Chromium, Firefox and WebKit builds in this project's CI container
   (Linux, software rendering, PulseAudio null sink). These prove the
   *engines* run the app: audio graph, offline export, editing, layout.
2. **Feature detection** — capabilities that differ per browser/platform,
   detected at runtime (Diagnostics shows the live result on any device).
   We never fake support: missing features switch off with in-app
   messaging.

CI engine results are not identical to retail browsers on real hardware
(no hardware audio devices, no touch, no OS media policies), so treat the
matrix as engine-level truth plus honest platform caveats — not as a
claim that every retail build was hand-tested.

## Engine test results (this CI)

| Suite | Chromium 141 | Firefox 151 | WebKit 26.5 |
| --- | --- | --- | --- |
| Full e2e (158 tests) | RESULT_CHROMIUM | RESULT_FIREFOX | RESULT_WEBKIT |

Notes:
- Firefox runs with fake-microphone prefs so the recording pipeline is
  exercised for real; WebKit has no fake-capture mechanism, so
  microphone-dependent tests skip there (capture on retail Safari works
  through the normal permission prompt but is not CI-provable here).
- Clipboard permission grants are a Chromium-only Playwright feature; the
  app's internal copy/paste never depends on the async clipboard API.

## Feature availability by browser

| Capability | Chrome/Edge 98+ | Firefox 94+ | Safari 15.4+ | Effect when missing |
| --- | --- | --- | --- | --- |
| Web Audio (playback, synth, sampler, mixer) | ✓ | ✓ | ✓ | Hard requirement — unsupported-browser card |
| `structuredClone` (project store) | ✓ | ✓ | ✓ | Hard requirement — unsupported-browser card |
| OfflineAudioContext (WAV export) | ✓ | ✓ | ✓ | Export button reports unavailability |
| IndexedDB (projects, media) | ✓ | ✓ | ✓¹ | In-memory session; saves warn visibly |
| getUserMedia (recording) | ✓ | ✓ | ✓ | Record workspace explains; playback unaffected |
| MediaRecorder | ✓ (Opus/WebM) | ✓ (Opus/WebM) | ✓ (AAC/MP4)² | Recording disabled with message |
| Web MIDI | ✓ | ✓ (prompt) | ✗ | MIDI section says unsupported; on-screen/computer keys always work |
| Pointer events (all editing gestures) | ✓ | ✓ | ✓ | — |
| Storage estimate (quota display) | ✓ | ✓ | ✓ | Diagnostics hides usage figures |
| PWA install | ✓ | partial³ | ✓ (Add to Home Screen) | App still runs in-tab |

¹ Safari private windows heavily restrict IndexedDB; the app falls back
to an in-memory session and says so.
² Recordings store the browser's native container; they decode for
playback/export on the machine that recorded them. Cross-browser project
moves are WAV-export territory (see Known Limitations).
³ Firefox desktop has no install prompt; the app works fully in-tab.

## Platform caveats (honest, not exhaustive)

- **iOS/iPadOS (all browsers use WebKit):** background tabs suspend
  audio; the engine resumes on return. The mute switch and route changes
  are OS-controlled. Files import via the Files picker; drag-and-drop of
  external files is desktop-only.
- **Android Chrome:** tested layouts and touch behaviors are covered by
  the responsive e2e suite (viewport-emulated); retail-device audio
  latency varies widely with hardware.
- **Desktop Safari:** engine-covered via WebKit; retail Safari adds
  stricter autoplay gating — the first Play click unlocks audio, which is
  the app's designed flow everywhere.
- **Firefox:** `media.autoplay` defaults may require the first gesture
  before sound, same designed flow.

## Minimum versions

Hard floor (boot guard): any browser with `structuredClone` + Web Audio —
in practice Chrome/Edge 98+, Firefox 94+, Safari 15.4+ (March 2022).
Older browsers get a readable unsupported-browser card, never a blank
page.
