# Motion Wave audio-quality recovery — CP-AQ-001

Date: 2026-11-02

Status: **IN PROGRESS — verification and audio acceptance not complete**

Baseline: `62744e0b1a819a0ba6602368b5ccf53612786484`
(`claude/motionlab-studio-poc-3l1gwa`).

This is a corrective checkpoint, not a replacement for the existing
`docs/UNIT_LEDGER.md`, native roadmap, research sheets or ADR-0007.
The owner reports unacceptable behavior from the granular effect and
vintage-style processor collection. The exact audible defects still
require reproduction. Nothing below constitutes a sound-quality pass.

## Source of truth and boundaries

- Keep the existing C++ Motion Wave DSP, WebAssembly worklet, manifest-driven
  host adapter and native-shell roadmap. No new framework or duplicate host.
- Preserve every original preset, parameter ID, saved-session format and
  supported path unless a verified defect requires a backwards-compatible fix.
- `docs/UNIT_LEDGER.md` records engineered processor test results.
  `docs/HARDWARE_VERIFICATION.md` defines physical listening checks.
  This checkpoint records human-facing audio acceptance and ordering.
- Treat reference measurements as evidence, not as permission to reproduce
  branded artwork, names, ROM content or proprietary presets.
- Correct regressions on feature branches with evidence. Do not merge merely
  because a tool or automated reviewer declares success.

## Distinct approval states

Each device has four independently recorded states:

1. **DSP VERIFIED** — native parameter and signal tests are satisfied.
2. **HOST VERIFIED** — reachable in the actual app; WebAssembly/native bridge,
   automation, bypass, project reload and offline render are tested.
3. **SOUND APPROVED** — independent, level-matched listening and a documented
   owner audition confirm that its behavior is musically satisfactory.
4. **RELEASE APPROVED** — DSP, host, audio, usability, real-device and CI
   evidence are current for the exact candidate commit.

None implies a later state. An existing `SHIPPING` ledger label is not
automatically sound approval. A marked deviation needs an explicit technical
waiver _and_ an independent audible check.

### Current owner-approval register

No fresh listening approval was established by this checkpoint.

- `fx-01` Motion Shaper — SOUND APPROVED: **NOT VERIFIED**.
- `dyn-01` Program EQ — SOUND APPROVED: **NOT VERIFIED**.
- `dyn-02` Optical Leveller — SOUND APPROVED: **NOT VERIFIED**.
- `dyn-03` FET Limiter — SOUND APPROVED: **NOT VERIFIED**.
- `dyn-04` Variable-Mu Limiter — SOUND APPROVED: **NOT VERIFIED**.
- `dyn-05` Console EQ — SOUND APPROVED: **NOT VERIFIED**.
- `fx-02` Granular Reverb — SOUND APPROVED: **ON HOLD; V7 deviation**.
- `fx-03` Granular Delay — SOUND APPROVED: **NOT VERIFIED**.
- `smp-01` Slipstream Sampler — partial implementation; not a release
  candidate. Keep its work isolated from this recovery.
- `syn-01` through `syn-05` — research specifications only; none has
  sound, host or release approval as a stock instrument.

The absence of recorded human approval is not proof that every device is
broken. It means the release gate has not been satisfied.

## Checkpoints and non-negotiable exits

### CP-AQ-00 — CI recovery (ACTIVE)

Tracking: [issue #1](https://github.com/TXPPS/TXPPS-Motion-Lab-Studio/issues/1)

- Restore `npm run format:check` on the actual committed files.
- Run Motion Wave unit tests _after_ `wasm:check`: that check builds
  `motionwave/wasm/dist/motionwave.mjs` and validates the tracked worklet.
- Require one uncancelled, complete green run for typecheck, lint, format,
  both unit suites, WASM, native core, production build and browser E2E.
- Record the exact candidate SHA, all check results and any skipped checks.
- Triage npm security advisories without indiscriminate breaking upgrades.

**Exit:** reproducible green CI and a security triage for the candidate
commit. The branch change alone is not an exit.

### CP-AQ-01 — Reproduce and capture sound faults (OPEN)

Tracking: [issue #2](https://github.com/TXPPS/TXPPS-Motion-Lab-Studio/issues/2)

For all eight native processors, establish a clean reference session:

- Record tested commit, host/browser/OS, sample rate, block size and CPU.
- Capture unprocessed dry snare, acoustic guitar, vocal, bass and synth pad.
- Render with fixed settings, no effect, effect bypassed, at 100% wet where
  relevant, and with normal musical mix levels.
- Log input and output gain and loudness. Listen with level-matched A/B;
  avoid confusing louder with better.
- Exercise every control, meaningful automation sweeps, preset round-trips,
  host transport and live/offline bounce. Confirm no click, dead control,
  stale meter, unexpected gain or lost effect tail.
- Run on Windows with a real audio interface and on iPhone for the web UI
  when available. Separate unsupported platform features from defects.

Evidence for each fault: source WAV, processed WAV, exact settings, screenshot
if the interface is involved, reproduction steps, expected behavior, measured
behavior, and a hypothesis explicitly marked as a hypothesis.

**Exit:** each owner-reported fault has a reproduction or an explicit
unconfirmed status. No silent conversion of a report into a test pass.

### CP-AQ-02 — Granular DSP quality correction (BLOCKED BY 01)

Tracking: [issue #2](https://github.com/TXPPS/TXPPS-Motion-Lab-Studio/issues/2)

Known finding: `fx-02` V7 measured 125 ms against an 80 ms echo-density
criterion; `docs/UNIT_LEDGER.md` retained the deviation. The existing
`docs/HARDWARE_VERIFICATION.md` requires snare and acoustic-guitar listening
for flutter/stutter. That listening check is **not recorded as owner-approved**.

- Compare original algorithm against controlled alternatives; keep the old
  implementation for regression and listening A/B.
- Investigate early-field density, sparse-grain stutter, pre-delay, wet/dry
  loudness and tail continuity before redesigning controls or artwork.
- Consider a dense foundational reverb with optional granular texture as a
  _hypothesis_, not a predetermined rewrite.
- Check `fx-02` freeze, shimmer and density at 100, 350 and 1500 grains/s.
- Check `fx-03` smear at 25% and 50%; clean/tape/BBD character, timing
  changes, sync, feedback stability and tonal consistency.
- Prove no loss of latency compensation, bypass, presets, automation,
  sample-rate behavior, UI state or native/WASM parity.

**Exit:** measured corrective evidence, successful regressions, a completed
human listening checklist and explicit owner sign-off. Any exception to V7
must be written down and justified rather than re-labeled as a pass.

### CP-AQ-03 — Vintage collection calibration (BLOCKED BY 01)

Tracking: [issue #3](https://github.com/TXPPS/TXPPS-Motion-Lab-Studio/issues/3)

Scope: `dyn-01`, `dyn-02`, `dyn-03`, `dyn-04`, `dyn-05`.

- Verify each native/reference specification against published measurements
  and realistic musical input levels; distinguish confirmed from inferred.
- Audit gain staging, filter response, nonlinear harmonic profile, dynamics
  timing, interdependent controls and stereo behavior as applicable.
- Do blind or level-matched A/B listening on drums, bass, vocals and buses.
- Restore reliable zero/neutral behavior and sensible audible stock presets.
- Keep hardware-inspired character optional and controlled where appropriate.
- Run real-time versus bounce, 44.1/48 kHz minimum, and high-rate checks
  where available. Verify automation, bypass and project reload.

**Exit:** separate DSP, host and sound approval per plugin, with evidence.
Do not approve all five as a group just because their suites are green.

### CP-AQ-04 — First stock synth: DCO Poly (PLANNED)

Tracking: [issue #4](https://github.com/TXPPS/TXPPS-Motion-Lab-Studio/issues/4)

Entry: CI stable, existing effect defects contained, shared voice substrate
and host instrument contract checked.

- Implement the six-voice DCO architecture from
  `docs/reference/syn-01-dco-poly.md` using original code and visuals.
- Complete oscillator/sub/noise, filter, envelope, LFO, chorus, MIDI and voice
  retirement; then presets, automation and instrument-browser integration.
- Prove desktop and mobile access, state save/load and live/offline agreement.
- Require independent listening and owner approval before calling it stock.

**Exit:** one complete, playable, sound-approved stock instrument, not five
unverified skeletons.

### CP-AQ-05 — Remaining vintage-inspired stock synths (PLANNED)

Order retained from `docs/UNIT_LEDGER.md`:

`syn-02` Phase Distortion → `syn-03` Analog Five →
`syn-04` Six-Op FM → `syn-05` Matrix Twelve.

Each must reach the same host, DSP, sound and release gate as `syn-01`
before the following instrument starts.

### CP-AQ-06 — Release hardening (PLANNED)

- Full real-device recording, playback, automation, routing, presets, export,
  CPU/latency and recovery regression on supported targets.
- Confirm the production deployment SHA matches tested source and bundles.
- Complete release notes, known-limitations inventory and manual QA.
- Only then update owner-facing release readiness for affected units.

## Audio review record template

For every device and finding, save a record with:

- Device ID, commit SHA, environment, sample rate and test date.
- Source material identity and rights/usage note; exact preset/parameters.
- Expected result; observed audible result; corresponding measurements.
- Link to original and processed audio; live and offline comparison.
- DSP VERIFIED: PASS / FAIL / UNVERIFIED.
- HOST VERIFIED: PASS / FAIL / UNVERIFIED.
- SOUND APPROVED: APPROVED / REJECTED / UNVERIFIED.
- RELEASE APPROVED: APPROVED / HOLD.
- Reviewer identity, method and owner approval date if granted.
- Issue/PR, corrective commit and regression results.

A review cannot be promoted by an absent WAV, a simulated audio interface,
a skipped test, or an automated judge evaluating its own implementation.

## Immediate continuation

1. Finish CP-AQ-00 and attach the first complete CI run to issue #1.
2. Produce two short, repeatable audio captures for `fx-02` and `fx-03`
   plus one representative vintage processor; attach to issue #2 or #3.
3. Choose the first DSP correction from that evidence; do not implement
   five unrelated changes at once.
4. Only begin `syn-01` when the audio release process is credible.

This checkpoint supplements existing project governance; it does not create
another orchestrator, approval service, engine or release branch.
