# ADR-0004 — The parameter and automation framework

**Status:** Accepted · **Date:** 2026-08-22 · **Decider:** Program Director + Audio Engine Lead

## Context

Every plugin, instrument and mixer control in Motion Wave is reached by the same
four consumers: a user dragging it, an automation lane, a modulation source, and
a host or controller. The brief says to build this once. It is also the single
place where the no-allocation rule is won or lost, because a parameter change is
the only thing that regularly crosses from a non-real-time thread into the audio
callback.

The failure modes are known and specific. A parameter that is one `float` read
per block produces zipper noise on any fast move and cannot represent an
automation ramp. A parameter changed by writing straight into the audio thread's
memory produces a data race that will not reproduce under a debugger. A
parameter whose real-world unit is computed in the UI and again in the DSP
produces two answers to one question, which is how a control ends up labelled
"Q" while the filter reads decibels.

## Decision

### A parameter is a descriptor plus a value, and the descriptor is the authority

```cpp
struct ParamSpec {
  ParamId      id;          // stable, never renumbered; the automation key
  const char*  name;        // display name; never a trademarked reference name
  Unit         unit;        // dB, Hz, ms, semitones, percent, ratio, choice…
  float        min, max, def;
  Taper        taper;       // Linear | Logarithmic | Exponential(k) | Stepped(n)
  float        smoothingMs; // 0 = stepped switch, never smoothed
  const char* const* choices; // non-null only for Unit::Choice
};
```

The spec owns the conversion between the **normalised** 0..1 value that
automation, hosts and controllers speak, and the **real** value in the
parameter's unit that DSP reads. That conversion exists once. A face that draws
a curve asks the same function the processor asks, so a display and a processor
cannot disagree — the class of bug where a control is labelled in one unit and
read in another is made unrepresentable rather than merely tested for.

### Values are ramps, not scalars

The audio thread does not read "the value of parameter 7". It reads a
`ParamBlock` describing the parameter across the coming buffer: a start value,
an end value, and a flag saying whether it moved. A processor that cares about
sample accuracy interpolates; one that does not reads the end value. Automation,
modulation and a user's finger all arrive as the same thing, so a processor
never needs to know which of them moved it.

Smoothing is a one-pole toward the target with the spec's time constant, run
**on the audio thread** at block rate. Stepped and choice parameters are not
smoothed — crossfading between two filter modes is the processor's job if it
wants one, and pretending a switch is continuous is worse than a click.

### Crossing the thread boundary

Two lock-free single-producer/single-consumer ring buffers per graph, both
pre-allocated at construction:

- **Down** (UI, automation, MIDI → audio): parameter changes as
  `{ nodeId, paramId, normalisedTarget, sampleOffset }`. Drained at the top of
  every block. Full is not an error condition to handle in the callback — the
  producer refuses to overfill and coalesces repeated writes to the same
  parameter, because the newest value is the only one that matters.
- **Up** (audio → UI): meters, gain reduction, visualiser frames. Write-only
  from audio, never read back. A visualiser that misses a frame draws the
  previous one; a visualiser that blocks the audio thread is a defect.

Nothing else crosses. The audio thread never takes a lock, never allocates,
never logs, and never calls back into the UI.

### Automation is a lane of points, evaluated to a ramp

A lane holds `{ time, value, curve }` points in normalised value and PPQ ticks.
Evaluation produces the same `ParamBlock` a user's finger produces. Latch, touch,
write and trim are recording modes over the same structure, not four code paths.

### Presets are `{ paramId → normalised }` plus a version

Normalised, not real, so a preset survives a spec whose range changes; versioned,
so a spec that changes _meaning_ can migrate rather than silently reinterpret.
**Unknown ids are preserved, not dropped** — a preset written by a newer build
and opened by an older one must not lose what it does not understand.

### Modulation sits between automation and the parameter

A modulation source contributes an offset in normalised space, summed and
clamped after automation. One rule, so a modulated parameter cannot leave its
range and a face can draw the reachable band around the current value — which is
the only honest way to show what a modulation depth actually reaches.

## Consequences

- Adding a plugin means declaring a `ParamSpec` table and reading `ParamBlock`s.
  Automation, presets, modulation, host exposure, MIDI learn and the generic UI
  all follow from the declaration with no per-plugin work.
- The no-allocation rule is enforceable at one seam instead of everywhere: the
  ring buffers and the parameter arrays are the only shared state, and both are
  sized at construction.
- The generic UI can render any plugin from its specs alone, so a plugin's
  custom face is an _upgrade_ over a working default rather than a prerequisite
  for shipping it.
- A parameter's id is permanent. Renaming a control is a display change;
  renumbering one breaks every project that automated it.

## Rejected alternatives

- **Atomic float per parameter, read once per block.** Simple, and it cannot
  express a ramp, so every fast automation move steps. Rejected.
- **Message queue with heap-allocated messages.** Allocates on the producer and
  frees on the audio thread, which is the exact thing forbidden. Rejected.
- **Real-unit values across the boundary.** Requires every consumer to know each
  parameter's unit and range, and breaks the moment a range changes. Normalised
  in the plumbing, real in the DSP, converted in one place.
