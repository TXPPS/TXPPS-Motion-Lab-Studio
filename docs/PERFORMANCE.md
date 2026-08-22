# Performance Notes

All numbers were **measured** on this repository's CI container (Linux,
software rasterizer, Chromium) against the production build. Real desktop
hardware is generally faster; numbers are budgets and honest orders of
magnitude, not marketing.

## Startup

| Scenario                               | Boot to interactive |
| -------------------------------------- | ------------------- |
| Demo project (8 tracks / 12 clips)     | ~0.5 s              |
| `#/qa-huge` (100 tracks / 1,078 clips) | ~1.4 s              |
| `#/qa-max` (500 tracks / 50,000 clips) | ~1.5 s              |

Boot cost is dominated by fixture generation at QA scale; loading a
stored project adds one IndexedDB read + validation (validation now
includes a JSON normalization pass, ~170 ms at the 12 MB extreme, ≪10 ms
for realistic projects).

## Editing latency (store update → render)

| Scale        | Undoable edit | Undo    |
| ------------ | ------------- | ------- |
| 1,078 clips  | ~14 ms        | ~0 ms   |
| 50,000 clips | ~107 ms       | ~1.3 ms |

RC1 moved undo/redo stacks from JSON strings to retained immutable
objects: at 50k clips an edit dropped from 377 ms → 107 ms and undo from
133 ms → 1.3 ms. The remaining edit cost is the full-project
`structuredClone` each mutation performs — the price of an always-
consistent immutable store, linear in project size.

## Rendering

- Idle frame time is vsync-bound (median 16.7 ms) with the engine running
  on both the 100- and 500-track fixtures — meters and automation
  application do not measurably load an idle frame.
- Full-viewport scroll jumps re-window the arrangement: ~32 ms at 100
  tracks, ~200 ms at 500 tracks/50k clips (windowed rendering iterates
  clip lists per jump; per-frame scrolling stays smooth).
- Waveforms draw from cached min/max envelopes — no per-frame decoding.
- The 512-zone multisample list renders in ~1.7 s and edits one row per
  keystroke thanks to field-compared memoized rows.

## Memory

| Scenario | JS heap |
| -------- | ------- |
| Demo     | ~12 MB  |
| qa-huge  | ~18 MB  |
| qa-max   | ~74 MB  |

Plus decoded audio (~10 MB per stereo minute). Decode caches are evicted
on project switch (RC1); undo history retains up to 60 project versions,
which at absurd clip counts is the main memory consumer.

## Voices and audio

- 128-source engine budget; 48 voices per sampler with oldest-first
  stealing; voices unregister on end (verified in e2e: sources return to
  ≤2 after stop).
- Offline export renders faster than real time and never blocks the audio
  thread (OfflineAudioContext).

## Method

Profiling scripts drive the production build via Playwright/CDP, reading
`performance.now()` deltas, rAF frame gaps and `performance.memory`. The
scale fixtures (`#/qa-huge`, `#/qa-max`, `#/qa-multisample`, `#/qa-drums`)
are deterministic so runs are comparable.
