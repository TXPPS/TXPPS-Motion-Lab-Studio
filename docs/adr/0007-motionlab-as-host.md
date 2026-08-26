# ADR-0007 — MotionLab Studio hosts the Motion Wave units

**Status:** Accepted. Supersedes part of ADR-0001's staging, not its architecture.

## Context

Seven units are built, verified across twenty-four Ledger cells, and reading
SHIPPING. None of them can be inserted on a track.

`src/` contains no reference to `motionwave/`. The units render only in
`motionwave/ui/dev/`, a standalone harness built by `npm run build:panel` that
nobody but this project opens, and `npm run build` runs neither that nor
`build:wasm`. So the shipped bundle contains no core at all.

That is not a small gap in coverage. **Twenty-four cells can all pass on a plugin
the host cannot instantiate.** Cell 24 measures a unit's face against its own DSP
across the WASM boundary, which is a real boundary and a real test — and it is
not the boundary a user is on the other side of. Nothing in the Ledger, as it
stood, could tell the difference between a unit that works in a DAW and one that
has never been in a DAW.

ADR-0001 anticipated a Motion Wave shell of its own, with the web DAW as the
interaction reference. What it did not weigh is the ordering cost: Motion Wave
has no transport, no tracks, no mixer and no timeline, so a unit has nothing to
be inserted _into_ until Phases 1–3 exist. Building those first leaves fourteen
units unheard for months, which is the wrong feedback loop for audio work — the
defects that matter in a reverb are the ones you notice on the third listen, and
you cannot have a third listen of something that will not load.

## Decision

**MotionLab Studio becomes the host for the Motion Wave units**, now, and the
units are integrated into it rather than waiting for a native shell.

Four things follow, and they are the whole decision:

1. **The MotionLab closure is lifted for integration only.** Directives 03 and
   04 closed `src/` to further work. That no longer holds for the changes needed
   to host the units. It still holds for `docs/BACKLOG_MOTIONLAB.md` — those
   P1s and P2s stay closed, and if one genuinely blocks integration it gets
   fixed with the reason recorded, not reopened as a class.

2. **ADR-0001's Phases 1–3 are deferred, not cancelled.** A native shell is
   still the destination. Nothing here forecloses it, and the adapter below is
   what makes that true rather than a hope.

3. **A host adapter layer sits between the units and `src/`.** The units keep
   their existing C++/WASM interface, their manifests and their `UnitFace`
   rendering; the adapter translates between that and MotionLab's device,
   insert and automation model. The boundary is stated as two prohibitions
   because a boundary described only as an intention is not one:

   - **No MotionLab type appears inside `motionwave/`.** Not in a signature, not
     in an import, not in a comment as a promise.
   - **No unit-specific special-casing appears inside `src/`.** One adapter,
     driven by the manifests, serving all fourteen. A `switch` on unit id in the
     host is the failure this rule exists to prevent, because it is how a
     portable unit becomes a MotionLab unit one branch at a time.

4. **Cell 25 is added to the Ledger and applied retroactively.** It passes only
   in the real application: the unit appears in the insert picker, inserts on a
   track, processes audio audibly, opens an editor whose controls change the
   sound and whose meters move, has its declared latency compensated by the
   host, and round-trips through save and load with an identical render. Any
   unit that fails it drops out of SHIPPING until it passes.

## What this costs, stated plainly

**The web engine's replacement is now further away, not nearer.** ADR-0001's
migration path was that the web target adopts the shared core and the TypeScript
engine is deleted. Hosting the units inside MotionLab means the two engines run
side by side in the same graph — a Web Audio insert chain with WASM units in it —
for as long as this arrangement lasts. That is the "two engines guarantee drift"
cost ADR-0001 named, taken deliberately, in exchange for the units being audible
this month instead of next year.

What keeps it bounded is that the units do not adopt anything from the host. The
drift ADR-0001 feared is a _shared_ feature implemented twice; here the units
implement themselves and the host only routes to them.

**Cross-origin isolation is not available and the transport must not assume it.**
`src/audio/wam/wamHost.ts` and `public/_headers` both record, with reasons, that
this app is deliberately _not_ cross-origin isolated: COOP and COEP would break
cross-origin assets, complicate the service worker's precache, and make hosting
third-party WAM plugins harder. So `SharedArrayBuffer` is absent, and the dev
harness's seqlock frame transport cannot be carried over as it stands. The
adapter uses the `MessagePort` transport instead — which the WAM host already
proves in this app, and which needs no lock at all because structured clone
delivers a frame atomically by construction.

## Alternatives rejected

**Build Motion Wave's shell first.** Correct in the long run and wrong in the
ordering: it is months of transport, timeline and mixer work before a single
unit makes a sound, and every DSP decision taken in that time is taken without
having heard the result.

**Ship the dev panel as the product.** It is a harness. It has no transport, no
project, no automation and one unit at a time; calling it a product would be the
same category error as marking cell 25 PASS against it.

**Port the units to Web Audio.** Discards the entire shared core and every
guarantee that comes with it — the real-time allocation proof, the bit-exact
WASM/native boundary test, the five other platform targets — to save an adapter.

## Consequences

- `npm run build` builds the WASM core and includes it in the bundle, and CI
  asserts the shipped bundle contains it. A green build with no core in it is a
  false green, and that is exactly the state this ADR was written out of.
- The units gain a host they did not have and lose no portability, because the
  adapter is the only thing that knows about both sides.
- A future native shell implements the same adapter interface and reuses every
  unit unchanged. That is the test of whether this boundary was drawn properly,
  and it is deliberately not deferred to being discovered later: the two
  prohibitions above are checkable today, by grep, and are checked.
