# Motion Wave — progress

```
RESUME: F8 — a generated document can be current and empty at once, the build
        goes after the last edit because git refuses otherwise, and three specs
        named a mutation their own criteria could not catch.
Live URL:        https://txpps-motionlab-studio.roan-crest.workers.dev
Deployed commit: 6d59fc8, bundle index-CQjbdB0p.js, sha256 e28ee6a8a788cdf5
                 over 449374 bytes - fetched from the live worker and compared
                 byte-for-byte against a clean-tree rebuild, not matched by
                 name. ac6bedd before it was verified the same way
                 (index-CBhjnBJE.js, 93877b2e96aeb956), and 6649f6e before that
                 (index-UnsIXC-T.js, 5ad510ad95fc4d0d). This line names the tip
                 at the moment it was written, so the commit that edits it is by
                 construction one ahead of what it describes.
                 The rebuild has to happen *after* the commit and this cost
                 twenty minutes to work out. `vite.config.ts` falls back to the
                 wall clock when `git status` is dirty, so the pre-commit build
                 the new push guard wants is stamped with the parent commit and
                 a clock reading and produces a bundle name nothing will ever
                 serve. Two builds, both correct: one proves the tree compiles
                 and records it, the other is the reproducible artefact.
                 The push before it, 5a6f24e, could not have deployed:
                 splitting `scripts/checks/mutants.mjs` moved the scripted-press
                 string literal that proves `gesture-guard` can fail into a file
                 the guard does not exempt by name, so `npm run build` exited on
                 it. Caught in the clean-tree rebuild before the four minutes of
                 polling, which is the one improvement over the last time this
                 happened - and the cause is plain: the build was run *before*
                 the split and not after. `check-checks --check`, lint and
                 format all passed after it, and none of them is the build.
                 The build is the check; it goes after the last edit.
                 The push before that, bf52af2, never deployed either:
                 `docs-guard` ran `git cat-file -e` on eleven commits
                 Cloudflare's shallow clone had never fetched, failed all
                 eleven, and exited the build. Fifteen minutes of polling for a
                 bundle that was never coming. A claim about the repository,
                 made from a truncated copy of it, is BLOCKED-is-a-claim-about-
                 the-host again - and `docs-guard` now has a satisfiability
                 case that clones this repository `--depth 1` and proves it.
                 A note on "clean": `git status --porcelain` once reported 576
                 modified files after the tree was normalised to LF while
                 `git diff` reported none - a stale index stat cache, which
                 `git add --renormalize .` clears. Until it was cleared every
                 local build compiled in the wall clock and no two hashed
                 alike. Clean means committed, not merely rebuilt.
Bundle verified: every deploy is checked by fetching the live bundle and
                 matching its hash against a clean-tree build. Cloudflare takes
                 260-280 s to pick one up; a check that does not wait that long
                 reports the previous bundle and calls it a match.
                 This line names the tip at the moment it was written, so the
                 commit that edits it is by construction one ahead of what it
                 describes. Said plainly rather than left to be noticed.
Current section: F8 COMPLETE. Every GENERATED document now declares what it
                 must contain as well as what it describes, because `SOAK.md`
                 was current and empty at the same time and nothing could see
                 it. The build's last step records the tree it read and
                 `.githooks/pre-push` refuses a push that is not that tree -
                 the commit that could not have built is now a thing git will
                 not let happen. And the voice spec was swept for rows that
                 name a mutation their criteria cannot catch: VS-02, VS-23 and
                 §5.2's formula (3), all three corrected with the version they
                 replace kept on the page.
                 §7 has `trigger_bus.h` and `envelope.h` - the envelope's
                 halves of VS-07, VS-08, VS-09, VS-11 and VS-12.
Next action:     §7 continues. Five of the substrate's twelve files are built
                 (`note_id.h`, `note_registry.h`, `voice_set.h`,
                 `trigger_bus.h`, `envelope.h`) and `ledger-guard` derives that
                 count from the design's own file table rather than trusting a
                 sentence. `envelope_shapes.h` is next - the five measured
                 shape families, which is what turns VS-10, VS-11 and VS-12
                 from envelope-engine claims into instrument ones. Then
                 `lfo.h`, `mod_grid.h`, `drift.h`, `mpe.h`, `portamento.h` and
                 `specs.h`; then the Slipstream Sampler on the substrate, then
                 SA-001, then the five synths.
                 SA-001 stays open: the load route exists, and nothing
                 analyses what it loads. See "Where SA-001 sits" below for the
                 order and the argument for it.
Function Ledger: 401 functions, **228 with a state-asserting test - 56.9%**.
                 Two instruments: the functional soak drives 136 against a
                 running browser on three form factors, and the store sweep
                 drives 159 in `npm test`. 106 rows have no case at all - 87
                 actions and 19 surfaces - and are named under "Never driven".
                 The denominator moved 403 -> 401 and the reason is a defect:
                 the ledger's store axis read every two-space-indented
                 function-typed field in a store file, so `DialogState.onSubmit`
                 and `MenuItem.action` were rows. Neither is a store action.
                 Found by writing a recipe for every store row and running out
                 of things that were stores.
Open P1s:        None. The suite has no failing case.
                 The console's target-size question is CLOSED, by WCAG 2.5.8's
                 equivalent-alternative provision rather than by moving a
                 number: the options menu carries every command the inline
                 controls offer, its entries are 44 px on a finger, and on
                 touch the 5 px power lamp is dropped rather than grown. The
                 inline controls are fine-pointer shortcuts and are exempt
                 while that stays true, which `tests/deviceMenu.test.ts` is
                 what keeps.
                 `devicewindow.spec.ts` was recorded as failing on 11 px
                 against 44. It was not: Escape closed the window under an open
                 menu and left the menu covering the button, and a decorative
                 meter took presses aimed at the rack. Both are fixed and all
                 42 offered devices pass.
                 The rack P1 it was recorded as is CLOSED, and it was not what
                 it said: pressing a strip mounted the Channel Overview, which
                 took 44% of the mixer pane, and the Insert button moved 107 px
                 between pointerdown and pointerup - so the only way to add a
                 device to a channel did not work with a mouse. See the section
                 below for the three measurements.
                 The bypassed-insert P1 is CLOSED: the difference was a
                 mono/stereo pan-law change, x1.414214 exactly, and
                 `InsertChain` routes a bypassed insert around itself now.
Suites:          typecheck (four projects), lint, format, 2018 unit,
                 351 motionwave, 43 core suites, 367 e2e all passing,
                 34 panel tests.
                 `npm run check-checks`: 29 declared checks, 24 on every push,
                 2 documented, 3 manual with a reason. 20 gates: 19 HELD,
                 1 KEPT with a reason, **0 BLOCKED**, 0 DECAYED, 0 BROKEN.
                 It was 2 BLOCKED for three directives, on a host that could
                 run both - see the section below.
                 `npm run parity-guard`: 947 claims in 427 sections - 806
                 checked against the audit's own citations, 13 pinned to a
                 predicate, 141 recorded as needing judgement with a reason.
                 454 MISSING and 263 PARTIAL still open.
                 `npm run docs-guard`: 70 documents - 4 generated, 13 guarded,
                 53 narrative. None records unchecked state.
                 `npm run gesture-guard`: 93 files swept; every scripted press
                 and every touch context pressed with a mouse has a reason.
                 `npm run soak`: 69/136 functional rows with a state-asserting
                 result, 10,000 fuzz steps with every invariant holding, 10 of
                 10 properties, endurance all PASS at 37 KB/min after warm-up -
                 18 MB over an eight-hour session. `docs/audit/SOAK.md` had been
                 tracking a FAIL on the bounce-alignment property since before
                 it was fixed; it is regenerated against the bundle named above.
                 `npm run test:core`: 43 suites, 0 failures.
                 `npm run probe:mutations`: 26 corrections -
                 **20 HELD, 4 BLOCKED, 2 KEPT with a reason, 0 DECAYED**. The
                 four BLOCKED are branches this host's scope did not enter -
                 tapFailures, scrolls and confirmations all zero on this run -
                 and BLOCKED is not DECAYED: the registry's `exercisedBy` names
                 the row that tells them apart.
Open deviations: F11 is left to the browser's fullscreen — the one place the
                 reference's panel map is not matched.
                 §2.5's monitoring modes and latency compensation are
                 DIVERGENT-BY-DESIGN; §3.1 reopens the take-alignment half,
                 which is a different problem and is not divergent.
                 recordingController.ts is 630 lines against the ~400 rule.
                 src/components/sampler/SamplerPanel.tsx is 1804, and grew by
                 ~120 this session. It is four instruments over one zone model
                 and each view owns its top half, so it is describing four
                 things - the split is real work and was not this directive.
                 src/audio/effectChain.ts is 2790, long-standing.
                 scripts/soak/properties.mjs is 425 against the same rule, and
                 grew there this session.
                 A bounce still carries the master safety limiter's 264 samples,
                 which is a measured Chromium constant rather than a declarable
                 one - see KNOWN-LIMITATIONS.
Ledger:          **7 of 14 SHIPPING** - Motion Shaper, Program EQ, Optical
                 Leveller, FET Limiter, Variable-Mu, Console EQ and Granular
                 Reverb, all 27 cells PASS. `fx-02` publishes where its grain
                 cloud is reading now; the grain *count* is a spawn rate times a
                 length and sat at 22 whatever was playing.
```

## The rack was bigger than the channel that held it

Items 12 to 14, and the number that made them one piece of work rather than
three. A console strip on a tablet in landscape has **131 px**. The device
rack's derived touch floor is **140** — one 44 px device row, the gap, the 44 px
Insert button, the padding, plus another 44 for the instrument. Delete the name,
the fader, the meter, the mute, the solo, the readout and the routing and it
still does not fit.

That is why the three landscape fixes last directive each traded the defect for
another one. The floor is not wrong: a device row clipped part-way down yields
an options button under the touch minimum, which is a device on the channel that
cannot be bypassed, moved or removed. **The floor is right and the container is
wrong.** A vertical list of 44 px rows does not go in a 112 x 131 box.

So the chain moved to the axis a landscape screen actually has.
`docs/design/channel-strip.md` is the argument, written before the build, and it
now carries a section on the four things the build corrected in it.

- **Item 12.** `ChannelOverview` was a band inside the mixer taking 116 px of the
  pane, and the height came off the strips. It is `ChannelView` now, one entry in
  `app/editors.ts` — so it appears on the phone's editor strip, the tablet's
  combo and the desktop's bottom editor at once, which is what that registry is
  for. Measured on all five form factors: nothing drawn outside the view, and no
  vertical overflow anywhere.
- **Item 13.** One tap opens a device's window, a second closes it, a double tap
  shows its quick controls. Both racks moved, because two identical-looking
  controls answering the same press differently is worse than either arrangement.
  The double tap **reverts** the open its own first tap did, rather than the open
  being deferred by an interval — that would put 250 ms on every open to serve
  the rare gesture.
- **Item 14.** An output is an arrow and a send is a knob: an arrow has no
  quantity and a knob is nothing but quantity. And the defect the item names —
  `Mixer.tsx` merges buses with FX returns and hands the list to the strip's
  _output_ menu, so an FX return has been offered as an output destination for as
  long as the type has existed.

**Phase A only.** The console strip is untouched, so nothing regresses and the
two `landscape.spec.ts` `test.fail` cases stay red-by-design — the strip they
describe has not changed. Phase B is the strip's tiers and it is what deletes
those two by name. It is deliberately not in this deploy: it is the half that
cannot be undone channel by channel, and it should not be built against a design
nobody has looked at yet.

### Three things the build found that the design had not

**A window must not cover the control that opened it.** On a phone the first tap
opened the device window on top of the rail card, so the second tap landed on the
EQ curve _inside_ the window and "tap again to close" was unreachable by any
gesture. `elementFromPoint` at the card's centre returned `svg.fx-curve`. Nothing
was too small and nothing was off screen; the control was behind something — the
sampler library's lesson, arriving from a new direction. `placeClearOf` opens
below the opener, then above, then falls back; the sweep that proves it found a
band where neither side fits and corrected the claim from "never overlaps" to
"clears it wherever clearing it is possible".

**`fireEvent.doubleClick` dispatches a lone `dblclick` and no clicks at all.** A
browser sends click, click, dblclick. The gesture reads clicks, so three unit
tests built on the synthetic event were asserting against an event sequence no
person can produce. They send two stamped clicks now.

**Freezing `performance.now()` freezes React.** The first version of those tests
mocked the clock so two presses would land in the same instant — and React's
scheduler reads that clock, so the re-render never came and the assertion failed
for a reason that had nothing to do with the product. The gesture reads the
event's own timestamp now, which is both testable and more correct: it is when
the input happened rather than when the handler ran.

## Asking the matrix instead of guessing at it

`npm run route -- <surface> [form]` prints how a surface is reached, per form
factor, out of `docs/audit/REACHABILITY.md`. Three runs went into
`editor-tab-synth` on a phone — which has no such tab — while the matrix had
recorded `nav-perform` all along. That is the second tracked answer re-derived
because asking was awkward, so asking is a command.

`route:check` runs in the build and fails when the matrix's two tables stop
agreeing, which is what stops the index rotting quietly against a format change.
Its gate HELD and its satisfiability case ACCEPTS — and building that case found
a real defect in the mutation harness: two edits to one file shared a backup
name, so the reverse-order undo restored the once-edited copy, deleted the
backup, and left the _first_ edit sitting in a tracked file. Backups are unique
per call now, and that case is written as two edits rather than one string
precisely so it keeps exercising the fix.

## The parity guard refused a build that deleted a file it cites

Removing `ChannelOverview.tsx` broke four citations and one pinned claim:
`backlog/ra-006-insert-button` recorded PARITY on the presence of
`useSettledSelection` — the hook that held the console's _layout_ still while a
band mounted under a pressed pointer.

The claim is still true and it is true for a better reason: nothing in the
console mounts on selection any more, so there is no layout to settle. The
predicate is re-derived rather than re-pointed — it names
`tests/components/mixerSelection.test.tsx`, which measures that the console
renders the same thing before and after a channel is selected, and carries a
non-vacuity case that mounts a band and requires the measurement to move. A
predicate naming an implementation goes stale the moment something better
replaces it, which is exactly what happened here.

## Currency is not completeness

`docs/audit/SOAK.md` was overwritten with three lines and `docs-guard` stayed
green through all of it. The currency rule compares the source fingerprint the
report declares against `src/`; a partial run copies that fingerprint forward
correctly; the "Generated by" header is written before there is anything to
render. So the document was current, correctly stamped, correctly classified,
and empty at the same time, and every question the guard knew how to ask came
back yes.

**Everything that says a generated document can be trusted is written before it
has any content in it.** That is the whole of the class, and it is not specific
to soak: every generator here assembles its header first and renders from what
it measured second, because there is nothing else it could do.

So each GENERATED entry in `scripts/docs/registry.mjs` now carries a `must` —
the sections it has to contain, the shape of each, and a minimum it cannot be
below. `SOAK.md` must have all four numbered layers and the page-errors section;
`soak-coverage.json` must have its stamps and one record per row with `id`,
`forms` and `covered`; the Function Ledger must carry a coverage line, a "Never
driven" section, and a row table; `REACHABILITY.md` must have the matrix and both
verdict sections, which is where a defect is _reported_ and which a sweep that
measured nothing would render empty and read as "no defects".

**A floor is derived or it is one.** A minimum chosen to sit just under today's
measurement is a constant fitted to the thing it checks, and this repository has
paid for one of those — the Optical Leveller's attack, re-fitted three times,
each fit absorbing an interference rather than removing it. So where a number can
be derived it is: the soak's property table must have one row per property
`scripts/soak/properties.mjs` defines, and the Function Ledger's row table must
be as long as the total the ledger's own kind table states. That second one is
the strongest of the five and needs no constant at all — the total is arithmetic
over the enumeration and is computed before a single row is rendered, so a
truncated ledger keeps it and the two halves disagree by construction. Where
nothing can be derived, the floor is one, which says "not empty" and cannot be
fitted to anything.

The mutation the directive asks for runs on every build rather than in a sweep
somebody remembers. `docs-guard` truncates each of the five to the stub its own
generator would write having measured nothing — everything above the first `##`
for markdown, `rows: []` for JSON, which is exactly what the fifty-four probe
runs produced — and requires all five to be rejected. Without it the `must` lists
would be a set of shapes that happen to match the files in the tree, which is
indistinguishable from no rules: they would pass on the real documents and pass
on the stubs, and the column would be green either way.

The rules bite in both directions. Truncating `SOAK.md` for real produces six
failures, and the sixth is the interesting one: `soak-coverage.json` reported
that its minimum _could not be derived_, because the sentence it reads that
number out of had gone with the truncation. A check that cannot ask its question
says so rather than passing.

## A gate can be load-bearing in more than one way

`docs-guard` enforces four unrelated rules and had one mutation, which could only
ever speak for one of them. The completeness rule would have been proved by
nothing at all while the entry read HELD.

So `mutate` takes a list and every edit in it has to turn the check red.
`docs-guard` now carries three: a verdict table added to an ADR, the fuzz section
removed from `SOAK.md`, and the store sweep's rows emptied. `ledger-guard`
carries two: a unit marked SHIPPING with no cells, and the substrate progress
count moved off the tree.

**It reported DECAYED on its first run and it was right.** The third edit was
written as `"rows": [` → `"truncated": [], "rows": [`, which adds a key beside
the rows and leaves the rows where they were. Nothing was truncated, the guard
correctly passed, and the verdict said so: a gate that reads HELD under an edit
that changes nothing is exactly the green column this apparatus exists to
prevent, and it caught a mutation that did not mutate.

## The build goes after the last edit, and git enforces it

A commit was pushed that could not have built. The cause is not interesting and
that is the point: the build was run, then a file was split, and the build was
not run again. `check-checks --check`, `lint` and `format:check` all passed
afterwards, and not one of them is the build.

A rule that depends on remembering is not a rule — this repository has learnt
that three times now, twice from `git add -A` sweeping another agent's work into
a commit. `WetDryMixer`'s constructor is private and `scope-guard` refuses an
undeclared commit for the same reason.

So the build's last step records what it read, and `.githooks/pre-push` compares.
The record is a manifest of path → blob for everything git would put in a commit
made from the working tree, hashed through a **scratch index** rather than the
repository's own — `git add -A` against the real index would stage the
developer's tree as a side effect of running a build, which is the sweep this
rule exists to prevent, arriving through the guard against it.

The comparison is deliberately not two tree hashes, and the reason is the
satisfiability rule from F7. A tree hash of the working copy includes untracked
files, so one scratch file that never gets committed would refuse every push for
ever — and **a check that refuses work nobody did wrong gets turned off**. So it
runs over the paths that are actually in the commit:

1. every path in the pushed commit is in the manifest with the same blob, which
   catches a file edited after the build and a file the commit carries that the
   build never read; and
2. every path the manifest says was _tracked_ is in the commit, which catches a
   deletion made after the build — rule 1 cannot see one.

An untracked path is in neither, which is right: it is not in the commit, so it
is not part of what is being pushed.

`BUILD_OK_ANYWAY='reason'` is the override and it takes a reason for the same
reason `MW_SCOPE_ALSO` does — the reason is never inspected, and having to write
one is the mechanism. `npm run hooks:install` points git at `.githooks`, and
`prepare` runs it on `npm install`, because a hook that has to be installed by
hand is in the same class as the rule it replaces.

Two smaller findings came out of building it. Reading stdin unconditionally hung:
outside a hook stdin is a pipe nobody is going to close, so `readFileSync(0)`
blocks for ever and the guard looks like a guard that has crashed — the hook now
passes `--from-stdin` and a person does not. And `check-checks` grew a third
route, `hook`, beside `ci` and `documented`: a git hook runs without anybody
choosing to, which is the property CI has, and calling it _documented_ would say
the ordering rule is enforced by somebody reading `CLAUDE.md`. That is the rule
that had already failed.

## Three specs named a mutation their own criteria could not catch

VS-02 said "replace the partition with a boolean flag per voice and this case
must fail by name". Its three stated criteria — every `VoiceId` exactly once
across free ∪ allocated, `liveCount()` equal to the allocated span, zero
duplicates — all _hold_ under that mutation. The array is never reordered, so it
stays a permutation, and the count agrees with the span because both are read
from the same counter. What the flag breaks is disjointness of ownership, and
nothing was asking about it.

That is a spec-level instance of the cell-title failure: a row that tests what
its title implies rather than what its criteria say. So §8 was swept for the
shape — every named mutation and every "an implementation that does X fails"
clause — and two more turned up.

**VS-23, from the other end.** "Lower zone 10 members, then upper zone 10
members. The two sets are disjoint; total members ≤ 14; the lower zone was
truncated, not the message ignored." A receiver that recomputes only the
addressed zone gives 10 and 10 and fails disjointness, so that one was caught. A
receiver that _ignores_ a configuration it cannot fit gives 10 and 0 — disjoint,
and comfortably under 14. The outcome the row's own prose says must not pass was
passing every number beside it. Corrected to exact counts: lower 4, upper 10,
total 14, which separates all three implementations.

**§5.2's formula (3), which is the one that would have shipped.** The design
writes the exponential curve as `(1 − e^(−k·x) − e^(−k)·(1 − x)) / (1 − e^(−k))`
and says it "carries a subtraction that forces the segment to actually reach its
target rather than approach it forever". That is true: it is exactly 1 at x = 1.
It is −e^(−k)/(1 − e^(−k)) at x = 0 — about −3.1 % at k = 3.5 — because the
numerator carries the offset _and_ the whole expression is divided by the same
quantity, and the two corrections agree only at the far end. Every segment starts
a step away from where the one before it ended. Every segment boundary is a
click.

Adding `e^(−k)` back to the numerator and dropping the division gives
`f(x) = 1 − e^(−k·x) + e^(−k)·x`, which is 0 at 0 and 1 at 1 by inspection and
monotonic for every k > 0 since `f'(x) = k·e^(−k·x) + e^(−k)`. Mutation-tested:
the design's version fails `no segment boundary is a step, for any curve` and
fails nothing else, which is why it would have shipped — a 3 % click at each
boundary is a defect you hear as "this synth sounds a bit dirty" rather than as a
number that is wrong.

All three corrections are the same move: replace a consequence stated in prose
with the observable that distinguishes it, and keep the version being replaced on
the page.

## §7 — the trigger bus, and the envelope

`voice/trigger_bus.h` comes before every generator because every envelope, ramp
and LFO subscribes to it. Two one-step pulses and a level: `single` for a note-on
to a voice that is not gated, `multi` for any note-on plus a note-off to a voice
that is _not_ gated, `gate` from note-on to note-off. Five instruments' worth of
retrigger behaviour is one rule read from one struct.

Two things in it are decisions rather than transcription. **The gate is read
before it is raised** — raising it first would make every note-on look like a
retrigger of a gated voice, so `single` would never fire after the first note
and every generator would still be triggered by `multi`, which means the patch
sounds broadly right and the distinction the file exists for is gone. Mutation-
tested: reversing those two lines fails two cases by name and nothing else.
**And a pulse is broadcast, not consumed** — nothing clears a pulse by reading
it, because if the first subscriber to look cleared it then whichever generator
happened to be advanced first would silently own the trigger. That is an ordering
dependency between two envelopes that have nothing to do with each other, and it
shows up as "the filter envelope retriggers and the amp envelope does not,
sometimes". The bank clears at `endStep()`, once, after everybody has advanced.

Twelve cases, including the statement they add up to: four keys pressed into one
voice give one `single` and four `multi`.

`voice/envelope.h` is eight segments, any of which may be the sustain point and
any of which may end the shape — a dedicated "sustain stage" serves ADSR and
nothing else, and one consumer has eight stages with a pre-attack delay. It is
written as **one position, two ways of moving it, and the curve a pure function
of that position**: `Duration` advances x at `1/(parameter·fs)` so a segment takes
its parameter in seconds however far it travels, and `Rate` advances the same x at
`parameter/distance` so time falls out of the distance. Four recursions — a curve
times a drive — would be four places to forget that a segment has to _arrive_,
and a segment that never arrives never advances, so the voice never retires. That
is a stuck note made of arithmetic, and it would pass every note-handling test
there is.

Eighteen cases, closing the envelope's halves of VS-07 (identical at block sizes
16/17/64/128/1024, to 6e−8), VS-08 (the same patch takes the same wall-clock time
at 44.1, 48, 96 and 192 kHz, within 0.5 %), VS-09 (a zero-distance segment takes
`zeroDistanceSeconds` and never zero samples — with `freeRun` set, a segment of
zero length is a loop that never leaves one `advance` call, which is a hang on the
audio thread rather than a wrong number), VS-11 (a target-seeking attack reads
0.6225 at the half-way point, the number that separates a faithful short attack
from a soft one) and VS-12 (decay duration does not move with the sustain level,
which is measured behaviour a textbook capacitor model gets wrong by being
reasonable).

`ledger-guard` now derives the substrate's progress count from the design's own
file table and the filesystem, because the sentence it replaced — "ten of the
twelve files remain, and the next is `voice_set.h`" — was true when it was
written and false one directive later, with `voice_set.h` in the tree. That is a
GUARDED document recording state by hand inside a guard that was only reading the
table above it.

## One pattern, one hundred and eighty-six store mutators

159 of the Ledger's 186 store rows had no case at all, and they are the cheapest
rows to cover and the most valuable — undo, persistence and the engine graph all
meet there. So they were swept as a batch under one shape
rather than argued about one at a time.

The shape is four phases, and each is a separate claim:

1. **It does something.** The store's serialisable state must differ. This is
   what stops a wrong recipe reading as green, and it is why the arguments could
   be hand-written without the assertions being negotiable.
2. **Undo behaves as declared.** Each recipe says `undo: 'step'` or
   `undo: 'none'` and **both are checked**: a step pushes exactly one entry and
   restores exactly, none pushes nothing. The declaration lives in the recipe
   rather than being read out of the store, because reading it out of the thing
   under test makes the check a restatement.
3. **The change survives a save and a reload.** Not "the project still
   validates" — the paths the action _wrote_ are diffed and every one of them
   must still hold its value after `validateProject`. A reload may add defaults;
   it may never drop or alter what was written.
4. **It is serialisable, and it reaches storage.** For the eight shell stores,
   which have no undo and no document: a change JSON cannot carry is the defect
   worth finding, and where the store persists, the persisted blob must move.

`cases.mjs` warns against exactly this kind of sweep — "a generated invocation
would call every action with plausible-looking rubbish, observe that something
changed, and report coverage of a behaviour nobody specified" — and the warning
is right about _generated arguments_. The split is what answers it: the
arguments are hand-written per row and the assertions are identical for all 186.
The recipe says what to call; the harness says what must be true of any store
action; neither can be weakened without the other noticing.

**Thirteen of my own undo declarations were wrong on the first run**, and every
one of them was mine rather than the store's — `setBpm`, `setLoop`,
`trimClipStart`, `setClipGain`, `updateNotes` and the rest are drags, wrapped in
a gesture by the caller, and the gesture is what collapses a hundred writes into
one Ctrl+Z. Three went the other way: `setSend`, `setCueMix` and `registerMedia`
push a step and should, because the click that first enables a send is a
decision that has to be undoable on its own. Re-deriving each from _what the
action is_ rather than re-fitting to what the store did is the difference
between a check and a transcript.

**The ledger's denominator moved 403 → 401, and the two rows that left were a
defect.** The store axis matched every two-space-indented function-typed field
in a store file, so `uiStore.ts`'s `DialogState.onSubmit` and `MenuItem.action`
were rows in the Function Ledger. Neither is a store action — they are callbacks
a caller supplies. Both had been permanently undriven and permanently
uncoverable, which is what made them invisible: a row nobody can drive looks
exactly like a row nobody has driven yet. Found by writing a recipe for every
store row and running out of things that were stores. `create<Name>` is what the
store is actually built from, so the enumeration reads that block and nothing
else in the file.

**228 of 401 — 56.9%**, from 69. Two instruments now, and each row says which
one covered it: the functional soak drives 136 against a running browser on
three form factors, and the store sweep drives 159 in `npm test`, which means
those rows are current on every push rather than as of the last twenty-minute
soak. A store-sweep row reads `n/a` in the form columns rather than `?`, because
a store mutator is the same code on a phone and a desktop; what differs per form
is whether anything can _reach_ it, and that is `npm run reachability`'s subject.

106 rows still have no case at all: 87 actions and 19 surfaces. Named, as
before.

---

## Every check now says how it can pass

Two standing rules, both out of the deploy `docs-guard` took down.

**A guard that asks git anything declares what kind of copy can answer it.**
One line — `// @clone: working-tree | index | full-history` — which
`scripts/checks/clone.mjs` reads and `check-checks --check` enforces. Declaring
`full-history` carries an obligation: the script must detect a shallow clone and
skip that part with a note, and the build fails if it does not. Three scripts
invoke git and all three now declare. The rule is proved rather than asserted:
`docs-guard`'s second satisfiability case clones this repository `--depth 1` and
runs the guard inside it, which is the failure reproduced rather than remembered.

**Every check must be provably satisfiable, not only falsifiable.** This is the
larger of the two and it is the one the currency rule failed. A mutation says a
check is load-bearing. It says nothing about whether the state the check demands
can ever be reached — and `docs-guard`'s currency rule was load-bearing and
unreachable at the same time: it compared a bundle name that `vite.config.ts`
changes on every commit, so committing the report it wanted invalidated the
report. It would have held its mutation test. **A check that cannot be satisfied
gets turned off**, and turning one off is this apparatus failing by a side door.

So every entry in `scripts/checks/mutants.mjs` carries a `satisfy` case beside
its `mutate` one, or a `satisfiedBy` reason why none can be constructed. The
strongest form is `repairedBy('npm run …')`: **apply the gate's own mutation,
run the writer its error message names, and require the check to go green
again.** That is not "some state passes" — the tree we started from already
passes — it is "the state this check demands is reachable by doing what it tells
you to do", which is exactly the question the currency rule could not answer.
Nine generator checks are proved that way. The guards that have no writer get a
legal addition they must tolerate: a permissively licensed source, a document
_with_ its registry entry, a spec that presses through `e2e/pointer.ts`, a file
staged inside the declared scope, a rename made in both the probe registry and
its call site.

`ACCEPTS` / `REFUSES` / `KEPT` / `BLOCKED` / `BROKEN`, and `REFUSES` fails the
run. `check-checks --check` refuses a check that declares neither, so this
cannot decay into the subset somebody got round to.

**It found a decayed mutation on its first run.** `docs-guard:release`'s gate
renamed the _bundle_ `SOAK.md` declares — and the currency rule had stopped
reading the bundle when it moved to the source fingerprint, so the mutation went
through and the check still passed: DECAYED, on the very check this directive's
lesson came from. Its anchor is the `- **Source**` label now rather than the
digest, because a digest changes whenever `src/` does and an anchor with an
expiry date reads BROKEN later.

---

## Where SA-001 sits, and why the substrate goes first

The question was whether the analysing importer (smp-01 §3, six of seven steps
absent) comes before or after the voice substrate, given that Slipstream is
supposed to _prove_ the substrate for the five synths.

**Substrate first, Slipstream consumes it, SA-001 before the synths.** The
argument, since it is worth making rather than asserting:

The two are not the same kind of work and they prove different things. The
substrate is a **shared** contract — the five synths and the sampler all take
their voices, envelopes, LFOs, glide and MPE from it, and what "proven through
Slipstream" means is that the contract survived one real consumer. That claim is
about `voice/`, and it is exercised by any instrument that allocates voices,
holds notes and steals under load. A sampler with a hand-loaded zone does all of
that. The importer does none of it: transient detection, pitch detection and
auto-zoning run **before** a note is ever pressed, produce a `SampleZone[]`, and
hand it to the same `addSamplerZones` a person's finger reaches through today.
There is no substrate interface on that path at all.

So building SA-001 first would not make the substrate better proven. It would
delay every one of the twelve substrate files behind seven DSP steps that the
substrate does not touch, and it would do it in the order that costs most:
`voice_set.h` is what closes PA-003 by construction, and PA-003 is a _shipping_
defect in two instruments.

The reason SA-001 must still come **before the five synths** is different and it
is about what "proven" is allowed to mean. Slipstream is the proof consumer. If
it ships with one of its seven specified import steps built, then "the substrate
is proven through Slipstream" is a claim about a Slipstream that does not exist
yet — and the five synths would be built on a contract validated by a partial
instrument. That is the shape of every stale document this project has found:
a true sentence about a thing that has since moved.

The order, then: **substrate (12 files) → Slipstream on the substrate → SA-001
closes → the five synths.** Slipstream proves the substrate; SA-001 makes
Slipstream the instrument the spec describes; the synths inherit both.

---

## §6 — a note too short to resize had no way to be resized

The piano roll backlog is built and has been for a directive: independent zoom
axes, a 56 px lane floor clamped on read, a resize grip with a short-note rule,
a drag readout placed where the finger is not, a nudge pad, chord stamping and
scale lock. Fifteen e2e cases across two specs drive them with a real pointer.

What was not built was the other half of one of them, and `geometry.ts` said so
in its own comment without anybody reading it as a gap. A note narrower than
24 px gives up its resize grip so that dragging it still _moves_ it — and the
comment adds that such a note "is moved by dragging and resized from the toolbar
or the keyboard". The keyboard is a complete answer for a desktop and none at
all for a phone. The toolbar's only length commands were **Double (×2)** and
**Half (÷2)**, which cannot reach a dotted sixteenth from a sixteenth, or
anything else that is not a power of two away.

So for exactly the notes whose grip had been removed to make room for the move
gesture, the resize capability was absent on touch. Capability parity failing in
the one place the affordance divergence had been argued for.

`pr-len-shorter` / `pr-len-longer` are that capability: one snap step, either
way, the same edit Alt+←/→ makes. 44 px on a finger, measured by pressing.

And the class is now guarded rather than noticed. `tests/pianoRollParity.test.ts`
enumerates every `case` arm and every modifier branch in the roll's key handlers
straight from the source, and each must name the on-screen control that makes
the same edit or say why it needs none — a cell cursor's equivalent is touching
the cell. A keyboard command added without either fails the build. Mutation-
tested by renaming the length control's test id: two cases red, by name.

---

## The mutation sweep was overwriting the soak report with a stub

Found by `git diff` during the verification run, not by any guard.

`npm run probe:mutations` scores each recorded probe correction by running
`scripts/soak.mjs --layer=properties --seed=…` twice — twenty-seven corrections,
fifty-four runs. Every one of those runs reached the bottom of the script and
wrote `docs/audit/SOAK.md`. With only the properties layer selected there is no
functional sweep, no fuzz and no endurance to render, so the file came out as
**three lines**: the header, a bundle, a seed. 195 lines gone.

`docs-guard` did not notice and could not have. Its currency rule compares the
source fingerprint the report declares against `src/`, and a partial run copies
that fingerprint forward correctly — the document was _current_ and _empty_ at
the same time. A wrong document is worse than a missing one; a truncated one is
worse still, because it keeps the shape of the thing it replaced.

The rule now: **a partial run measures, and only a full run writes the report.**
`--quick`, or any `--layer=` that does not name all four, writes `soak-out.json`
and says in as many words that it has not written `SOAK.md`. `soak-out.json` is
gitignored and is what the mutation driver reads its metric from, so nothing
that needed the write loses it.

`soak-coverage.json` had the identical hole and is guarded by the identical
line: coverage written from a scoped functional layer would be read by the
Function Ledger as the whole sweep's answer.

## A property failed on one seed in fifty, and the product was right

`automation-reads-back` went red on the verification run: _seed 1787778238,
beat 13.17: wrote 0.0887, read 0.8398_. It had passed on the seed before it and
on every seed since the property was written.

The property writes sixteen points at random beats on one lane and, after each,
looks up "the point at that beat" and compares its value. Sixteen draws from
6401 beats collide about one run in fifty — and `addAutomationPoint` **appends**
rather than replacing, so two points can share a beat. The lookup found the
_earlier_ of the two and reported the product had read back somebody else's
value.

The product is right to allow it. `laneValueAt` guards a zero-length span and
returns the later of the two points, and `Array.prototype.sort` is stable, so
the parameter takes the value that was just written — which is what the property
was actually claiming. Nothing in the audio path can see a stacked pair.

Corrected to look up by the id `addAutomationPoint` returns, which is what the
action hands back and what every caller already holds: the identity the claim
was always about. **Mutation-tested before believing it**, on the seed that
exposed it — `soak/automation-point-by-id`, corrected PASS, defect restored
FAIL, verdict HELD. Twenty-seven registered corrections now.

Worth recording because of what it nearly cost in the other direction. A
property that goes red one run in fifty for a reason that is not the product is
a property nobody believes when it is right, and the cheap resolutions were both
wrong: widening the tolerance would have hidden a real read-back failure, and
making the store replace a point at the same beat would have changed shipped
behaviour to satisfy a test. The rule held — suspect the probe, then _prove_ the
probe — and the proof is the part that had to happen before the correction was
believed.

## §7 — the partition PA-003 cannot come back through

`voice/voice_set.h`, and VS-01, VS-02, VS-05 and VS-30 are closed.

PA-003 was the same defect in two unrelated instruments: sixty simultaneous
note-ons against a capacity of twenty-four produced **sixty** sounding
oscillators and one steal, and the sampler answered eighty live against a cap of
forty-eight. Both stole by running over the allocated set without removing each
victim as they took it, so every pass chose the same voice and the loop ran out
of iterations rather than out of work.

The fix is structural rather than careful. **A voice's membership is its position
in a permutation, not a flag:** `slots[0..live)` is allocated and
`slots[live..capacity)` is free, and every operation is a swap and an increment.
Two flags can disagree with each other and with a count; a position cannot be in
two places. And `stealOne` returns **nothing at all** — the victim leaves the
allocated span and `allocate` takes its voice from the free span like every other
path, so there is no value in the class for a caller to hold and no way to write
the loop that produced the defect.

VS-01 reads exactly as the directive that recorded PA-003 does: 60 against 24
gives `liveCount() == 24` and `stealCount() == 36`; 80 against 48 gives 48 and 32. A third case asks the same question of the _worst_ value rather than the
final one, because a set that overshot to sixty and recovered before anybody
looked would pass both — and sixty oscillators is what the defect sounded like.

**Writing the tests found a defect in my own implementation**, which is the
point of writing them first: `stealOne` freed a slot and `allocate` used the
victim directly, so the allocated span ended one shorter than the number of
voices sounding. PA-003 with the sign flipped, and just as invisible from
outside — six of the eleven cases caught it.

VS-02 walks the permutation after a hundred thousand randomised operations and
requires every id to appear exactly once. **The mutation the spec names — replace
the partition with a flag per voice — showed that case was too weak on its own.**
Degrading `freeAt` to a bare decrement leaves the array untouched, so it is still
a permutation and the hundred thousand operations pass; what breaks is
_disjointness_, a voice with an owner sitting in the free span where the next
allocation will hand it out while it is still sounding. Both are checked now,
every step, and the mutation fails both VS-02 cases by name.

Three of the substrate's twelve files are built. `trigger_bus.h` is next — 110
lines, and every envelope, ramp and LFO subscribes to it, so it comes before
`envelope.h`.

## The sampler had no way to load a sample

Not a partially-working feature. Four things looked like routes and none of them
could put _your_ audio into an instrument:

|                                                |                                                                                                                                                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the drop targets                               | `text/x-ml-media` on the quick sampler, the pads and the zone rows. HTML5 drag-and-drop is a **mouse protocol** — a finger never produces `dragstart` — so on a phone and a tablet this was not a hard route, it was no route |
| "Load demo loop", "+ Zone", "Load 808-ish kit" | all three loaded a **fixed procedural sample**. They put a sample in. None of them could put yours in                                                                                                                         |
| Browser → Pool → Import audio                  | imports into the project and stops. Nothing carried the result to an instrument                                                                                                                                               |
| Browser → Samples, tapping a row               | works — and loads into whichever track `useSynthTarget` picks rather than the one on screen, from a panel the sampler never mentions                                                                                          |

The fix is one control, `SampleSourceButton`, on five surfaces, opening one
menu: **Import audio file…**, the project's own media newest first, and **Browse
all samples…** for the long tail. A menu rather than a row of small buttons for
the reason the device rack settled on one — it is the single target that can be
44 pt on every form factor, and every command inside it is a full-width row that
can be too. Measured on a phone, by pressing: **113 × 44**.

Two more of the same class fell out of sweeping for it:

- **`+ Sampler layer` made a layer that could never sound.** `rackAddItem`
  created `zones: []`; `engine.ts` played `item.sampler` and `exportMix`
  rendered it, and no control in the product could write to it. Permanently
  silent, for the life of the project.
- **An empty drum pad was a drop target and nothing else.** Its own tooltip said
  "Drop a sample here", which on touch meant nothing at all; the only touch
  route was the tools button, which always picks the _first_ free pad. It opens
  the load menu for its own index now, and is in the tab order because it is
  actionable.

`tests/assetSupply.test.ts` is what stops the next one. Two mechanical rules
over the component tree — a component that **creates** an empty asset slot draws
a control that **fills** it, and a component that accepts a **drop** offers a
route needing no pointer — and anything that needs neither is registered with a
reason. Its first version worked per _file_ and was mutation-tested DECAYED
within the hour: `SamplerPanel.tsx` holds five surfaces in 1700 lines, so once
any of them drew a load control the whole file counted as supplied, and deleting
the rack layer's — the exact defect it was written for — left it green. It works
per component now, and the limit that remains is stated where it lives.

`e2e/samplerload.spec.ts`: **14 cases**, phone, tablet and desktop, every one
ending at `mediaId` — the one piece of state that decides what an instrument
plays — reached through a real pointer sequence with the pointerType of the form
factor it claims. Mutation-tested by painting a neighbour over the control: it
goes red naming what the press landed on.

What smp-01 §3 specifies and this does **not** build: decode at the file's native
rate, trim the head against the noise floor, transient detection on the import
path, pitch detection, loop detection, auto-zoning, and multi-file multisample.
Of those seven, one exists — `detectTransients` — and it is a button pressed
after the sample is already loaded. Filed as **SA-001**; the resampling
divergence is **SA-002**.

## No document records state that nothing checks

Four instances now, one cause: `SOAK.md` carried a FAIL a directive after the
product fixed it, the parity chapters marked five closed items MISSING, the RA
backlog held three closed tickets, and `DEVICE-PARITY.md` had never been told
about seven shipped devices. A document that records state and is not verified
_will_ be wrong, and nothing about reading it tells you.

Every file under `docs/` is classified in `scripts/docs/registry.mjs`, and
`npm run docs-guard` enforces what the classification means:

|                    |                                                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GENERATED** (4)  | names the script that writes it, says "do not edit by hand" in its first lines, and — where it declares the artefact it describes — is compared against that artefact                    |
| **GUARDED** (13)   | names the guard, which must exist _and_ run in `npm run build`                                                                                                                           |
| **NARRATIVE** (53) | contains no record of this product's state, in any of the shapes state takes: a bare verdict in a table cell, a ticked checklist box, a status line claiming what does or does not exist |

Unclassified fails the build. So does a registry entry for a file that is gone —
the same rule from both ends, because a registry that goes stale is this exact
failure one level up.

Eleven audits and milestone reports were **converted rather than deleted**: each
names the commit it describes, and the guard checks that commit exists. A
measurement of a named tree is history and cannot go stale; unstamped, every one
of them was claiming to describe the present.

What the first run found:

- `docs/design/lib-voice-substrate.md` said **"No implementation exists and none
  may be written"** while `note_id.h` and `note_registry.h` were in the tree,
  built against it last directive. Two sibling design documents said the same,
  and `DESIGN-DIRECTION.md` and `THIRD-PARTY-PLUGINS.md` carried the same shape
  of sentence. All five point at the guarded ledger now instead of freezing an
  answer.
- `docs/DEVICE-PARITY.md` opened with "our catalogue is **27 effect kinds**"
  and the product had thirty-four. The seven Motion Wave units were in the picker
  and in no row of the gap list — and **a gap list that has not been told about a
  device cannot have a gap for it, so its silence reads as parity.** §1.6 is
  written; `unlistedDevices()` fails the build on the next one.
- `docs/PARITY.md` and `docs/DEVICE-PARITY.md` were recording state and checked
  by nothing at all. They are inside `parity-guard` now: 53 workflow rows
  against the three verdicts the document's own key declares, and 53 device rows
  with every named kind installed and every installed kind named.

Five mutations, five red: a shipped device dropped from the gap list, a fourth
verdict spelling, an ADR growing a verdict table, a closed ticket back in the
open list, and a new document nobody classified.

The bundle-currency check is a note in the build and a **failure** in
`npm run docs-guard:release`, and the reason is ordering rather than severity:
`vite.config.ts` compiles the commit date in, so re-running the soak changes the
commit, which changes the hash the fresh report has just been made to name. It
can only be satisfied against the artefact actually being deployed. Declared in
`check-checks` and in CLAUDE.md's command block, so it is not a side door.

## The guard I added took the deploy down

Worth recording in full because the shape recurs and it caught me the same day
I wrote the rule about it.

`docs-guard` checks that a document registered as history names a commit and
that the commit exists — `git cat-file -e <sha>`. It runs in `npm run build`.
Cloudflare's builder clones **shallow**, so eleven documents named eleven
commits it had never fetched, all eleven failed, the build exited 1, and the
deploy never happened. The live site sat on the previous commit for a quarter of
an hour while the bundle verification politely waited for a hash that was never
coming.

Reproduced rather than assumed: `git clone --depth 1` of this repository, the
guard as deployed, eleven failures; the same clone with the fix, none.

**A claim about the repository, made from a truncated copy of it, is the same
error as BLOCKED being a claim about the host.** The stamp is the half that
matters and needs no history; whether the commit resolves is a question this
checkout may be unable to answer either way. It is skipped now, and skipping
says so.

The second half of the same lesson: the currency check compared `SOAK.md`'s
declared **bundle** against `dist/`, and it could never have passed.
`vite.config.ts` compiles the commit date into the bundle, so committing the
fresh soak report is itself enough to invalidate the bundle name the report has
just been made to carry. A check that cannot be satisfied gets turned off, which
is this whole apparatus failing by a side door.

It compares a **source fingerprint** now — `scripts/srcfingerprint.mjs`, a
digest of every compiled file under `src/`, path and content, line endings
normalised. A documentation commit does not move it. One line of `src/` does.
That is the question worth asking of a report about the product, and it is
answerable.

## The coverage arithmetic, and the denominator that moved

F3 reported **69 of 396**. The last report said **69 of 136**. Same numerator;
the denominator had moved, and read in sequence it looks like coverage tripled.
Nothing had improved.

136 is the functional sweep's **scope**, not a denominator. The honest set:

|              |                                                                                         |
| ------------ | --------------------------------------------------------------------------------------- |
| **69 / 403** | ledger rows with a state-asserting result — **17.1%**                                   |
| 69 / 136     | hit rate _inside the sweep's own scope_, 50.7% — a different question, and not this one |
| **267**      | rows with no case at all: 87 action, 19 surface, 161 store                              |

Every one of the 267 is **named**, by kind, under "Never driven" in
`docs/FUNCTION_LEDGER.md`, with why each kind goes undriven: `action` and
`surface` because no case exists for any of them, `store` because the 27 with a
one-line state assertion are driven and the other 161 need a fixture built
first. A count reads as an oversight to be tidied later; a list of a hundred and
sixty-one ids reads as the work it is.

The enumeration moved to `scripts/functions/enumerate.mjs`, which the ledger and
the soak both import. Two things were counting different lists, which is how the
two figures came to be reported as though they were one.

## Two checks were BLOCKED on a host that could run both

`curve:check` asked for `g++` and reported "no C++ compiler on this host".
`wasm:check`'s gate looked for emsdk at `/home/user/emsdk`. Neither is where
this machine keeps its toolchain, and forty-two core suites had been compiling
through emsdk's clang since `run-core-tests.mjs` was written — three scripts
asking the same question of the same machine and getting three answers.

**BLOCKED is a claim about the host, and a claim about the host can be wrong.**
It is also the one verdict that reads as an environment fact rather than as
something to look at, which is why it survived three summaries.

The compiler lives in `scripts/emcxx.mjs` now, once. Unblocking the two found
two more:

|                           |                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wasm:check`'s mutation   | `namespace mw` → `namespace /* mutant */ mw` changes no compiled byte. The check reported a match and the gate correctly called it DECAYED — which nobody had seen, because the gate had been saying BLOCKED                 |
| `wasm:check`'s comparison | line-ending sensitive. 21 bytes in 307,735, and it told the reader to commit a file whose content had not changed. That is the grain tables' defect, fixed for the generators and never applied here because nobody ran this |

A passing check now puts the tracked bytes back, because `npm run build` runs it
and `vite.config.ts` compiles the wall clock into a dirty tree — 21 carriage
returns are enough to make a bundle nobody can reproduce, and the deploy
verification that hashes it could not have passed. And the gate restores what
the _check_ rewrote, not only what the mutation edited: `build.sh` copies its
output over the tracked core, so the mutated run had been leaving a mutant DSP
in git for whoever committed next.

## §7 — the voice substrate starts

`note_id.h` and `note_registry.h`: the two files everything else in the
substrate's twelve depends on, and which depend on nothing.

**VS-04 is closed**, and the spec calls it "BUG-005 made executable" — a
thousand presses, each with the key-to-pitch mapping moved underneath it, and
the release names the press in a thousand of a thousand. An instrument that
recomputes identity at release time disagrees with itself whenever a transpose
has happened in between, and the symptom arrives minutes later as a note that
will not stop. Also the registry's half of **VS-31**: `RtGuard` over press,
release, releaseAll and reset, zero allocations — with the negative kept
executable beside it, so a guard that had stopped watching would say so.

Five mutations, five red: a `release` that recomputes rather than reads, a
repeated press that mints a second id, a swap-with-last erase that silently
reorders the held list, a `reset` that rewinds the id counter, and a slot index
that drops the channel and collapses an MPE chord to one note.

Ten files remain, then VS-01 through 03, 05 through 30 and 32.

## "No three-dot, remove or move controls on mobile" — four reasons, all true

Reported from use. Four separate causes, none of them visible to a test that
opens the menu with `el.click()`:

|                                                     |                                                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.dev-menu` was `opacity: 0`                        | revealed only by `.dev-slot:hover`, and nothing on a touch device hovers                                                                              |
| the coarse block gave it `min-height: 44px`         | inside a 16 px row, so it overflowed into the two below and a finger at the centre of the first device's button landed on the **third** device's icon |
| `.dev-slot` is `flex-wrap: wrap` for the Micro View | at 44 px wide the name's `flex-basis: auto` pushed the button onto a second line, 47 px below its own slot, **on top of the Insert button**           |
| `.fx-head .dev-menu` matched no reveal rule at all  | the inspector's copy — the rack a phone lands in — has been invisible on every form factor for as long as it has existed                              |

On touch the menu is the route: 44 x 44, visible, and the 5 px power lamp is
dropped rather than grown. That is WCAG 2.5.8's equivalent-alternative
provision, which makes two things load-bearing rather than nice — the menu has
to carry _every_ command the rack offers inline, and its own entries have to be
big enough. It carried all but one: the **disclosure**, the press that opens a
device's parameters, was inline-only on both racks, so on touch — where the
inline controls are hidden — a device's parameters were unreachable.

### Measuring found three more, in the same class

**A press on the first device's power lamp bypassed the second.** `::after` at
`inset: -19.5px` — 5 + 39 = 44, derived against the touch minimum and never
measured against a 17 px row pitch. Every lamp's hit area covered its
neighbour's whole row and the later sibling took the press, so any channel with
more than one insert had a bypass button that was **off by one**. Not "hard to
hit": wrong device, silently, with the right one left running.

**Escape closed the window under an open menu and left the menu.**
`PluginWindow` listens in the capture phase and stops propagation, which is
what makes it beat the app behind — and it was also beating the menus above it
at `--z-menu` 800 against its own 300. The abandoned menu then covered the
button that opened it.

**A decorative meter took presses aimed at the rack.** `.smeter-bars` is
`aria-hidden` and its scale spills past an `overflow: visible` box.

Those last two are why `devicewindow.spec.ts` had been the one failing case in
the suite. It was recorded as an 11 x 11-against-44 px target failure. It was
two product defects, and all 42 offered devices pass now.

### The measurement was wrong as well as the code

`hitBox` in `orientation.spec.ts` added a declared `::after` inset to a border
box — the _intended_ rectangle, not the reachable one. Inside a scroller they
are nowhere near each other: `.dev-power` declared 44 x 44 and delivered 16 x
16, then 1 x 1 once a second device was on the channel. It walks outward with
`elementFromPoint` now, and said so immediately — the device window's bypass
lamp reached **33 x 44**, and "Compare slot B" reached **39** inside an
`overflow: hidden` group 3 px narrower than its own buttons. Both fixed.

A declared 44 that delivers 11 is worse than an honest 20, because the number
goes in a report and the report is what stops anybody measuring. The rack's
options button is 20 x 16 on a desktop now, and 20 x 16 is what it reaches.

## A reachability claim made without a hand is not a reachability claim

`el.click()` invokes a handler. It does not ask whether anything is on top of
the element, whether it can be seen, whether it is on screen, or whether the
gesture a person makes would arrive. Neither does `hasTouch: true` plus
`click()`, which makes `(pointer: coarse)` match and then sends a **mouse** —
which is how `longPress` came to be dead in the reachability sweep.

`e2e/pointer.ts` lands a press on coordinates with a declared pointerType and
says what it hit. `scripts/gesture-guard.mjs` runs in the build and fails on a
scripted press, or a touch context pressed with a mouse, that has not been
argued for in writing — 87 files swept, six scripted sites and three
mouse-on-touch files, each with a reason. The audit found every one of the six
already carrying a written reason and all six being fixture steps. What was
missing was not a rule; it was any reachability assertion at all for the
control that was broken.

## §4 — nine hundred and forty-seven claims, not thirteen

`parity-guard` checked thirteen. The audit makes **947**, enumerated from the
eight chapters, and 535 MISSING against thirteen checks is thirteen credible
numbers and 934 unexamined ones.

| how a claim is settled                                                                              | count   |
| --------------------------------------------------------------------------------------------------- | ------- |
| its own citations — every cited path and filename resolves, every symbol said to be absent still is | **806** |
| a pinned predicate that must agree with the verdict in both directions                              | **13**  |
| a recorded judgement, one of four reasons, across 99 sections                                       | **141** |

Its first full run found three sentences that had stopped being true. **AD-3,
output device selection, recorded `MISSING` and marked P0, has been built** —
`outputDeviceId` in `prefsStore`, a control in `AudioSetup.tsx`, applied
through `AudioContext.setSinkId`, with `canChooseOutput()` reporting whether
the browser offers it. That is the sixth item closed while the documents went
on calling it missing, and the first that was a P0. **IO-13** said `audition`
appeared nowhere in `src/`; `Engine.audition(mediaId)` drives the browser's
preview. **The fundamentals chapter** said `Float64Array` appeared nowhere; it
appears three times, none of them a signal path.

Reading the corpus took **eight notations**, every one found by running the
enumerator and looking at what it could not read. One was worse than a miss: a
legend heuristic of "three or more verdict words" ate gap paragraphs that
weighed three outcomes, and three whole sections of the mixing chapter vanished
behind it. A heuristic that fails by _dropping_ claims leaves something that
still looks like a complete sweep.

## §6 — the piano roll under a thumb

Capability parity, affordance divergence. Five edits were not possible on a
phone at all, and `ROW_H = 16` was two of them at once.

|                                 | before                                                                          | after                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| zoom axes                       | one — time. Lane height was a module constant                                   | two, independent, each with its own control                                                 |
| a pitch lane on a phone         | 16 px                                                                           | **56 px floor**, held on read so a stored desktop value never reaches a finger              |
| the resize handle               | 7 px, 14 on touch, and **transparent**                                          | drawn, and its width computed against the note                                              |
| a sixteenth at the default zoom | 8 px wide under a 14 px handle — every attempt to _move_ it resized it instead  | the handle gives way below a 24 px body, and says so by not drawing a grip it cannot honour |
| what a finger covers            | nothing said what was under it: no hover, no tooltip, no cursor beside the note | a readout above the grid, flipping below when the drag is in the top quarter                |
| nudge                           | Alt+arrows only, which a phone does not have                                    | a four-way pad, 44 px, first on the toolbar on touch                                        |

Two things the measuring turned up. The toolbar is `overflow-x: auto` and holds
about twenty controls in 390 px: every control from the quantize strength
rightward was **off screen**, including the pads that exist because a phone has
no modifier keys. They start on screen now — nudge first, because it is an edit
a phone cannot otherwise make; zoom second, because it survives being a flick
away. And `min-height: 44px` on a button inside a 34 px `--toolbar-h` measured
**44 x 34** — the device rack's defect one panel over.

The desktop keeps hover, thin edges and Alt+arrow, unchanged.

## PA-010 was fixed on the path you monitor and not on the one you deliver

The live engine has held every channel back to match the deepest since
Directive 03. `exportMix` builds the same channels out of the same
`InsertChain` and had no compensating node at all — so the defect the
declaration exists to fix was alive in the file the engineer actually delivers,
and nothing said so, because monitoring is exactly where you would have caught
it.

The arithmetic is `src/audio/pdc.ts` now and neither path may reimplement it.
Two renderers compensating from two copies of one sum are two renderers that can
disagree about when the vocal starts, which is `synthFace.ts`'s argument applied
to time.

**The bounce also takes the common offset off the front**, which is the one
thing the offline path can do and the live one cannot. Live, every channel ends
up `commonSamples` late together and there is nothing to notice it against. A
file has something: the timeline it came from. A bounce that begins 7 ms after
bar 1 does not line up when it is re-imported, does not loop, and drifts against
the material it was rendered from.

|                                             |                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| measured as                                 | a normalised cross-correlation, not an RMS                                                                                     |
| the probe insert                            | a saturator at `mix: 0` — its dry leg carries the same delay as its wet one, so it is a pure 192-sample delay and nothing else |
| reverted, the insert's own track            | +192 samples                                                                                                                   |
| reverted, the two tracks against each other | 192 samples apart — PA-010 exactly, in the file                                                                                |
| fixed                                       | 0, and 0 apart                                                                                                                 |

### Two things fell out of it

**A bypassed Motion Wave unit declared latency it was not applying.** Every
other insert kind returns zero when bypassed; these five did not, and
`InsertChain` routes a bypassed insert _around_ the node — so five units
bypassed to silence were compensated against nothing and came out early.
Invisible until the bounce began removing the common offset: before that the
error was uniform, and a uniform shift has nothing to be uniform against. The
strong form of the bypass property is green again — 34 kinds, 0 leaking.

**A bounce renders `MAX_PDC_SEC` extra frames** when a project has inserts,
because the exact figure is a property of chains that do not exist until the
context does and a context's length is fixed when it is constructed. The
alternative is a static per-kind latency table, and `latencyProbe.ts` exists
because those numbers are not ours to assume.

What is still not compensated is the master safety limiter's 264 samples. That
is a measurement of a Chromium node at one rate, not a figure any specification
states, and compensating a bounce by a hard-coded constant would leave every
other engine wrong by the difference instead of wrong by the whole thing.

## Property 10, and the two corrections it needed before it could be believed

`a-bounce-is-in-time` — a latency-declaring insert moves nothing in the bounce,
wherever the seed puts it. It failed twice before it was right, and both
failures are recorded rather than edited away:

| the property did                                         | it should have                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| correlate the whole mix                                  | correlate the target track alone. A shift on one channel is diluted by every channel that did not move and the correlator reports a peak between them — 4 samples, which failed a tolerance of 3 and named no mechanism. The bypass property learned this about the same graph, where a mix turned ×1.414214 into 1.0331 |
| draw the target from any audio, instrument or drum track | draw only from tracks with a clip inside the measured bars. Isolating a channel whose clips start later renders silence, and a correlation over silence has no peak to find                                                                                                                                              |

Both are in `probe-mutant.mjs` with the defect they replaced still executable,
and both come back **HELD** — planted, the property goes PASS to FAIL. The
second one is worth its own line: the silent render did not pass quietly, it said
"a render is silent, so nothing was measured", which is the guard doing exactly
what it is there for. The correction is about the property failing for a reason
that was not the product, not about it failing at all.

## Every declared check, and whether anything runs it

`scripts/check-checks.mjs --check` runs in the build. It enumerates every npm
script, every TypeScript project on disk and every spec file under every suite
root, and fails when any of them is reached by nothing or has no entry in
`scripts/checks/mutants.mjs` saying how it is known to be able to fail. The full
run applies each of those mutations and requires the check to go red.

Three findings made it necessary and they are three shapes of one thing.
`tsconfig.e2e.json` was correct and invoked by nothing. The panel spec ran and
could not fail. `wasm:check` compared a file against itself. In all three the
check existed, and its existence is what stopped anybody asking — which is why
the answer could not be another check somebody has to remember to run.

| what the first run found                     |                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| the whole Motion Wave test estate            | 351 unit tests, 41 core suites and the panel browser suite, reached by neither CI nor CLAUDE.md                         |
| CI's type-check                              | two projects of four; `motionwave/ui` was compiled by nobody on a push                                                  |
| `curve:check`, `sinc:check`, `windows:check` | run by nothing, and two of the three red                                                                                |
| both grain tables                            | differed from their own generators by nothing but line endings                                                          |
| `curve:check` with no compiler               | a stack trace, which reads as broken rather than unrunnable                                                             |
| `check-bundle.mjs`                           | measured whichever `index-*.js` `readdirSync` returned last — a coin toss between the 148 kB entry and a 3 kB WAM chunk |
| the entry chunk, read correctly              | genuinely over budget, carrying 44 kB of Motion Wave face renderer                                                      |

All of them are CI steps now. The face is loaded on demand behind its own error
boundary, and the entry chunk went **148.2 kB → 132.8 kB**.

Verdicts on this host: 13 HELD, 2 BLOCKED (no emsdk, no g++), 1 KEPT with a
reason, 0 DECAYED. Two of the mutations were themselves too weak and said so —
one renamed a field that appeared twice in its file, one wrote its mutant to
`dist/` where the budget reads `dist/assets`.

## §4 — the parity audit had gone stale, and nothing was watching it

Eleven thousand lines of verdicts, taken by reading the reference manual against
this repository at one moment, and nothing has kept them matching since. **Five
of the items those documents name as their own priorities had been closed while
the documents still called them missing.** The headline one — "the cheapest
high-value item is that no keyboard shortcut opens any pane" — is answered by
nine bindings that have been in `src/app/shortcuts.ts` for directives.

`npm run parity-guard` settles, on every build, every claim the audit makes about
MotionLab's own code that can be settled by reading that code. A verdict that has
moved fails in either direction: a `MISSING` that became true is a claim closed
and never written down, a `PARITY` that became false is a regression. Anchors are
the claim's _subject_ rather than its verdict — the guard caught its own first
anchor going missing when the verdict it was written against was corrected.

One item closed with it, and it is the one that chapter calls the single cheapest
parity win: **the transport says what delay compensation is costing.** In
milliseconds, beside the sample rate, and only when it is not zero. Until it
landed, `pdcSamples()` was a documented test probe with no caller anywhere in the
repository. `e2e/pdcreadout.spec.ts` reads **324 samples** for a limiter at its
3 ms default, and watches the figure and the label go away when the insert does.

Ten claims checked, 6 at parity. The gap is far larger — **535 `MISSING` and 294
`PARTIAL` across seven chapters** — and these ten are the ones those chapters
name themselves.

## The console re-laid-out under the pointer

The open P1 was recorded as "a device slot is clipped and its options menu cannot
be opened". It was not clipping, and measuring it found something worse.

Pressing anywhere on a channel strip selects it, and selecting mounts the Channel
Overview — 116 px, in a mixer pane that had 265. The console loses 44 % of its
height between `pointerdown` and `pointerup`.

| measured through one press | before it | during it   | after it |
| -------------------------- | --------- | ----------- | -------- |
| the Insert button          | y = 696   | **y = 803** | y = 803  |
| the device rack            | 37 px     | **5 px**    | 5 px     |
| the console                | 229 px    | 113 px      | 113 px   |

So the release landed on a different element and the click was never delivered:
**the only way to add a device to a channel did not work with a mouse.** The
device suite could not see it because it opens that menu with `el.click()`, and
a synthetic click has no press to move under.

Three fixes. The overview waits for the hand to come off — selection still
happens on `pointerdown`, because a fader dragged on an unselected strip has to
select it and there is no click at the end of a drag, but the _layout_ waits.
The overview is capped at two fifths of the pane and scrolls. And the device
list, which was being squeezed to **zero height** while its contents went on
painting, keeps one whole row: a drum channel's rack carries an instrument row,
a device row and the Insert button — 55 px — and the two shortest tiers scale
`--dev-rack-h` to 37 and 26. Nothing was clipped and nothing was too small; two
rows were occupying one row's space, and only the hit test could tell.

Measured after: the button stays at 696 and the rack at 37 for the whole press,
the overview lands when the hand comes off, and a real mouse click opens the
Insert menu.

What is left is a policy question rather than a bug. The console's per-device
controls are 5 px (power), 12 px (name) and 11 px (options) tall on a desktop,
and `devicewindow.spec.ts` holds them to 44. Eleven pixels also fails WCAG 2.2's
24 px pointer minimum, so the honest answer is not to lower the assertion; but
growing the target grows every device row on every channel, and that is a
decision about how the console looks rather than a defect to fix quietly.

## A bypassed insert was changing the track's pan law

The soak reported one number: 1.6478e-2 RMS across a render, on fifteen
unrelated inserts, while bypassed. Two hypotheses were tried against that number
and both were reverted for moving it by nothing, and that is what guessing looks
like when the measurement cannot discriminate between the guesses — an RMS over
a whole render collapses a startup transient, a filter difference and a level
change into the same figure.

`scripts/bypass-probe.mjs` localises it instead, and answered in one run.

|                                 |                                                          |
| ------------------------------- | -------------------------------------------------------- |
| where the difference lives      | evenly, the same ratio in every window with signal in it |
| spread of that ratio            | 0.000                                                    |
| energy in the first millisecond | 0.0 %                                                    |
| first non-zero sample           | the first sample of audio                                |
| level                           | x1.414214, both channels equally                         |

√2 is the step between a `StereoPannerNode`'s two pan laws. Fifteen inserts
contain a node that emits two channels whatever arrives — a `StereoPannerNode`,
a `ChannelMergerNode`, a `makeStereoTap`, or the worklet the Motion Wave units
run in, declared `outputChannelCount: [2]`. **A leg at gain zero still
contributes its channel count**, so a mono track with a bypassed reverb reached
its panner as stereo, took the stereo law, and came out 3 dB louder at centre
and 6 dB louder panned hard over.

`InsertChain` routes a bypassed insert _around_ itself now rather than trusting
it to be transparent. That answers the class rather than the fifteen: bypass is
also exact for a three-band crossover summed flat and a filter at unity, which
were never wires either and were the reason the property had been weakened to
"closer to dry than the active unit is". It asserts the strong form again, at
full resolution, on the track alone — 0 of 34 change the render.

`e2e/bypasstransparent.spec.ts` has two cases and the second is what stops this
being the wrong fix: an active ping-pong delay must still widen a mono track.
Pinning the bypassed leg to one channel would pass the first and take that away.
Mutation-tested: with the bridge held shut the spec fails naming all fifteen
kinds at x1.414213.

**22 of 41 was the wrong count and it was mine.** The figure came from a sweep
run before `effectKinds` was deduplicated, so the seven Motion Wave units were
each counted twice: 34 + 7 = 41, 15 + 7 = 22. The same fifteen kinds throughout.

### Four probe defects came with it

| the probe did                                                                                                                | it should have                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| passed `range: { startSec, endSec }` to an option that takes beats — silently ignored, so every render was the whole project | give it in beats                                                                                                  |
| compared every eighth sample                                                                                                 | compare every sample; a decimation with no anti-alias filter folds anything above 2.7 kHz somewhere it is not     |
| measured across the whole mix                                                                                                | measure the track alone; the mix diluted 1.414214 to 1.0331, which is the number both wrong guesses were aimed at |
| called `preloadForRender` without the decode context it requires                                                             | pass it                                                                                                           |

### `tsconfig.e2e.json` existed and nothing ran it

The range defect was in the end-to-end suite too, where excess-property checking
rejects it on sight. `npm run typecheck` invoked three projects and not that one,
so thirty-one spec files — the bounce-parity guards among them — were compiled by
nothing. A configured check nobody invokes is worse than a missing one, because
the file's existence is what stops anybody asking. It is the root `tsconfig.json`
gotcha arriving from the other direction. Wired in, mutation-tested, and it
reports the error on sight.

## Two Motion Wave panels had never painted in the app

`bridge.cpp` packs a frame, `unit_worklet.js` copies that many doubles, and the
unit's `meters` list names them. Nothing checked the three agreed, and two did
not: the Variable-Mu and the Console EQ each packed seven doubles and named six —
`lateralVertical` and `american`, both published and neither declared.

`MotionWaveFace` compares the frame's length against the meter list and refuses
to paint when they disagree. That is correct: a frame read one slot out would
mislabel every readout with something plausible. But it logs and returns once per
animation frame, and a face that draws nothing looks like a face waiting for
signal. `motionwave/ui/test/frame_packing.test.ts` is the guard, and it is the
count rather than the names — `gainReductionDb[0]` and `[1]` are one field and
two channels, and forcing them to match would mean renaming the DSP to suit a
test.

## §8 — V27, measured on all seven panels

Six pass. The reasons the six were failing were three different things and none
of them was "the animation has not been built" — see `docs/UNIT_LEDGER.md` for
the detail, and the two publishing defects it found.

| unit             | element         | distinct values / 40 frames | while suspended |
| ---------------- | --------------- | --------------------------- | --------------- |
| Motion Shaper    | `band-low-gain` | 40                          | 1               |
| Program EQ       | `input-core`    | 25                          | 1               |
| Optical Leveller | `exposure`      | 40                          | 1               |
| FET Limiter      | `detector`      | 16                          | 1               |
| Variable-Mu      | `storage-a`     | 40                          | 1               |
| Console EQ       | `eq-core`       | 40                          | 1               |
| Granular Reverb  | `live-grains`   | **1**                       | 1               |

The element is chosen for what it means rather than for what moves most. Every
one of these panels has an input level meter that would satisfy the motion case,
and a level is what every box has; `V27`'s third requirement is that the
animation communicates _this_ unit's mechanism.

**The FET Limiter's row is also a probe correction.** Its detector moved 16 times
in 40 frames and 7 in 20, and the suspended-engine case required more than ten in
its 20-frame window before it would believe the panel had been moving. That
figure was borrowed from the 40-frame motion case and assumes every mechanism
moves at the display's rate; a limiter's detector moves at the programme's. The
precondition is now separate from the claim, which is the stop.

## Every corrected probe, mutation-tested

Twenty probe corrections are recorded across the stress harness and the
reachability sweep, and every one had been diagnosed properly and none verified.
Those are different things. "Suspect the probe first" decays into "assume the
probe", and once it has, a correction that quietly _widens_ a check is
indistinguishable from one that fixes it — both make the red go away.

Each correction now keeps the defect it replaced executable beside it, through
`unless()` from `scripts/probe-mutant.mjs`. `npm run probe:mutations` restores
each one and requires the measurement to get worse; `--check` runs in the build
and fails on a registry entry with no call site, or a call site with no entry.

Three verdicts, because two of them look identical in a column and mean opposite
things:

|             |                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------- |
| **HELD**    | the defect changes the measurement, so the correction is load-bearing                       |
| **BLOCKED** | this host never entered the branch, so it was not tried                                     |
| **KEPT**    | exercised, does not change the measurement, and kept anyway with a reason printed every run |

### Stress harness — 6 of 6 held

| correction                                   | baseline   | with the defect restored         |
| -------------------------------------------- | ---------- | -------------------------------- |
| operations awaited, one per frame            | 361 ops    | 10,236,132 ops                   |
| three collections before the heap is read    | +447 KB    | −6,470 KB                        |
| wait for quiescence, do not sleep on a guess | 1390 ms    | 509 ms and a false leak reported |
| two consecutive over-budget samples          | 364 tracks | 84 tracks                        |
| loop bound 400, not 64                       | 408 tracks | 72 tracks                        |
| the DrumKit branch is built                  | 5 classes  | 4 classes                        |

The ceiling's confirmation could not be exercised at the real budget — this
machine carries four hundred tracks inside two refreshes, so the branch never
runs. It is measured at an 18 ms budget, which is just above the frame loop's
own floor and therefore in the band where consecutive samples disagree. That is
what the registry's `frameBudgetMs` is for, and `ceiling candidates rejected` is
the row that says whether it did anything on a given run.

### Reachability sweep — 9 held, 3 blocked, 1 kept, 1 fixed

| correction                                   | baseline     | with the defect restored |
| -------------------------------------------- | ------------ | ------------------------ |
| routes discovered from naming conventions    | 18 reachable | 9                        |
| named sheet openers count as routes          | 3            | 1                        |
| routes walked per track kind, selection held | 4            | 1                        |
| headers found by name, not by id             | 3            | 1                        |
| header tapped at its corner, not its centre  | 3            | 1                        |
| Escape twice before hunting for a header     | 2            | 0                        |
| back to the Song page first                  | 3            | 1                        |
| routes re-discovered after arriving          | 4            | 0                        |
| menu entries walked, not just opened         | 3            | 1                        |
| long press dispatched as a touch pointer     | 1            | 0                        |

Three are **BLOCKED** and say so with a number: `tapFailures = 0` (every track
could be selected by tapping, so the store route reaches nothing extra),
`scrolls = 0` (every header this sweep looks for is on screen when it looks),
and no target reached via the MIDI-clip pass. One is **KEPT**: re-asserting the
selection before each route fires seven times in the widest phone scope and does
not move the count, because the menu walks added later select a track on their
way in. The behaviour is right and the claim that it is load-bearing is not.

**Two of the fourteen were my own defects, found by this.** The `select-track`
mutation skipped only the per-track walk while the menu walkers still selected
one, so it restored a world that never existed. And the long-press walk pressed
once and iterated: the first entry closed the menu and every later entry was
invisible, so exactly one command in a seventeen-item track menu was ever
invoked.

### The automation lane was never reached, and F1 read as if it had been

`docs/audit/REACHABILITY.md` recorded the automation lane as `NOT REACHED` on
every form factor including desktop, and F1 described the long-press correction
as the one that settled the question. It settled the _false defect_ — the
`auto-toggle-*` target is a desktop widget and reported a phone failure that was
not there. It left the real question unmeasured, and moving the target to
`auto-lane-*` moved it to a state the sweep never creates: showing automation
lanes on a track that has none shows nothing, and the lane only exists after
"Add automation lane…" and a parameter are both chosen.

Both menu walks complete the submenu now, and a desktop right-click walk was
added because `longPress` returns immediately on a desktop and those commands
were therefore never invoked on the one form factor a defect is measured
against. **The automation lane is now reached on a phone and on a desktop.**

## The reachability matrix moved from 0 defects to 4, and 0 was the wrong number

The sweep that produced "0 defects" pressed a track header once and then
iterated its menu: the first entry closed the menu and every later entry was
invisible, so exactly one command in a seventeen-item menu was ever invoked. It
also never reached the automation lane on any form factor, desktop included,
and F1 described that correction as the one that settled the question. It
settled a false defect and left the real one unmeasured.

With both menu walks completing their submenus, and a desktop right-click walk
added because `longPress` returns immediately there:

|                      | before                         | after                |
| -------------------- | ------------------------------ | -------------------- |
| defects              | 0                              | 4                    |
| not reached anywhere | 5                              | 3                    |
| automation lane      | not reached on any form factor | reached on every one |

**The four are candidates, not findings.** Every one of them is
selection-dependent, and the sweep's own counter says it failed to select a
track by tapping eight times in this run — so a route it could not take is
indistinguishable, from the outside, from a route the product does not have.
The counters are printed in `docs/audit/REACHABILITY.md` above the defect list
for exactly that reason. What has to happen next is finding out why a tablet
will not select a track by tapping, and the honest state until then is four
unconfirmed rows rather than either a zero or a defect.

## Directive 11 §3 — the four soak layers

`npm run soak`, four layers against one running build, writing
`docs/audit/SOAK.md` and `docs/audit/soak-coverage.json`.

### 1. Functional sweep — 69 of 396 rows have a state-asserting test

A row goes green only when a named part of the state is observed to change: the
project, the ui, what is on screen, the undo stack, the transport. Not "it did
not throw" — that is a weaker claim than FAIL and reads as a stronger one.

Coverage is reported as **rows with a state-asserting result**, never as rows
that are not FAIL. Those are the same number only until somebody is tempted.

Six probe corrections were needed to get there, and each one had been reporting
the sweep's own gaps as the product's:

| the sweep believed                 | it was                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| Eight units are inaudible          | a flat EQ and a unity trim are _correctly_ transparent as inserted                    |
| Three instrument kinds are silent  | a drum kit maps its zones low; middle C landed on none of them                        |
| Three store cases throw            | the fixture appends to the demo project, so the first instrument track has no inserts |
| `undo` changes nothing             | it moves work to the redo stack and leaves the first the length it started at         |
| Half the shortcut registry is dead | opening a panel is a state change neither store holds                                 |
| Every history shortcut is dead     | restoring the fixture leaves nothing on the undo stack to undo                        |

### 2. Combinatorial fuzz — 10,000 seeded steps

Twenty-eight step kinds, structural invariants after every one, and a shrink to
the shortest reproducing subsequence. It broke at step 479 and shrank to **one
step: delete a track**.

Getting a reproduction anyone could read took three corrections, and the first
two were silent:

- A **shared draw stream** meant a subsequence replayed a different sequence.
  Each step now draws from a stream indexed by the seed and its own position, so
  step 7 draws the same numbers whatever came before it.
- The replay **reset the project and not the ui**, so every candidate began
  already violating the invariant and every prefix "reproduced". The shrink
  named `splitClip` once and `setTrackGain` once, and neither can cause what was
  reported. The empty sequence is now required to pass before any shrink is
  believed.
- One-at-a-time removal from the end turned 480 steps into 372, which is the
  same run with its tail trimmed. **ddmin** turns it into one.

### 3. Properties — 8 of 9 hold

Save round-trips, the loader is idempotent, it does not drop a lane it can read,
undo inverts, redo inverts undo, automation reads back what was written,
deleting a track orphans no clip, and the fader is monotone.

The ninth is below.

### 4. Endurance

Ten minutes of playing while tracks and inserts are added and deleted
continuously, sampled eight times and judged on **slope** rather than on a final
reading: a heap that ends higher is a busy moment, a heap that rises across
every sample is a leak.

## A bypassed insert is not always a wire

**22 of 41 inserts change the render while bypassed, all by exactly the same
amount.** Found by §3's property layer.

|                                             |                                          |
| ------------------------------------------- | ---------------------------------------- |
| two identical renders differ by             | 2.3e-7                                   |
| a bypassed reverb differs from no insert by | 1.6478e-2                                |
| level                                       | ×1.0331, both channels equally           |
| best integer lag                            | 0, and the correlation peak is symmetric |
| two bypassed inserts, or three              | the same 1.6478e-2, not double           |
| the same insert on a _different_ track      | 2.4e-7                                   |

It is deterministic (two runs of it agree to 1.4e-8), independent of every
parameter the unit has, identical across fifteen unrelated units, and it is a
one-time switch rather than a per-node cost. `mix = 0` and `bypass = true`
produce the same output, so the wet leg is not the cause. The delay, the
compressor, the EQ and twenty-two others bypass to 2e-7, which is what makes the
number legible as a fault rather than a noise floor.

**Two hypotheses were tried and both were wrong, and both changes were
reverted.** `setParam` uses `setTargetAtTime`, which _approaches_ from wherever
the parameter is, and a fresh `GainNode` is at 1 — so the wet leg opens at unity
and decays. That is true, and fixing it changed the number by nothing. Starting
the wet leg at zero changed it by nothing either. A fix that does not move the
measurement is not a fix, and keeping it would have been the re-fit this
repository's rules are mostly about.

**Left open, root cause not found.** What is ruled out is recorded above.

## The UI pointed at things the project had lost

Found by the fuzz, confirmed by hand, and worse than the fuzzer reported.
Deleting a track left `editClipId` naming a deleted clip **and**
`selectedTrackId` naming a deleted track, and both survived a save.

`src/state/reconcileSelection.ts` is a subscription rather than a line in
`deleteTrack`, because deleting is only one of the ways a thing stops existing:
undo, redo, loading a project, an import that replaces a track, a lane dropped
during validation. A rule attached to each of those is a rule the next one will
miss. Only ids are reconciled — which editor is open is the user's position, and
closing the piano roll because its clip went away would be the app deciding
where somebody is looking.

Eight cases in `tests/reconcileSelection.test.ts`; six fail when the predicate is
made to return nothing.

## The Function Ledger was under-reporting three of its own axes

Caught by the soak naming functions the ledger did not have — which is what the
orphan check in `generate-functions.mjs` is for, and the first thing it ever
found was the enumeration it is attached to.

| axis        | was | is                                                                                                                                                                       |
| ----------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shortcuts   | 70  | 71 — short entries are written on one line and the pattern demanded a newline, so `undo` was missing                                                                     |
| effects     | 33  | 34 — a lower-case character class dropped `gainMatch`, and requiring `label:` on the next line dropped `vocaltune`, which carries a paragraph of comment between the two |
| instruments | 6   | 4 — `SamplerView` gave ids like `sampler-quick` while the store, the engine and the soak all call it `quick`                                                             |

The total is still 396. Two axes gained a row and one lost two, which is the
kind of arithmetic that hides in a total.

**The ledger names the bundle its coverage was measured against rather than
comparing it.** Comparing was tried and cannot work: the check runs inside the
build, so any rebuild changes the hash and `--check` fails on a document nobody
touched. `npm run soak` refuses to write coverage for a bundle it did not
measure, which is where §10's rule belongs.

## Directive 11 §1 — the three reported defects

All three were real. Two were what the user said they were; the third was
something else wearing the same coat.

### §1.1 — "merged randomly with the FET Limiter's controls"

Not the registry. The two control sets are disjoint — 25 against 13, nothing
shared — and reopening is stable. **Only Program EQ declared a `PanelSkin`.** The
other six fell through `face.skin ?? DEFAULT_SKIN` to one identical charcoal
panel, so any two Motion Wave units side by side looked like one plugin with
different words under the knobs. The Ledger already recorded X26 = FAIL for
exactly those six; what nobody had done is look at what that meant from the
outside.

Each of the six now declares a skin derived from its own sheet's era sentence —
each of which says, in the sheet, that the era's design language "is fair to
evoke". Nothing is named, traced, or matched.

Cell 26's distinctness test had been excluding the six from its own check and
passing on the one remaining pair. It compares all twenty-one now, and an
unskinned face is fatal rather than a note.

**The skin vocabulary had a word with nothing behind it.** `value: 'mid'` could
not be built: `INK_CONTRAST` wants 7:1 and no fascia between L36 and L58 reaches
it against any ink at any chroma — measured by sweeping both axes, usable ranges
`[10, 35]` and `[59, 90]`, with 47 sitting dead centre of the hole. Worse, no
constant works at all: at 208° a lightness of 59 clears the bar and at 0° the
same 59 does not, because one HSL lightness is a different luminance at every
hue. A skin's `value` is a target now, and `legibleFascia` resolves it to the
nearest lightness that can carry ink. A target already legible resolves to
itself, so no shipped skin moved — Program EQ is still `hsl(36 13% 78%)`.

### §1.2 — "doesn't really do anything"

A fresh insert carried no shapes, so `node.ts` sent no curve, so the core kept
the flat curve at 1.0 that `reset()` leaves and `motion_shaper.h` defines as
unity gain. Units declare `defaultShapes` beside `shapeCount` now and the host
seeds them without knowing which unit it holds; the Motion Shaper's is a
sidechain duck, which its sheet lists among the stock waves.

**I called that a bit-exact no-op and it was not.** With the default removed the
render still differs by a mean of 0.0073 — a three-band crossover and an
oversampled path are not transparent at unity modulation. The unit was not a
wire; it never moved. So the test measures the spread of the wet/dry ratio,
which is modulation rather than difference:

|                      | no curve   | sidechain duck |
| -------------------- | ---------- | -------------- |
| wet/dry ratio spread | 7.2–7.9 dB | 13.2–13.6 dB   |

The bar sits at 10.5, the midpoint. The first version asked whether the renders
differed at all, and passed on the mutation.

And `centre-stage` now means something: the wide breakpoint had made the curve
one of three equal columns — a small pale box beside two columns of knobs, on a
unit whose entire subject is the shape drawn in it. It takes its own row.
726 × 208, and the panel is 696 tall rather than 901.

### §1.3 — "on mobile, whole areas are unreachable"

Real, and not where it was reported. **The MIDI effects rack and the arpeggiator
are reachable on every form factor** — Arrange, tap the track name, Browse, and
the rack is there at 374 × 76 with its add button. Four steps and no signpost,
which is a fair thing to have experienced as unreachable; the fix for that is
§6's, not §5's.

What was genuinely desktop-only was five of the eight editors. `app/editors.ts`
declares eight and a phone and a tablet each mounted the piano roll and nothing
else, so the drum editor, the score, the audio editor, the chord assistant and
diagnostics existed on a desktop and on nothing smaller. They share the registry
now rather than the widget.

## The reachability matrix

`npm run reachability`, checked in at `docs/audit/REACHABILITY.md`.

|                             | reachable |
| --------------------------- | --------- |
| phone portrait / landscape  | 20 of 25  |
| tablet portrait / landscape | 19 of 25  |
| desktop                     | 19 of 25  |

**0 defects** — nothing is reachable on a desktop and not on something smaller.
Five surfaces are not reached on any form factor, and that is recorded as `NOT
REACHED` rather than `UNREACHABLE`: the sweep navigates, selects and long-presses,
and does not open a device from an insert slot or review a take by recording one.

Getting to a number worth reporting took eight corrections and every one was the
probe:

| The sweep believed                         | It was                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| The tablet has one route                   | It navigates by `combo-*`, which discovery had never heard of     |
| Nine surfaces are unreachable everywhere   | Selection is part of a route                                      |
| Four surfaces are reachable on a phone     | Only by calling `selectTrack`, which is not a route a thumb has   |
| There are no track headers                 | Their test id is keyed on the track's **name**                    |
| Tapping a header does nothing              | Its centre is `div.th-controls`; only the name strip selects      |
| There are no track headers, again          | `page-*` are routes too, and the walk ended on Mastering          |
| Settings and diagnostics are phone defects | They are one tap further, inside the overflow menu                |
| The automation toggle is a phone defect    | `longPress` ignores mouse pointers, which is all Playwright sends |

The last one is the important one. The toggle is `display: none` below the
desktop breakpoint and the track's long-press menu carries the same commands on
every form factor. The matrix targets the **lane** now rather than the button
that reveals it — §5's own rule, that the shared layer is the action and never
the widget.

One product behaviour surfaced on the way: entering Record mode reassigns the
selection to a record-capable track. Sensible on its own terms, and it means a
sweep has to re-assert a selection before each route rather than once.

## The Function Ledger

`npm run functions`, checked in at `docs/FUNCTION_LEDGER.md`, `--check` in the
build. **396 functions**, derived from source rather than listed:

| kind               | count |
| ------------------ | ----- |
| store contracts    | 186   |
| exported actions   | 82    |
| shortcuts          | 70    |
| effect kinds       | 33    |
| navigable surfaces | 19    |
| instrument kinds   | 6     |

Every row's `tested` column reads `FAIL`, which is the honest state: this is the
denominator, not a claim. Adding a function without a row fails the build,
verified by adding one.

Two axes were read from the wrong place first and both under-reported silently.
Navigable surfaces came out as zero because every one is rendered by mapping over
a const array, so the ids in the markup are templates and matching the markup
found `nav-` and nothing after it. And `\b` in a Python heredoc is a backspace,
not a word boundary — the regex was searching for `\x08id:`. That is the second
time this session; the first was in the stuck-note axis guard.

## Directive 10 §0 — Emscripten, and a check that could not fail

The SDK is installed and pinned at 4.0.7. The freshly built core matches the
native golden **bit-for-bit**: `WASM vs native golden: worst difference
0.000e+0`. `motionwave/wasm/dist/motionwave.mjs` is what the boundary test
loads, so that is a statement about the artefact and not about a cached one.

Three things had to be fixed first, and each reported something other than what
was wrong.

`build.sh` looked for the SDK at one hard-coded path and sourced `emsdk_env.sh`
to configure it. That script calls bare `python`, which on Windows is an App
Execution Alias that prints "Python was not found" and exits — so sourcing it
silently left `emcc` off the PATH and the build failed a line later complaining
about something else. Every value it would have set is already written into
`.emscripten` by `emsdk activate`, so they are read from there.

`check-wasm-current.mjs` had the same hard-coded path and reported **SKIPPED**,
which is the one outcome that looks like success in a log while proving nothing.

And once it ran, **it could not fail**. `build.sh` copies its output over
`prebuilt/` as its last step; the check compared the two afterwards — a file
against the copy of itself that had just been written. It matched every time, on
every input, while standing guard over exactly the failure it could not see: a
tracked core that has quietly stopped being what the source builds, deployed to
everyone, findable in no commit. Reading the tracked bytes _before_ the rebuild
is the whole fix, and with it the check failed immediately — **307467 bytes
tracked against 306640 freshly built**, first differing inside the embedded
module's global section. It is now the verified build.

`wasm:check` runs in `npm run build`. It cannot be a hard requirement, because
the production build runs on Cloudflare where there is no toolchain — but its
honest skip is the right shape for that, and CI installs the SDK and runs it for
real.

### Builds are reproducible now, which is what makes a deploy verifiable

`__BUILD_TIME__` compiled `new Date()` into every bundle, so two builds of one
commit produced different asset hashes and the deployed hash could never be
compared against anything. It takes the commit's own date now. Two things had to
change for that to work: Vite writes a `vite.config.ts.timestamp-*.mjs` beside
its config while loading it, and three generated worklet copies were **tracked**
while `.gitignore` said in its own words that a tracked copy "would be a second
version of a file that must have one". Both made the tree dirty at the moment
the config was evaluated, so the commit-date path never ran.

## Directive 10 §2 — the three device-window defects

**The window could not be dragged, on any pointer type.** `onMove` read
`return`, newline, comment, `setPos(...)` — automatic semicolon insertion ended
the statement at the newline and everything below was dead. `git log -L` puts it
at `9a020d6`, the commit that added swipe-to-dismiss: the handler had been a
concise arrow whose body _was_ that call, and turning it into a block to add one
line above kept the `return`.

Nothing caught it. TypeScript greys unreachable code rather than failing a
build, and typescript-eslint defers `no-unreachable` to the compiler on the
reasonable assumption that the compiler is being asked. **`allowUnreachableCode:
false` is now set in all four tsconfigs**, and it flagged this exact line the
moment it was turned on. The window also forgot its position on every open; it
reopens where it was left.

**A device on the master channel had no editor.** `PluginWindow` resolved its
channel with `project.tracks.find(...)`, and the master is not a member of that
array — it is `project.master`. The lookup returned `undefined` and the
component returned `null`, silently, for every device ever put there. Both the
window and the racks go through one `channelRack(project, channelId)` now.

**The options menu depended on which surface a device was opened from.** The
console's `DeviceRack` had a caret menu; the inspector's `InsertRack` — a second
component for the same job — had move and remove as inline buttons behind a
disclosure. Both offer the same menu now.

`e2e/devicewindow.spec.ts` enumerates its axes from the app rather than from
memory, and caught its own version of the same mistake twice: a hard-coded track
name the demo project does not have, and a slot index that assumes an empty rack.

## The app had no contrast guard. It does now.

`tests/contrast.test.ts`, running in `npm run build`. Motion Wave has had one
since it was written; the app has not, and the accent shipped at **4.12:1 dark
and 3.80:1 light** — both under the 4.5:1 the same product enforces one
directory over — with nothing looking.

It imports the maths and the CSS parsing from `motionwave/ui/design/` rather
than reimplementing them. A second implementation of a check is not a second
proof; it is a second thing that can be wrong. This is a test importing pure
functions — the rule that `src/` may not depend on `motionwave/` is about the
shipped product and is untouched.

**The palettes are discovered, not listed.** A block declaring `--accent` is a
palette. Listing them by selector was wrong twice: the dark palette is declared
under `:root, :root[data-theme='dark']`, a two-selector rule whose text contains
the file's own line ending — so a literal match passes on one operating system
and not the other — and a listed set silently stops covering a palette somebody
adds later. Five blocks are checked, 137 pairs.

**It found three pre-existing failures on its first run**, and one of them was
in the guard itself:

| Found                                                                                                          | Was                    | Now                                                  |
| -------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------- |
| The dark palette was not being checked at all — `:root` matched the metrics block, which declares no colours   | 0 of 27 pairs resolved | discovery by `--accent`                              |
| `--border-strong` on `--bg-panel`, dark. It is the scrollbar thumb as well as a border, so WCAG 1.4.11 applies | 2.52:1                 | **3.07:1** (`#6f6b65`)                               |
| `--lamp-ink` on `--monitor-lamp`, both light palettes — a lit lamp carrying a glyph                            | 4.26:1                 | **4.63:1** (`#4885b8`, still blue by `stateColours`) |

The self-check that caught the first one is deliberate: the failure it guards is
a rename that turns every case into the early return for an unresolved token —
all green, nothing checked.

Mutation-tested both ways. Planting the old `#67c290` fails
`--accent on --bg-active` by name; dimming `--text-dim` one shade in the light
palette fails two label pairs by name.

## Directive 10 §3.1 — takes land on the grid

Directive 09 §2.5 closed two problems as one and got half of it wrong.
Monitoring latency is irreducible — delay can only be added — and that half
stands. Take _alignment_ is a different problem with an exact answer, and it was
not being done: every take sat one round trip behind the beat, so a musician who
played correctly was told they had not.

The shift is not a move of the clip. The take's first samples are the audio from
_before_ the punch point, so the clip stays where the user punched in and starts
that far into the media. Moving the clip instead would drag the punch point
around, which is a different and worse thing to do to somebody's arrangement.

`recordLatencySec` adds `baseLatency + outputLatency` to a user offset in
preferences. Only the way out is measurable: **no browser exposes an input
latency at all**, so the way back in is the offset, and it is additive rather
than a replacement because a number the platform did give is still worth having.
Negative is allowed — an interface doing its own direct monitoring costs the
player no output latency, so the measured figure over-corrects.

`takePlacement` is pure, so where a take lands is checkable without a
microphone, a decoder or a browser. Eleven cases in `tests/recordLatency.test.ts`
including the one the feature exists for — a transient played on the beat, at a
30 ms round trip, resolving to the beat within 1e-9. Mutation-tested: removing
the shift fails five cases by name, and failing to shorten the clip by what it
skipped fails two.

**What is not verified here, and says so:** whether the number is right on a
given interface. That is a claim about hardware and it needs a cable —
`docs/HARDWARE_VERIFICATION.md` carries the loopback procedure, including the
direct-monitoring case where the offset should come out negative. The
compensation is PASS on its arithmetic and BLOCKED on its calibration; those are
different claims and the second is not implied by the first.

## Directive 10 §1 — Program EQ passes V27, and the suite that proves it was dead

**The panel browser suite had not run since the worklet was renamed.** `panel.ts`
called `addModule('/shaper_worklet.js')`; the file became `unit_worklet.js` when
it was generalised to name any unit's exports, and this line was not updated.
Every run after that commit failed with "Unable to load a worklet's module" — so
**U21, the cell that page exists to measure, has not executed since**, while the
Ledger recorded it PASS on seven units. A string that names a file is not checked
by anything the way an import is, which is the whole argument for running a suite
rather than owning one.

Behind it were four more faults, each hidden by the one in front:

| Found                                                                  | Now                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Nothing emitted `data-mw-element`, so the spec's selector matched null | The renderer stamps each element with the id its face declares |
| U22's breakpoint case required the column count to _rise_              | It asserts the layout _differs_ — see below                    |
| That same wrong assertion existed twice, verbatim                      | One `layoutSignature` helper in `e2e/harness.ts`               |
| `panel.ts` refused to start an engine for any unit but the shaper      | Every unit whose channel packing is declared now gets one      |

The breakpoint case is worth spelling out. It counted grid columns and required
more of them past each breakpoint, and the stylesheet does neither reliably: the
first breakpoint raises `--mw-ctl-min` from 4.75rem to 5.25rem without
necessarily changing how many controls fit, and the second turns the body from a
column into a row, so the controls grid takes half the width and the count
**falls**, 7 to 2. Both are the layout changing exactly as declared. It now
compares a signature of everything a breakpoint may move, so it can neither pass
vacuously nor fail on a change in the unexpected direction.

All 15 browser cases pass.

### What V27 actually needed

Program EQ satisfied `U20` from the day it was written and still failed `V27`,
which is the clearest illustration of why they are two cells. Its most
mechanism-revealing readout is the harmonic display, and that reads
`TriodeStage::curvature` — `nl::curvature(config_.bias)`, a function of the
configuration. Real state, honestly published, unchanging until a knob moves.

What moves with the music is the iron, and it was being published wrongly: the
two transformer fields were assigned the input and output **peaks**. That is a
second opinion of the kind `CLAUDE.md` rules out, and a specific one — a
transformer follows flux, flux is the integral of the voltage, so the same level
at 30 Hz and at 1 kHz drives the core by amounts differing by more than an order
of magnitude. A meter fed the peak reads the same for both and therefore cannot
show the one thing it is named after: §7's low-frequency thickening.
`MagneticCore` now answers `saturationFraction()`, and the unit publishes its
peak per block.

Measured: at 40 Hz the panel reads **core drive 0.1217 against an input peak of
0.4747**. Before the core was rebuilt those two numbers were byte-identical,
which is how the first run of this test passed against the old behaviour — a
reminder that a green browser test proves nothing about a `.wasm` nobody rebuilt.

Mutation-tested at both ends. Wiring the field back to a level prints
`30 Hz core 0.2510, 1 kHz core 0.2510, ratio 1.0 x` and fails two C++ cases;
fabricating the panel value from `performance.now()` gives 40 distinct values out
of 40 while running — passing everything else — and 20 instead of 1 once the
context is suspended.

**Program EQ is SHIPPING: 27 of 27 cells PASS, the first unit to get there.**

## The C++ suite could not run on this machine at all

`CLAUDE.md` documents the core's tests as a CMake build against the host
compiler. There is no Visual Studio, no Ninja and no `g++` here, so `cmake`
cannot configure — which meant a change to `motionwave/core/` could be made,
reviewed and committed on Windows without one of its tests ever executing.

`npm run test:core` compiles each suite to WebAssembly with the emsdk clang and
runs it under Node. The core has no dependencies and each test is a `main()` over
a header-only harness, which is exactly what makes that possible. It is the same
compiler and the same source the shipping browser target is built from, so a pass
is a real pass — it is not the host target, so it supplements the CMake build
rather than replacing it. **39 of 39 suites pass.**

Getting there found three things:

- **`granular_delay.h` overrode `Node::reset()` without `override`.** Clang
  reports it; GCC's default flags do not. Now marked.
- **Eleven suites died with "memory access out of bounds"** on emscripten's 64 KB
  default stack. That reads like a product fault and is the sandbox. Raised.
- **`param_tests`' own mutation case failed at `-O1`** — the case that
  deliberately allocates inside an armed `RtGuard` to prove the guard can see an
  allocation. Clang elides the `new`/`delete` pair, which C++14 permits, so the
  guard saw nothing and the case correctly reported that it was proving nothing.
  The guard was fine; the optimiser had removed the thing it was watching for.
  Built at `-O0`, which is what the documented `-DCMAKE_BUILD_TYPE=Debug` gives.

The one flag not applied is `-Wdouble-promotion`. `oversampler.h` normalises its
window in double and stores each tap through a `static_cast<float>` — a
deliberate quantisation the bit-exact WASM boundary depends on. The first attempt
here "fixed" that line, having misread `double taps_[]` as a float array, and
would have changed what the core computes in order to silence a warning about a
cast that is the point.

## Stress-test log

Directive 10 §5. `npm run stress`, against a preview build. Measured numbers per
run so drift is visible; a regression against the previous row is a P1.

| Commit       | p90 @100 / @200 tk | Ceiling          | Transport fuzz            | Stuck-note fuzz     | Sustained run       | Retained heap | Tab switch | Undo/redo | Backgrounding |
| ------------ | ------------------ | ---------------- | ------------------------- | ------------------- | ------------------- | ------------- | ---------- | --------- | ------------- |
| `1e532e4a62` | 17.7 / 18.3 ms     | >408 tk /1200 fx | 196 ops, quiet in 1425 ms | 3240 notes, 0 stuck | 28.9 ms, drift −0.1 | +5 KB         | 97.5 ms    | 60/60 ok  | ok            |
| `b2a59c1e2c` | 17.4 / 17.8 ms     | >408 tk /1200 fx | 203 ops, quiet in 1369 ms | 3408 notes, 0 stuck | 27.9 ms, drift −0.2 | −404 KB       | 84.3 ms    | 60/60 ok  | ok            |

Read the first column and not the second. The ceiling is a threshold crossing,
and a threshold crossing read off a noisy signal is bimodal — three runs of the
first version reported **276, 408, 276** on one machine against one build,
flipping either side of the budget. The fixed-load p90s are the comparable
numbers and a P1 should be judged on those; the ceiling is kept because §5 asks
for it and because a _large_ move in it still means something. It now takes two
consecutive over-budget samples to count, and with that it reports the same
figure run to run.

`>408` is the honest reading: frame p90 never left one frame all the way to the
sweep's own bound of 400 added tracks, so the ceiling on this host is above
that, not at it.

Three cells report `BLOCKED` rather than a number, and that distinction is the
point — `BLOCKED` and `0` look identical in a table and mean opposite things:

| Not measured here     | Why                                                             |
| --------------------- | --------------------------------------------------------------- |
| Audio dropout ceiling | No audio device; xruns are not observable in headless Chromium. |
| Per-device tiers      | No phone or tablet silicon. A desktop ceiling is not a tier.    |
| Force-quit mid-record | Needs a real OS kill, not a dispatched event.                   |

### Two of the first run's numbers were the probe, not the product

Worth recording because both looked exactly like findings.

**"284,000 transport operations per second."** The fuzz fired unawaited promises
in a tight loop, so what it measured was how fast a `for` loop can discard them.
Awaited, one per frame — the fastest a keyboard repeat can actually produce
them — it is **33/s, worst op 1.1 ms**.

**"75 sources still running after a stop."** Read as a leak, and it is not one.
A voice already scheduled ahead has its stop clamped to its own start time
(`Math.max(at, when)`, `samplerInstrument.ts`), so a transport stop cannot
retire it earlier than the moment it was going to begin; under a loaded frame
loop the lookahead reaches further ahead and those retirements land past the
half-second the probe was sleeping for. It always reaches zero. The row now
waits for quiescence and _times_ it — **1425 ms** — and fails only if it never
arrives. The wrong diagnosis was ruled out by experiment rather than by
argument: a source stopped before its start time does fire `onended` in
Chromium, tested three ways, so nothing was being stranded.

A third number needed no correction and is the one worth watching: **retained
heap growth of +5 KB across a 15-second run at 408 tracks**, sampled after a
forced collection on both sides so it is what the app is holding rather than
what it has not got round to freeing.

## Verification status

| Gate                | Result                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` | clean                                                                                                                                                                                                                                                              |
| `npm run lint`      | clean                                                                                                                                                                                                                                                              |
| `npm test`          | **1964 passing**, 104 files                                                                                                                                                                                                                                        |
| `npm run build`     | clean, and now runs the licence, ledger, params, accent, contrast, icon and WASM guards                                                                                                                                                                            |
| `npm run test:mw`   | **312 of 312.** The framework guard had been red for two directives over `e2e/panel.spec.ts` importing Playwright - a rule that already allowed it, defeated by `fileURLToPath` returning backslashes so `/e2e/` never matched. It passed on Linux and failed here |
| WASM boundary       | **0.000e+0** worst difference against the native golden                                                                                                                                                                                                            |
| Deploy              | verified — see the resume block                                                                                                                                                                                                                                    |

## Directive 09 §1 — the manual has been read

`docs/reference/fsp8-parity-spec.md` and its seven chapter documents. 687 pages,
cover to cover, ~10,800 lines of parity analysis, every behaviour in
**FSP8 does / MotionLab does / `PARITY`|`PARTIAL`|`MISSING`|`DIVERGENT-BY-DESIGN`**
form with the manual line number it came from.

This replaces web research as the reference. It also corrects
`docs/REFERENCE-FSP8.md`, which was assembled from search-engine extracts
because the manual was not fetchable from the previous environment: six of its
claims are wrong, listed in `fsp8-parity-mixing.md` §14.1. The one that has
already reached the product is the channel strip's I/O selectors, which the
manual puts at the **top** and which MotionLab currently draws at the bottom.

The manual PDF is **not tracked** — `.gitignore`. It is a vendor document this
repository may not redistribute; the parity spec is the tracked record of it.

## Directive 09 §2.1 — transport stop does not stop. Closed.

**It was not the Stop button.** MotionLab had two transport owners with a
one-way dependency: `recording.stop()` called `engine.stop()`, and nothing
called back. So the six routes that reached `engine.stop()` directly — the Stop
button, the space bar, the Show page's play/stop toggle, Control Link's MMC
stop, loading a project, the diagnostics self-test — halted the clock and left
`MediaRecorder` capturing. The playhead froze, the take timer kept climbing, the
microphone stayed open, and the take was never committed.

Of the directive's four hypotheses, **the third was right** and the second was a
symptom of it (the tick interval was only ever cleared on the record-button
path). The first and fourth were not: the flag was read correctly wherever it
was read, and the finaliser did not race the stop — nothing told it to start.

**The fix is structural, not a call-site patch.** `src/audio/transportStop.ts` is
a dependency-free announcement channel; the engine announces, the recording
controller listens. The import cycle between them is why the callback had never
been added, so removing the cycle is the fix rather than a place to hang one
more call. Listeners run **synchronously and before the clock is parked**: the
first so no audio exists after the stop instant, the second so the finaliser can
still ask the scheduler where the transport was.

Six further defects surfaced while proving it, every one of them real:

| #   | Defect                                                                      | Why it mattered                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `TakeRecorder.stop()` assigned `stopPromise` **after** calling `rec.stop()` | `onstop` is not required to be asynchronous; with nothing left to flush, Firefox and Safari fire it inside the call. The handler nulled the field and the assignment put a settled promise back, so **every later stop short-circuited and never reached `rec.stop()`**. A second independent cause of the same reported symptom, on those two engines. |
| 2   | Space bar during a count-in started playback                                | `togglePlay` read "not rolling" as "stopped". The count-in then finished, found the transport playing, skipped its own `play(rollBeat)`, and the take recorded from wherever playback had begun.                                                                                                                                                        |
| 3   | Stop during a count-in zeroed the playhead                                  | The `!playing` branch read it as the second of two presses and moved the take the user had lined up.                                                                                                                                                                                                                                                    |
| 4   | Stop during `arming` was swallowed                                          | The guard read `phase !== 'recording'`, so a stop pressed at the permission prompt did nothing and the take began a moment later — the record button appearing to ignore the user.                                                                                                                                                                      |
| 5   | `start()` could be outrun by its own stop                                   | A boolean `cancelled` flag was cleared by the _next_ `start()`, so an older start resuming after an await read itself as live and trampled the take that had replaced it. Replaced by a generation counter; the unwind releases the device and owner it captured as locals, because the fields on `this` are cleared the moment the stop lands.         |
| 6   | The count-in counted at bar 1's tempo and signature                         | `project.bpm` / `project.timeSig` rather than the tempo map at the roll point. Punch in at bar 40 of a song that slows to 90 in 3/4 there, and it counted you in at 120 in 4/4 — a count-in to a pulse the take was not going to be recorded at.                                                                                                        |

**Tests.** `tests/transportStop.test.ts` (28) and `tests/countIn.test.ts` (11),
plus three real-browser cells in `e2e/recording.spec.ts`. Every one of them was
mutation-tested: reverting the announce fails 7 unit cells and 2 e2e cells by
name; reverting the recorder ordering fails 3; reverting the generation counter
fails 1; reverting either count-in fix fails 2 each.

**Why 222 e2e tests missed it.** Every recording spec ended its take by pressing
the record button a second time — the one route that always worked. The new
cells press Stop and the space bar.

`tests/transportStop.test.ts` also carries a **static guard**, in the manner of
`schemaWired.test.ts`: every line in `engine.ts` that clears the playing flag
must announce within the preceding 26 lines, and `scheduler.stop()` may be
called from `engine.ts` and nowhere else. A seventh stop path cannot be added
silently, which is how the first six came to exist.

## Directive 09 §2.2, §2.3, §2.5 — input, routing and monitoring

### §2.2 — "microphone input does not reach the app"

**The microphone was never the problem.** `getUserMedia`, permission handling,
device enumeration, hot-unplug and the whole capture path were correct and are
covered by end-to-end tests that open a real device. What was wrong is that
**arming a track did nothing observable**. It wrote one field. No device was
opened, and `engine.inputLevel` returned 0 for any track that was not
monitoring — so the meter sat dead. An armed track with a dead meter is
indistinguishable from a broken microphone, and the only way to get either
sound or a moving meter was to find a second button in a different panel.

The engine's `Monitor` is now an `InputTap`, and the two questions it used to
conflate are separated:

```
source → analyser → gain → channel input
                    ▲
                    └── zero when open but not monitored
```

The analyser sits **ahead** of the monitor gain, so the meter reads the device
whenever the input is open, audible or not — and it is still pre-trim,
pre-insert, pre-fader and pre-pan, which is what makes it an input meter rather
than a second channel meter.

### §2.5 — monitoring follows record-arm

`src/app/monitorActions.ts` is now the single reconciler. Arming, disarming, the
monitor button and a device change all reduce to one question — should this
track's input be open, and should it be heard — answered in one place from the
stored state and the preferences. It was answered separately at four call
sites, and the fourth is always the one that forgets to write
`monitoring: false` when the device refuses, leaving a lit monitor button
monitoring nothing.

Two preferences, both on by default, both with controls:

- **Arming a track opens its input** — so the meter reads. Off restores the old
  behaviour for anyone who would rather the browser's capture indicator stayed
  dark.
- **Arming a track also monitors it** — the reference documents this as a named
  option and recommends turning it on.

The permission rule is not weakened by any of it: a prompt is raised only by an
arm the user just pressed. A project saved with an armed track reconciles with
`mayPrompt: false` and stays silent, because "never ask at startup" is the rule
`inputManager` is built around.

**Two parts of §2.5 are DIVERGENT-BY-DESIGN, and the manual is the reason.**
The directive asks for monitoring modes "per the manual" and for latency
compensation. Read cover to cover, the manual documents **no** off/auto/input/
tape enum — that vocabulary belongs to a different DAW. What it has is a
monitor button, the follows-record options, and a separate _latency_ axis of
driver-level modes (§5.5 of `fsp8-parity-recording.md`) that a browser has no
API for. Nor can a page detect an interface's own hardware direct monitoring, so
"must not double-monitor" cannot be enforced; what the app can do is make
monitoring one click to turn off and warn about feedback, which it does. And
there is nothing to _compensate_ on a live monitor path — delay can only be
added, never removed. What was genuinely missing was that the app never told
anyone what latency they were tracking at. It does now.

### §2.3 — mono and stereo input

There was no track format at all, and the capture went out with
`channelCount: { ideal: 1 }` — a **hint**, which a device is free to ignore. On
a two-input interface a "mono" vocal take could come back as a stereo file with
a dead side, which pans half-way left the moment the knob is touched, and
nothing anywhere said what had been recorded.

- `Track.inputChannels` — 1 or 2, per track, absent meaning mono.
- The constraint is now `exact`, so what was captured is known rather than
  hoped for. A device that genuinely cannot manage it throws
  `OverconstrainedError`; the fallback takes a best effort so the take still
  happens, and what the device actually granted is read back from
  `getSettings()` and **shown** when it disagrees with the choice.
- **A lease is keyed on the device _and_ the format.** Keyed on the device
  alone, a mono vocal track and a stereo keyboard track on one interface would
  share whichever stream opened first and the second would silently record in
  the other's format.
- Mono records one channel and is centred by the track's pan law.

Input trim, polarity and mono-sum already existed and are **richer than the
reference**, which has no per-track input trim at all — a browser user often has
no hardware gain control, so it is a necessity rather than a luxury. That is
recorded in the parity doc rather than "fixed".

### §2.4 — audio and MIDI setup

`src/components/settings/AudioSetup.tsx`. The device settings were scattered —
input in the track inspector, MIDI in the instrument panel, neither in
preferences — so a musician sitting down with a new interface had nowhere to go.

Default input · output device (`AudioContext.setSinkId`) · sample rate · latency
hint · a live readout of what the engine **actually** got · a latency breakdown ·
restart the engine · MIDI input.

Every row says whether it takes effect now or needs a restart, and where the
browser will not do the thing at all it says so rather than offering a control
that does nothing:

- **There is no buffer size.** Web Audio has no such control. `latencyHint` is
  what it offers instead, and it is labelled as what it is.
- **Output selection is Chromium-only.** Elsewhere the row reads "system
  default" and explains why.
- **Sample rate is a request.** The device may refuse it, and a refusal used to
  throw inside the constructor and leave the app with no engine at all. It now
  falls back and says so, and the readout reports what the context reports
  rather than echoing the choice back.

### The guard that came out of this

`tests/engineStubCovers.test.ts`. `engineStub` is a hand-written stand-in for
the engine, and a hand-written parallel of a real interface drifts — it drifted
three times in one session, each time surfacing as a React render crash inside
an unrelated test file, naming a symptom rather than a cause. The guard greps
the UI for `engine.<name>` and requires the stub to have it. On its first run it
found **four more** members that had been missing all along.

`tests/prefs.test.ts` was also tightened: `AudioSetup.tsx` is excluded from the
consumer sweep, because a preference must not be able to pass that guard by
rendering its own control and nothing else.

## Directive 09 §3 — panes, windows and the keyboard

`docs/reference/fsp8-parity-windows.md` enumerates **113 reference panels against
111 MotionLab panes**, with a file path for every one of ours. The near-equality
is the most misleading number in the audit and the document says so: the
reference's are weighted toward _windows_ — 13 detachable, 8 documented for a
second monitor, 17 keyboard-addressable — and MotionLab's toward inline strips
and disclosures inside four fixed panes. The gap is structural, not numerical.

### The pane matrix is automated

`e2e/panematrix.spec.ts`, in the shape of the responsive matrix: a table, not a
file of hand-written cases. Every pane, drawer and sheet is asked the same four
questions — does it open, does it close, does it close the way a keyboard user
expects, and does it remember what it was told. **32 cases**, all passing.

A table because the failure being looked for is the **odd one out**: the fifth
sheet, written after the other four, that quietly left out a focus trap; the one
layout whose divider is forgotten while the three beside it are kept. A
hand-written suite tests the panes somebody thought of, and the ones nobody
thought of are the ones that are broken.

### The panels answer the keyboard

`workspaceStore` has had `toggle`, `reveal` and `setMaximized` since it was
written, all three correct, and **no key reached any of them** — every pane could
only be opened by finding its button. The reference's F2–F10 map is matched,
because a professional user's hands already know it:

`F2` editor · `F3` mixer · `F4` inspector · `F5` browser · `F6`–`F10` the browser's
five tabs · `Shift+F` full-screen the arrangement · `Ctrl/Cmd+1–4` the four pages ·
`Home` return to start.

**`F11` is deliberately not bound.** It is the browser's own fullscreen, and
taking it would break the key a web user relies on to get back out of a
full-screen page — a worse trade than the parity is worth. `F5` _is_ claimed:
`Ctrl/Cmd+R` remains the reload, and a DAW that swallows an accidental F5 in the
middle of a take is protecting work rather than stealing a key.

### Seven defects, every one of them real

| #   | What was wrong                                                                                                                     | Why it mattered                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`uiStore.channelOverview` was a surface with no control** — declared, defaulted true, read once by the mixer, written by nothing | The inverse of the bug class `CLAUDE.md` names, and just as invisible: the console's overview strip could be neither hidden nor brought back. Moved to `workspaceStore` beside the other view options, given a toggle on the console's own header row, and it now survives a reload                                                                                                                                                           |
| 2   | **The tablet drawers were not modals**                                                                                             | A scrim and a click-outside, then `role="complementary"`, no `aria-modal`, no focus trap and **no Escape**. They cover the workspace and take the pointer, so they are modal to the person using them; a keyboard user tabbed straight through into an arrangement they could not see, and had no key that would close it. On a tablet that is a pane that will not go away — which is how it was reported                                    |
| 3   | **`DiagnosticsSheet` was the odd one out**                                                                                         | Its own comment called it modal. Scrim, no dialog role, no trap, no Escape — alone among five sibling sheets, and the odd one out is always the one written last                                                                                                                                                                                                                                                                              |
| 4   | **The tablet bottom panel forgot its divider**                                                                                     | The one layout with no `onResize`, while the three desktop panes beside it all persisted theirs                                                                                                                                                                                                                                                                                                                                               |
| 5   | **Every layout write was lost if the page went away first**                                                                        | The write is debounced 400 ms, which is right for a divider being dragged and wrong for a tab that is closing. The timer does not survive an unload. Now flushed on `pagehide` and on `visibilitychange` — `pagehide` rather than `beforeunload` because it fires on the back/forward cache path and on mobile app switches, which is exactly where a phone user was losing a layout                                                          |
| 6   | **A size dragged to its own stop was discarded on the next load**                                                                  | The layout reader _rejected_ an out-of-range number instead of clamping it, and a divider taken all the way to its maximum comes back from the panel library a hair over — 62.007 where the maximum is 62. It fell back to the default, which was then written back over the stored value, so the preference could never be made to stick at either end of its range. A number outside a range is a boundary; only a non-number is corruption |
| 7   | **The transport advertised a key nothing bound**                                                                                   | "Return to start (Home)" sat in the tooltip while the only binding was Enter. Home is now bound, and `tests/components/panelKeys.test.tsx` carries the guard for the class: a key the registry advertises must do something                                                                                                                                                                                                                   |

Defects 5 and 6 were not on the audit's list. They came out of writing the
matrix, which is the argument for the matrix.

### Two tickets the repository had already written down

`e2e/orientation.spec.ts` carries known defects as `test.fail()` tests naming a
ticket in `docs/audit/RESPONSIVE_AUDIT.md`. Playwright fails a `test.fail()`
test that _passes_, so the day a fix lands the suite says so by name. Both open
ones are now closed, and both were the user's own report written down and
measured before they made it.

**RA-016 — the Diagnostics sheet does not close on Escape.** Closed by defect 3
above. The suite reported it as `Expected to fail, but passed`.

**RA-005 — a plugin editor cannot be closed by touch.** Measured at close 17×17
and bypass lamp 10×10 against 44 pt, with the observation that on a phone the
window covers the console it was opened from and there is no Escape key. The
close button and A/B slots had since been fixed; the bypass lamp and the preset
picker had not. Measured here: `pw-power: 10x10`, `pw-preset: 95x22`.

The picker is now 44 pt — it is a `<select>` with no glyph to protect. The lamp
cannot be and must not be: a 44 pt bypass lamp is not a lamp. It keeps the
`::after` hit area the codebase already uses for `.resize-handle` and
`.dev-power`, but **the insets are now derived from 44** rather than chosen to
look generous — `.pw-power` was 32 pt and `.dev-power` 29 pt, both under the
rule they exist to satisfy.

Nobody had noticed because **the test measured the element's border box, which
an `::after` does not change** — so the codebase's own documented fix for a lamp
could never have satisfied its own cell. The test now measures the hit area, and
gained the check the box measurement was really standing in for: no expanded
area may overlap its neighbour's by more than a quarter of a target. An `::after`
that grows past its neighbour hands the press to the wrong control, which is
worse than a small target because it is silent. That is Directive 09 §9's rule
applied to a cell that already existed.

One smaller thing: the spec's header said "Six of these describe defects that
are open" long after four had been fixed and their annotations removed. The
count is gone; `grep -c 'test.fail()'` is the count and cannot go stale.

### What §3 has not closed

Named rather than left to be discovered:

- **No detach, float or second monitor for anything.** The reference detaches 13
  surfaces and has four menu commands for it. `PluginWindow` floats within the
  page and is the only thing here called a window.
- **`PluginWindow` forgets its position on every open** (`placed.current = false`
  on each device change). One device at a time is a defensible decision and its
  comment argues it; forgetting where the window was is not.
- **`editorTab` and `browserTab` do not survive a reload** while the panes
  hosting them do.
- **No Track List pane** — no per-track show/hide, no filter, no visibility
  presets. "Show me only the drums" is not currently possible.
- **No Launcher**, and **four of eight global lanes missing** (Ruler, Signature,
  Lyrics, Video). Signature is the sharpest: the model exists in `music.ts` and
  `notation.ts` and is already used by the score view, so there is data with no
  lane.
- **131 of the 204 harvested shortcuts are still unbound**, and 44 more sit on a
  different key — usually because the virtual musical keyboard claims
  `A W S E D F T G Y H U J K O L`, which is exactly where the reference put Zoom,
  Automation, Add Track, Solo and Duplicate. Convergence there needs a decision
  about which of the two is the more important muscle memory, not a patch.

## Directive 09 §4.2 — cell 27 is in the Ledger

`V27` is defined in `docs/UNIT_LEDGER.md` and enforced by
`scripts/ledger-guard.mjs`, which now reads 27 cells and 0 shipping.

**`V27` is not `U20`, and the difference is the point.** `U20` asks whether a
visualiser reads real engine state. `V27` asks whether there is something
_moving_ that a user can watch a mechanism in. Program EQ satisfies `U20` today —
its harmonic display reads the amplifier's own `curvature()` — and fails `V27`,
because nothing on its panel moves with the music. That is Directive 09 §9's new
standing rule applied to the cell being added: a cell tests what it says, not
what its title implies.

The discriminator is the one `U21` already uses: **it must stop when the audio
stops.** It is the only one of the four criteria a plausible-looking animation
cannot satisfy — `U21` was mutation-tested by fabricating its phase from
`performance.now()`, which passed every other check and failed that one.

The guard was mutation-tested here too: marking Program EQ `SHIPPING` while
`V27` reads `FAIL` fails by name.

**Not yet built:** the animations themselves. The infrastructure they need is in
place — `motionwave/core/dsp/visual_state.h` is a templated seqlock over any POD
payload, so a unit publishes its own frame shape, and `facePanel.ts` renders any
declared face. What is missing is a `graph` readout primitive: every existing
readout (`meter`, `vu`, `lamp`, `display`) draws a scalar, and a live response
curve is a series. That is the first piece of §4.3.

## Directive 09 — the Windows build was broken, and is now fixed

The directive moved this work to a local Windows clone so deploys could be
verified again. `npm run build` did not run there at all. Four separate causes,
all of them POSIX assumptions:

- `licence-guard.mjs`, `ledger-guard.mjs` and `generate-curve-golden.mjs` used
  `new URL(...).pathname`, which on Windows yields `/C:/…/APP%20Builds/…`;
  `join` then produced `C:\C:\…` with the space still percent-encoded. Now
  `fileURLToPath`.
- `sync-motionwave-assets.mjs` took a basename with `split('/').pop()`, and
  `join` had produced backslashes, so it tried to create a directory inside
  itself. Now `basename`.
- `core.autocrlf=true` checks out CRLF while `generate-params.mjs` writes LF, so
  **all fourteen generated parameter files read as stale** and the build
  refused. `.gitattributes` now pins `eol=lf` for the working tree on every
  platform. The regeneration that followed changed **zero bytes of content** —
  `git diff --numstat` over `motionwave/` is empty.
- `e2e/recording.spec.ts` passed Chromium `--use-fake-device-for-media-capture`,
  which is **not a Chromium switch**. Chromium ignores an unknown switch, so the
  auto-accepted prompt opened whatever real device the host had: on a machine
  with a microphone the specs passed while proving something other than what
  their own comment claims, and on a machine without one they failed for a
  reason that looked like a product bug. Now
  `--use-fake-device-for-media-stream`.

## Directive 09 — verification status

| Gate                                        | Result                                             |
| ------------------------------------------- | -------------------------------------------------- |
| `npm run typecheck`                         | clean                                              |
| `npm run lint`                              | clean                                              |
| `npm test`                                  | **1784 passing**, 101 files                        |
| `npm run build`                             | clean, on Windows                                  |
| `npx playwright test e2e/recording.spec.ts` | **15 passing**, real Chromium, fake capture device |
| `npx playwright test` (all)                 | see the Deploy note below                          |
| Deploy                                      | see the Deploy note below                          |

## fx-03 — the cloud, and a pool sized for one tap

The grain engine was built for this: `EngineConfig::tapCount` is documented as
"1 for the reverb, 1..8 for the delay", and the pool partitions its slots per
tap. So there is **one engine, one pool, one ceiling** for all eight taps, which
is the carried decision and the right one — eight engines would split every
guarantee the pool makes eight ways.

**The ceiling was still wrong, and V14 found it.** `fx-02`'s 256 slots are 1.56x
the 99.99th percentile of _one_ tap at an overlap of 96. This unit runs eight
taps, and §4's table asks for 32 streams each at full Smear — 256 grains in
flight against a 256-slot pool. Measured: **3527 grains dropped in four seconds
and the spawn rate 13.35 % under**. The same arithmetic with this unit's own
worst case — mean 256, sd 16, 99.99th percentile at 315, times 1.56 — gives 492,
so 512 slots. 32 KB against the reverb's 16 KB.

Two smaller things the same row surfaced. The default tier was Studio, whose
overlap cap is 32 per tap, which is exactly what §4's table asks for at full
Smear — the cap bit at precisely the setting the sheet calls normal, and a
control clipped by a quality tier is a control that lies. And the count window
was four seconds, where the first arming and last partial hop are 1.26 % of the
total; §9 counts over sixty, ten is enough to put them under half a percent.

With all three: **zero drops at every Smear, rate within 0.92 %**, and V6's level
variation across the whole sweep down to 0.52 dB against §9's 1.0 dB — which is
the row that proves `fx-02` §1.3's normalisation is applied at spawn and inside
the loop, where a texture control that retuned the delay would show up.

`SpawnParams` gained `level` and `pan`. The engine sums every tap into one
stereo pair, so a host cannot apply a tap's level and position afterwards
without unmixing what it just mixed; they belong where the grain is built and
the tap it came from is still known. Both default to unity and centre, so
`fx-02` is unchanged by their existence.

**Read this first:** the Definition of Done is **not reachable on this build
host**, and no amount of work here will change that. Four of the five shipping
targets cannot be compiled in this container and no audio device can be opened
at all. ADR-0005 defines what "green" means under that constraint and every gate
below carries its classification. Nothing here is reported as passing that has
not actually run.

---

## Phase board

| Phase | Deliverable                                           | Status                                                |
| ----- | ----------------------------------------------------- | ----------------------------------------------------- |
| 0     | ADRs; skeleton builds                                 | **PASS (host target)** · shells BLOCKED               |
| 1     | Real-time engine: graph, transport, PPQ=480, PDC, I/O | **PASS** (graph, transport, PDC) · device I/O BLOCKED |
| 2     | Tracks, mixer, routing, automation                    | not started                                           |
| 3     | Editing, MIDI, piano roll, comping                    | not started                                           |
| 4     | Design system, plugin framework, presets, browser     | not started                                           |
| 5     | Motion Shaper                                         | research in progress                                  |
| 6     | Vintage Collection (5)                                | research in progress                                  |
| 7     | Granular Reverb + Delay                               | research in progress                                  |
| 8     | Specialty sampler (multi-portamento, MPE)             | research in progress                                  |
| 9     | Synth Collection (5)                                  | research in progress                                  |
| 10    | Sync service, project portability                     | not started                                           |
| 11    | Export, loudness targets, stems                       | not started                                           |
| 12    | Hardening: perf, battery, accessibility, docs         | not started                                           |

## Phase 0 gate — result

**ADRs written:** 0001 stack and engine topology · 0002 project file format ·
0003 repository layout and module boundaries · 0004 parameter and automation
framework · 0005 verification under a constrained host.

**Skeleton builds:** the shared core configures and compiles under CMake +
Ninja with `-Wall -Wextra -Wpedantic -Werror -Wconversion -Wold-style-cast`,
and its tests run headlessly.

```
param:    15 case(s), 0 failure(s)
tempo:    12 case(s), 0 failure(s)
topology: 12 case(s), 0 failure(s)
graph:     8 case(s), 0 failure(s)
```

Two of those fifteen assert that draining and advancing every parameter in a set
allocates nothing, and a third is the mutation test proving the allocation guard
catches a deliberate allocation — a guard that cannot fail proves nothing.

| Target              | Skeleton builds? | Why                                        |
| ------------------- | ---------------- | ------------------------------------------ |
| Host (Linux x86-64) | **PASS**         | gcc 13.3 / clang 18.1 / cmake 3.28 present |
| Windows             | **BLOCKED**      | no toolchain on this host                  |
| macOS               | **BLOCKED**      | no Xcode, no macOS                         |
| iOS / iPadOS        | **BLOCKED**      | no Xcode, no Apple Developer account       |
| Android             | **BLOCKED**      | no Android SDK/NDK                         |
| Web (WASM)          | **BLOCKED**      | Emscripten not installed                   |

Phase 0 advances on the host target and **carries** five BLOCKED shell gates,
per ADR-0005. They are re-listed every phase until a host exists that can run
them.

## QA dashboard

| Check                                              | Class       | Result                                                        |
| -------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Core compiles, warnings-as-errors                  | PASS        | clean                                                         |
| Parameter taper round-trip, all laws               | PASS        | 15/15                                                         |
| Audio path allocates nothing                       | PASS        | 0 allocations over 64 blocks                                  |
| Allocation guard catches an allocation             | PASS        | mutation-tested                                               |
| Tempo map: seconds↔ticks inverse across changes    | PASS        | 12/12                                                         |
| Tempo ramp integrated in closed form, not averaged | PASS        | asserted to differ from the average by >20 ms per bar         |
| Bars↔ticks inverse under mixed time signatures     | PASS        | 12 bars, three signatures                                     |
| Delay compensation: every path aligned at its join | PASS        | 12/12, incl. sends, diamonds and key inputs                   |
| Graph order deterministic                          | PASS        | asserted stable across runs                                   |
| Compensation aligns real samples, not just numbers | PASS        | impulse through two paths of differing latency arrives as one |
| Sidechain key arrives with the signal it keys      | PASS        | asserted by multiplying the two ports                         |
| Whole graph render allocates nothing               | PASS        | 0 allocations over 100 blocks                                 |
| Short blocks render identically to full ones       | PASS        | 16- and 64-frame renders agree                                |
| Cycle detection                                    | PASS        | reported, not looped                                          |
| Bypass null test to −120 dBFS                      | —           | no processors yet                                             |
| THD / aliasing per plugin                          | —           | no processors yet                                             |
| Golden-render regression                           | —           | no renderer yet                                               |
| Round-trip latency, xrun counting                  | **BLOCKED** | no audio device on this host                                  |
| iPhone 24 tracks + 12 plugins @ 256                | **BLOCKED** | no device; will be MODELLED as a per-core time budget         |
| Battery, thermal, touch latency                    | **BLOCKED** | no device                                                     |
| VoiceOver / TalkBack                               | **BLOCKED** | no device                                                     |

**MotionLab Studio** (the shipping web app) remains green: 1500 unit tests
across 80 files, 222 e2e, typecheck, lint and build clean.

## Directive 02 — §1 to §4

### §1 P0 defects — all three closed, with regression tests

Reproduced at 360, 390 and 430 px before any code changed. **Two of the three
reports described a real symptom with the wrong cause**, which is why the
directive asks for the cause.

| Ticket  | Reported                                                     | What was actually true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                        | Test                                                                                                                                               |
| ------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUG-001 | Controls overlap, crowd the name, collapse below usable size | **Overlap did not reproduce** — measured, the controls did not intersect at any phone width. The other two halves did: every control was **32×30 against the 44 pt minimum**, and a five-letter track name had **37 px for 42 px of text**. One cause under both — the header column is a fixed 176 px that does not answer the viewport, and its buttons are fixed-width with `flex: none`, so the strip could neither grow nor collapse by priority. Hypotheses 3 and 4 in the ticket were wrong: control size does not follow track height, and nothing was painting over anything | Reserved strip width; column 208 px on coarse pointers; fader, pan knob and automation button shed by the stated priority into the track menu                                                              | `e2e/trackheader.spec.ts` — 7 cases, real browser geometry                                                                                         |
| BUG-002 | The `M` button is doing monitoring                           | **`M` was already mute** — correctly bound, labelled and wired to stored state. What was true is that **mute lit blue** (`--mute-lamp: #63a0dc`), which is monitoring's colour in every DAW the user has met, so a lit M read as "listening". The defect was a token, not a binding. Separately real: there was **no monitor control in the track header at all**, and no monitor colour token existed                                                                                                                                                                                | Mute is amber in all four palettes; monitoring owns blue and has a loudspeaker control on audio tracks; implicit mute (silenced by another track's solo) is hatched and still reports `aria-pressed=false` | `tests/stateColours.test.ts` (mutation-tested — restoring the blue fails two cases by name) and 6 cases in `tests/components/trackHeader.test.tsx` |
| BUG-003 | Vocal tuner non-functional                                   | The **detector was never the problem** — it holds one cent from 55 Hz to 1.76 kHz and always has. The device drew an oscilloscope and read no pitch at all. Signal path was also fine: monitoring connects into the channel input upstream of the inserts, so the tuner sees live input independently of the transport                                                                                                                                                                                                                                                                | Window from 8192 samples (170 ms) to 4096; detector re-run every 40 ms instead of 120; range narrowed to the vocal 55 Hz–1.6 kHz                                                                           | 6 new cases in `tests/pitch.test.ts` at the tuner's real configuration                                                                             |

**A measured conflict between two acceptance criteria.** BUG-003 asks for ±1
cent at 55 Hz _and_ ≤50 ms to the needle. At a 43 ms window the detector is
exact from 65 Hz up and **1.44 cents out at 55 Hz**; one cent at 55 Hz needs
about four periods, which is 73 ms. That is arithmetic, not an implementation
choice. Accuracy took the window; the 40 ms update rate carries the
responsiveness, so the number on screen is never more than 40 ms behind the
voice.

### §2 Live record visualisation — implemented

**MIDI.** The recorder already held closed and held notes and never exposed
them. Notes now draw from note-on, extending as they are held — waiting for
note-off would make the longest notes appear last and a held chord draw
nothing. Drawing is incremental: closed notes are painted once, only held notes
repaint. Pinned by a test that the live lane and the committed clip agree on
where a note goes, so the take does not jump when the transport stops.

**Audio.** `MediaRecorder` never exposes PCM, so a second tap was added on the
same source. §2.1's lock-free ring needs `SharedArrayBuffer`, which this
application deliberately forgoes (no COOP/COEP), so the reduction happens in an
`AudioWorklet` — two comparisons per sample, batches posted every 43 ms from a
recycled buffer pool, steady state allocation-free. **Deviation from the letter
of §2.1, documented where the code is.**

Under back-pressure the worklet **widens its buckets rather than dropping
them**, and the receiver appends a widened bucket as many times as it stands
for — otherwise a take recorded through a stall comes out shorter on screen
than on disk. That is §2.3's "degrade resolution, never drop", arrived at from
the same reasoning.

Measured: a sixty-minute take at 48 kHz is **675 000 level-0 buckets in under
16 MB**, allocated in chunks so nothing copies a multi-megabyte buffer mid-take.

**Not done in §2**, and open: take lanes for loop/punch passes draw into one
lane rather than per-pass; input-latency compensation is not applied to the
draw head; and the on-stop reconciliation against the written file is not
asserted. The 30-minute dual-record acceptance run needs a device and is
BLOCKED here.

## Active bugs

| #   | Severity | Description                   | Owner |
| --- | -------- | ----------------------------- | ----- |
| —   | —        | none open against Motion Wave |       |

### §3 plugin and instrument audit — complete, three P1s closed

`docs/audit/PLUGIN_AUDIT.md`. Twenty-seven effect kinds and five instrument rows
against the fifteen-point matrix — **480 cells**, backed by **57 executable
probes** in `tests/audit/`, not by reading. **Thirteen findings: no P0, three
P1, ten P2.** The P1s are fixed and their probes are now the regression tests.

| ID     | Was                                                                                                                                                 | Is now                                                                                                                                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-001 | Reverb Size sweep: 90 impulse re-renders, 27.1 M samples, **2396 ms** of synchronous main-thread work. Damping: 180 / 31.1 M / 2525 ms              | **30 / 5.1 M / 192 ms** and **26 / 4.5 M / 158 ms**. Tabulated decay curve (5× faster, worst sample difference 5.96e-8 — half a Float32 step) plus a sixth-octave re-render grid in place of a flat threshold that was ¼ of the shortest tail and <1 % of the longest |
| PA-002 | Every tempo-synced insert ran at the tempo of beat 0. A 6/16 delay at bar 9 of a 120→160 song: **0.7500 s where the bar wants 0.5625 s**, 33 % long | **0.5625 s.** All seven drivers sample the map — at the playhead live, at the beat being rendered offline. Re-driving gated at 0.5 % relative, so a 120→160 ramp costs **55 insert passes over 480 frames**, not 480                                                  |
| PA-003 | 60 notes at one instant: **60 oscillators, 1 voice cut** against a ceiling of 24. Sampler: 80 live against 48                                       | **24 live, 36 steals on 36 distinct voices**; sampler 48 of 80. Stealing loops and removes each voice as it takes it                                                                                                                                                  |

The ten P2s are open and listed in the report. The three worth naming: insert
automation runs on a 25 ms offline grid that widens to 375 ms on a half-hour
bounce while playback applies it at 60–100 Hz, and `KNOWN-LIMITATIONS.md` calls
the bounce exact (PA-006); no insert declares a latency and seven have one, so
they shift their channel against the rest of the session (PA-010); eighteen
controls rebuild a WaveShaper table on every automation frame (PA-004 — the same
shape as PA-001, one tier down in cost).

What the audit could **not** claim, and does not: the bypass null test to
−120 dBFS, latency measurement, and aliasing through the browser's own 4×
oversampling are all BLOCKED under ADR-0005 — jsdom has no Web Audio, no device
and no real-time thread. A structural proof stands in for the null test, and the
shaper curves were measured directly instead of the rendered aliasing
(−14.3 dBc at 1×, −35.5 dBc with an ideal 4×, at full drive).

Two hypotheses the audit formed and disproved before publishing are recorded in
the report's Method section, which is the part of an audit that usually goes
missing.

### §4 responsive and orientation audit — complete, four P0s closed

`docs/audit/RESPONSIVE_AUDIT.md`. 19 matrix cells × the full surface walk =
**982 surface probes**, 570 of them plugin editors — all 30 devices in the
picker inserted, opened and measured on every cell — plus split screen, both
themes, two root font sizes, two UI scales and injected safe-area insets.
**16 tickets: four P0, seven P1, five P2.** The four P0s are closed.

| ID     | Was                                                                                                                                                                                        | Is now                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RA-001 | A rotated phone opened the arrangement on **0, 0 and 1** whole track rows against 4, 7 and 8 upright. 272 px of 360 went on chrome, leaving an 88 px scroller of which 82 px was the ruler | **2, 3 and 4.** Below 500 px of height every band shortens, the overview goes, the toolbar scrolls sideways instead of wrapping, and in landscape the bottom nav becomes a side rail — the rail alone returns a whole 54 px |
| RA-002 | The 64 px track header held **93 px** of controls; 25 of the strip's 44 px were cut, on all 14 touch cells. My own §1 regression                                                           | Row 1 is text only: 2 + 18 + 44 = **64 exactly**. The strip keeps mute, solo, monitor and arm at 188 px in a 208 px column                                                                                                  |
| RA-003 | Every plugin editor opened **96–199 px off-screen** on 9 of 19 cells, close button included                                                                                                | Placement measures the window against the viewport, centres when the offset will not fit, pins the header on screen when the window is taller than the screen, and re-places on rotation                                    |
| RA-004 | The shortcuts sheet clipped **~1400 px** with nothing to scroll, on **all 19 cells** including a 2560 px desktop                                                                           | Two components were sharing the class `.sc-sheet`; the shortcuts family is now `ks-` and the score keeps `sc-`                                                                                                              |

**The one that was a genuine conflict, not a bug.** RA-002 is two of the
directive's own requirements colliding: 44 px touch targets and a 64 px lane
row cannot both hold with two rows of controls, because 44 × 2 = 88. Row 1 gave
up its buttons rather than `LANE_H` growing — growing it buys a taller header
by showing fewer tracks, on the devices that already show the fewest.

**Two regressions I caused and caught**, by running the whole e2e suite rather
than the specs I was working on. Removing monitor from the touch strip to make
room broke BUG-002, and a phone is exactly where "am I listening to this input"
is hardest to answer from anything else — the track menu it was competing with
is already reachable by long-press. And the toolbar scrolling sideways put
three zoom controls past the right edge, which the chrome-integrity guard
called clipped. It was right to: viewport geometry alone cannot tell
"unreachable" from "reachable by swiping". The guard was made _more_ precise
rather than looser — a control is excused only when an ancestor both permits
horizontal scrolling and actually has overflow — and the affordance it was
implicitly asking for was genuinely missing, so the bar now fades at its
trailing edge.

**Seven P1s and five P2s remain open**, listed in the report. The P1s worth
naming: a plugin editor cannot be dismissed by touch at all (close 17×17,
bypass 10×10); the rack's `Insert` button answers no first press on any cell,
because selecting a strip reflows it out from under the pointer between press
and release; text scaling is not implemented rather than imperfect — 130 % and
200 % root font size produce byte-identical geometry, because the type scale is
`px × --ui-scale` and there is no `rem` in the codebase; and the product's own
140 % scale adds 73 defects.

**What held.** Horizontal overflow is clean on 18 of 19 cells and the previous
audit's ten fixes hold at sizes that audit never tested. Zero overlaps, zero
un-ellipsised truncation, all 100 sheet and drawer probes fit and dismiss.
Light and dark are **bit-identical** — 227 defects each, none unique to either.

**Five cells are BLOCKED** headless and say so: real device insets, the
home-indicator gesture, the software keyboard, rotation mid-gesture and
momentum-scroll hand-off. Each names what would settle it.

### A pre-existing test failure, not caused by this work

`e2e/automation.spec.ts:348` — the touch fader ride writes one automation point
where it wants more than one. Verified by stashing the §4 work and running it
against the previous commit, where it fails identically. Its own comment already
describes this container's audio stack suspending playback mid-test. Logged
rather than fixed, because it is not this directive's and pretending the suite
is fully green would be worse than saying so. **249 of 250 e2e pass.**

### Directive 03 §1 — the last MotionLab work, closed

**BUG-004 / BUG-005 — stuck keys and stuck notes were one bug, in the input
layer.** The directive's first diagnostic settled it before any fix: note-off
fired on a press and release over the same key and on nothing else.

| Scenario                    | note-on   | note-off | stuck      | lit        |
| --------------------------- | --------- | -------- | ---------- | ---------- |
| press/release on the key    | `[48]`    | `[48]`   | —          | —          |
| lift the finger away        | `[48]`    | `[]`     | **48**     | **48**     |
| pointer cancelled elsewhere | `[50]`    | `[]`     | **50**     | **50**     |
| ten fingers, reverse order  | 10        | 10       | —          | —          |
| window blur                 | `[48,52]` | `[]`     | **48, 52** | **48, 52** |
| tab hidden                  | `[48]`    | `[]`     | **48**     | **48**     |
| unmount while held          | `[48]`    | `[]`     | **48**     | —          |

The key dispatched note-off from its own `pointerup`, and the key is exactly the
element that never receives it — `pointerdown` releases pointer capture on
purpose so a finger can glide across the keyboard. **That also exonerates the
PA-003 voice-cap fix the directive asked to bisect**: its whole diff is the steal
block plus an accessor, and nothing downstream can matter when note-off is never
dispatched.

A second, independent instance was in the computer keyboard, and it was the
directive's candidate-2 failure rather than candidate 1: note-on took the pitch
from the octave at press time and note-off recomputed it at release time, so
pressing a key, hitting Z or X, and letting go sent note-off for a pitch nobody
was playing. Its blur handler also called `allNotesOff`, silencing notes it had
never started.

Both now go through one registry above every surface that plays notes.
**Fuzz: 4402 presses, 4025 releases, 1044 cancels, 529 octave shifts → 0 held,
0 unmatched note-ons**, seeded so a failure replays. All four instruments report
0 sustaining voices after 2,000 randomised events.

The engine half needed a measure the harness could not fake. `activeVoices` is
wrong for it — a correctly released voice stays in the allocation set until its
tail retires, and under a stub context nothing retires — and so is "panic wrote
something", for the same reason. `sustainingVoices` (voices with no scheduled
end) is the thing itself. A non-vacuity check caught the sampler answering 0 for
twelve held notes, because a non-looping sample schedules its own end at spawn;
the fuzz now uses a looping zone, the only sampler voice that can sustain.

**PA-010 — insert latency declared, compensated, and two combs fixed.** The
measurement needed fixing twice before it could be trusted: a full-scale impulse
makes a limiter _limit_, and a fixed 2048-sample offset arrives before the
parameter ramps have settled — which read as a rate-dependent bug in the device
(5 % short at 44.1 kHz, 40 % at 192 kHz) and was a rate-dependent bug in the
measurement.

| Device     | Measured                                       | Declared                              |
| ---------- | ---------------------------------------------- | ------------------------------------- |
| Limiter    | 214 / 336 / 1152 / 2112 at 0.5–10 ms lookahead | lookahead × rate + 192 ✓              |
| Saturator  | 192 samples at every rate                      | 192 ✓                                 |
| Distortion | 192 samples at every rate                      | 192 ✓                                 |
| Multiband  | 6.01 / 6.02 / 6.00 ms                          | 6 ms ✓                                |
| Amp Sim    | 192 + ~205 cabinet                             | **not declared** — see deviations     |
| Filter     | 7/8/16/32 samples                              | group delay, not latency              |
| Rotary     | 239/260/496/933                                | its Doppler line, which is the effect |

The more valuable find was internal: `WetDry` has always supported holding the
dry leg back, and the Saturator and Distortion never asked for it — so both were
a **192-sample comb at every Mix below 100 %**, a notch every 250 Hz at 48 kHz.
No channel-level compensation can fix that; both legs are inside the one insert.
A test had asserted this was deliberate on the grounds the delay was unknowable,
which was sound reasoning until the delay was measured.

**PA-006 — the bounce now applies insert automation at the rate playback does.**
The grid was 25 ms capped at 4800 suspensions, widening to 375 ms at half an
hour while playback runs at 60–100 Hz. It now starts at one frame at 60 Hz, and
the ceiling moved from 4.5 minutes of full resolution to about 33 — past which it
still widens, but says so in the diagnostics log instead of degrading silently,
which was the actual defect.

**Touch.** The device-window close button was 17×17 against a 44 pt minimum,
which left an open editor on a phone with no way out; the target grows while the
glyph stays small, and swipe-down-to-dismiss rides the drag gesture the header
already had. The phone track strip now sheds **Solo** rather than Monitor, per
the directive: on a phone the arrangement is most often used to track, and solo
has a loud global alternative in the transport clear where an unnoticed monitor
state is silent by definition.

### Directive 03 §2.1 — copyleft purge, closed

Four repositories were fetched during research and **none was ever committed**.
Two are MIT and stay cited; one is documentation with nothing executable in it;
`grame/faustlibraries` is GPL across the library including its `dx7/` emulation
and is **deleted, 29 MB, gone from disk**. `syn-04` is re-derived from its
manuals, patents and published algorithm tables. The `syn-01` quarantine still
stands and is restated rather than quietly dropped.

`scripts/licence-guard.mjs` runs as the first step of `npm run build`. It scans
source extensions only and deliberately ignores Markdown — the reference sheets
have to be able to say "this emulator is GPL-3.0, so its constants are
quarantined", and banning the words would delete the audit trail rather than the
risk. Verified both ways.

`scripts/ledger-guard.mjs` joins it, failing the build if any unit is marked
SHIPPING with a cell that is not PASS, or if a `BLOCKED` cell does not name the
missing capability. Verified both ways.

Carried from MotionLab Studio, unrelated to Motion Wave:

| #    | Severity | Description                                                                                                                                                                                                             |
| ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ML-1 | P2       | Live modulator phase re-anchors only when a chain is rebuilt, not across a seek. Bounces are bar-locked; playback is not.                                                                                               |
| ML-2 | P2       | `paramIdExists` returns false for `smp:*` once a track has rack items, so converting a sampler track to a rack and reloading deletes its sampler lanes. Pinned by an existing test, so changing it is its own decision. |
| ML-3 | P3       | Level-changing devices have no in/out metering; the EQ has no live spectrum behind its curve.                                                                                                                           |
| D2-1 | P1       | Live audio waveform draws all loop/punch passes into one lane; §2.1 wants a lane per pass.                                                                                                                              |
| D2-2 | P1       | The live draw head does not apply input-latency compensation, so what is drawn sits where the take was captured rather than where it will land.                                                                         |
| D2-3 | P2       | The live envelope is not reconciled against the written file on stop; §2.1 calls a mismatch a P0 and nothing currently checks it.                                                                                       |
| D2-4 | P2       | The peak-tap worklet's own loop is unverified — jsdom has no `AudioContext`. BLOCKED under ADR-0005.                                                                                                                    |

## Escalations for the user

Per §"when to interrupt me", clause (c) — hard external blockers:

1. **No Apple Developer account, no macOS, no Xcode.** iOS, iPadOS and macOS
   cannot be built, run or tested. This blocks the Phase 1 gate as written and
   the entire Definition of Done.
2. **No Android SDK/NDK, no Windows toolchain, no audio device drivers or
   headers on this host.** Same consequence for the other three targets.
3. **The §3 reference URLs are unreachable.** The egress proxy blocks WebFetch
   for essentially every domain. Research proceeds via web search, which works
   and returns substantive material, and every spec sheet cites what it found —
   but the specific pages named in the brief were not fetched.

None of these stopped work: everything platform-independent proceeds, which is
most of the engine, all of the DSP, the project format, and the sync algorithm.

## Next three actions

1. Land the Reference Spec Sheets from the four Research Analysts and open the
   provenance register in `LEGAL_NOTES.md`.
2. Buffers and the `Node` interface, so the planned graph can actually render —
   then the offline render harness and the first golden-render regression.
3. Phase 2's mixer topology on top of it: channel, bus, VCA and send routing,
   with the pan laws and the metering the brief specifies.
