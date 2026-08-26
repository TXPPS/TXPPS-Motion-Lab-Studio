# ADR-0006 — Quality tiers, and the mobile budget that does not close

**Status:** Accepted · **Date:** 2026-08-22 · **Decider:** Program Director + Performance
**Related:** ADR-0005 (verification), `docs/reference/fx-01..03`

## Context

Two of the brief's own requirements do not both hold, and the research that
found it is worth quoting rather than paraphrasing.

§2.2 sets the mobile budget: **24 tracks and 12 plugin instances on an iPhone
with no dropouts at a 256-sample buffer.** §6.3 and §6.4 then specify a granular
reverb and a granular delay whose ranges reach grain overlaps of 200 and an
eight-tap delay at full smear. The Research Analyst costed both against the
alternatives:

| Configuration                                              | Mflop/s, one instance | × 12             |
| ---------------------------------------------------------- | --------------------- | ---------------- |
| Motion Shaper, 3 bands, 1 module                           | 13.4                  | 161 Mflop/s      |
| Motion Shaper, 3 bands, 8 modules                          | 96                    | 1.15 Gflop/s     |
| Granular reverb, default (350 grains/s, 60 ms, overlap 21) | 31.0                  | 372 Mflop/s      |
| Granular reverb, literature maximum (overlap 200)          | 237                   | **2.85 Gflop/s** |
| Granular delay, tape, 4 taps, no smear                     | 16.6                  | 199 Mflop/s      |
| Granular delay, tape, 8 taps, full smear                   | 314                   | **3.8 Gflop/s**  |

For calibration, the same analysis puts a Dattorro plate at ~80 flops/sample and
a 16×16 feedback delay network with a fast Walsh–Hadamard transform at ~130 —
so **an FDN is cheaper than our granular reverb**, and partitioned convolution
for a two-second stereo impulse is ~610 Mflop/s for _one_ instance, 7.3 Gflop/s
for twelve.

Memory turns out to be the harder wall than arithmetic. Honouring the reference
product's 32-bar modulation length at 60 BPM in the Motion Shaper's time module
would need **147 MB per instance and 1.76 GB for twelve**.

The analyst's conclusion, which this ADR accepts: _"at the granular reverb's
dense settings or the granular delay's maximum smear, twelve simultaneous
instances is not achievable on any phone."_

## Decision

**Three quality tiers, and on mobile the Eco tier is enforced rather than
suggested.**

- **Eco** — the mobile default and the only tier a phone may run at scale. Grain
  rates, overlap and tap counts are capped so that twelve instances fit the
  budget. The caps are per-plugin and documented in each spec sheet.
- **Studio** — the desktop default. The full published ranges.
- **Max** — desktop only, and warned about. The settings that cost 3.8 Gflop/s
  exist because they make a sound nobody else makes; they do not exist so that
  twelve of them can run on a telephone.

Three rules make the tiers honest rather than cosmetic:

1. **A tier reduces the grain _rate_, never drops grains mid-flight.** Dropping
   a sounding grain modulates loudness with CPU load, which turns a performance
   problem into an audible one and makes it the user's problem to explain.
2. **Memory is allocated to the configured maximum, never the theoretical one.**
   The Motion Shaper's history is capped at `clamp(4 bars, 2 s, 12 s)`
   independently of the modulation-length menu, and recorded once per module
   slot rather than once per band — 4.6 MB per slot, 55 MB for twelve.
3. **A tier is visible.** The user is told which tier they are on and what it
   costs them, because a plugin that quietly sounds different on a phone than
   on a desktop is the single worst outcome available here.

**The reverb is a feedback delay network with a granular layer, not a granular
cloud alone**, and never convolution. Convolution is disqualified on cost by an
order of magnitude; the FDN is both cheaper and better behaved than the granular
loop, and the grains are what give it the character the brief asks for. Phase 7
builds the FDN first and the grain layer on top.

## Consequences

- The §2.2 budget holds **for Eco**, and is stated that way everywhere rather
  than as an unqualified claim.
- Every Mflop/s figure above is an operation count, not a measurement, and it
  rests on an assumed 2–8 Gflop/s scalar phone core that nobody here has
  verified. Under ADR-0005 these are **MODELLED**, not PASS. The benchmark
  harness measures worst-case per-block time on this host and converts it to a
  required per-core budget; a phone later either meets that number or does not,
  and the negotiation will already have happened.
- The granular reverb's buffer stays **mono**, which halves memory, halves
  interpolation cost, and — per the sheet — sounds better than the stereo
  alternative. Stereo comes from the grain panning, not from a second buffer.

## Escalation

This ADR resolves a conflict between two requirements the user wrote, by
qualifying one of them. The user should know that: **§2.2's "12 plugin
instances" is achievable on a phone at Eco settings and is not achievable at
the maximum settings §6.3 and §6.4 specify**, and no implementation choice
closes that gap — it is arithmetic. If the intent was twelve instances at full
quality, the plugin specifications have to come down, not the engineering.
