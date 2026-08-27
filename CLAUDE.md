# CLAUDE.md — how to work in this repository

Two products live here. Read this before touching either.

## What is here

**MotionLab Studio** (`src/`, `tests/`, `e2e/`) — a shipping web DAW: React 18 +
TypeScript strict + Vite, Web Audio engine, ~1500 unit tests, 222 end-to-end
tests, deployed to Cloudflare Workers. It works and it is in use.

**Motion Wave** (`motionwave/`) — the cross-platform native DAW under
construction. C++17 shared core, per-platform shells, targeting Windows, macOS,
iPadOS, Android and iPhone. ADR-0001 makes MotionLab Studio Motion Wave's web
implementation and interaction reference; its Web Audio engine is not the
long-term engine and will be replaced by the shared core compiled to WASM.

Do not let them bleed into each other. `motionwave/core/` may not depend on
anything in `src/`, and `src/` may not depend on `motionwave/`.

## Build and test

```bash
# MotionLab Studio (web)
npm run typecheck        # NEVER `npx tsc --noEmit` — see the gotcha below
npm run lint
npm test                 # vitest
npm run e2e              # playwright, uses the preview build
npm run build
npm run docs-guard:release   # before a deploy — see "Documents that record state"
node scripts/check-checks.mjs # every gate mutated, and every check satisfied
npm run push-guard       # what the pre-push hook asks: is this the tree the build read?

# Motion Wave (core)
cd motionwave
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Debug
cmake --build build
./build/param_tests      # or: ctest --test-dir build

# Motion Wave (browser target)
npm run build:wasm       # needs emsdk — see below
npm run test:mw          # includes the WASM boundary test
```

## Build prerequisites

**Emscripten is required, not optional.** ADR-0001 makes the browser target the
C++ core compiled to WebAssembly, so without a WASM toolchain there is no
product on the web platform — not "no verification", no build. Fourteen units
could be finished and none of them would run in the app.

- Pinned to **4.0.7**. `EMSDK_DIR` names it; `scripts/emcxx.mjs` is the one place
  that looks, and everything else asks that. Two checks spent three directives
  reporting BLOCKED because they each looked somewhere different — `curve:check`
  asked only for `g++`, and `wasm:check`'s gate tested a path this host does not
  use, while forty-two core suites had been compiling through emsdk's clang all
  along. **BLOCKED is a claim about the host, and a claim about the host can be
  wrong.** If a check says it cannot run here, check that before believing it.
- `git clone https://github.com/emscripten-core/emsdk.git && cd emsdk && ./emsdk install 4.0.7 && ./emsdk activate 4.0.7`
- `motionwave/wasm/build.sh` sources `emsdk_env.sh` itself, so no shell setup is
  needed to build.
- **There is no `g++` on the Windows host and there does not need to be.** The
  core has no dependencies (ADR-0003), so every suite compiles to WebAssembly
  through `npm run test:core` and runs under Node. It is the same compiler and
  the same source the shipping browser target is built from — a real pass, on a
  target that is not the host, which is why it supplements the CMake build
  rather than replacing it.

**The WASM build is `-O2` and `-fno-fast-math`, deliberately.** The boundary test
asserts a bit-for-bit match against the native golden render, and the more
aggressive optimisation levels license floating-point reassociation that would
make the two targets legitimately disagree. A faster build that does not match is
not a faster product; it is a different product.

## Gotchas that have already cost time

- **`npx tsc --noEmit` type-checks nothing in this repo.** The root
  `tsconfig.json` is `files: []` with project references, so a bare invocation
  reports success having compiled zero files. Five real errors reached the
  branch behind it. Use `npm run typecheck`.
- **`tsc -b` is a _build_.** Running it with `--noEmit false` emits a `.js`
  beside every `.ts` in the tree. If you find a few hundred stray `.js` files,
  that is what happened; delete them and use the script.
- **`@container mixer` blocks in `src/styles/mixer.css` are source-order
  dependent.** The strip row templates renumber rows per tier; adding a rule in
  the middle can change which row an element lands in.
- The preview server (`npm run preview`) sometimes needs `setsid` to survive a
  backgrounded shell. Screenshots via `scripts/screenshot.mjs` need it running.
- **The build that proves the tree compiles is not the build that verifies the
  deploy, and they cannot be the same one.** `vite.config.ts` stamps the commit
  _and_ its date into the bundle, and falls back to the wall clock when
  `git status` is dirty — deliberately, because a dirty tree has no commit to be
  reproducible against. So the pre-commit build the pre-push guard wants is
  stamped with the _parent_ commit and a clock reading, and its bundle name can
  never match what Cloudflare produces. Build before committing to know the tree
  compiles and to record it; build again on the clean committed tree to get the
  bundle you compare against the live one. Both are right, the second is
  reproducible, and the first is what `.build-tree.json` is for. Chasing a
  bundle-name mismatch that was only ever a dirty-tree stamp is the hour this
  bullet exists to save.

- **Comparing a C++ float against a value parsed in TypeScript needs
  `Math.fround`.** `golden_render.h` stores each sample as a decimal literal of a
  float32; `Number()` parses it to a float64, and the two differ by about 5e-11.
  The first run of the WASM boundary test reported exactly that, and it read as
  the two toolchains disagreeing. They did not. Put both sides into float32
  before comparing — it is the only precision the audio ever exists in.

## Committing while sub-agents are running

`git add -A` has swept another agent's in-flight work into a commit twice — the
audit screenshots in Directive 02, and the framework files in Directive 04. Both
were caught afterwards, which is the problem: a rule that depends on remembering
had already failed twice while being believed.

So declare the scope and let the guard check it:

```bash
MW_SCOPE='motionwave/core motionwave/wasm' npm run scope-guard && git commit ...
```

Anything staged outside those prefixes stops the commit and is listed. Scope is
**declared, never inferred** — inferring it from what happens to be staged would
accept exactly the sweep this exists to reject, because a sweep looks like a
wide scope.

A path that genuinely belongs but sits outside the scope needs naming and a
reason: `MW_SCOPE_ALSO='package.json:the test script moved'`. The reason is never
inspected; having to write one is the mechanism.

When the guard fires, the first question is whether another agent is still
writing those files — not whether to widen the scope until it goes quiet.

## Conventions, both products

- **Comments explain why, in full sentences, and say what would go wrong
  otherwise.** A comment that restates the code is deleted. This is the house
  style and a generic comment reads as foreign here.
- **Every behavioural change arrives with a test that fails without it.** Where
  a fix is subtle, mutation-test it: revert the fix and confirm the test fails.
- **A probe that has been corrected is mutation-tested before the correction is
  believed.** Twenty probe defects have been found across the stress harness and
  the reachability sweep, and every one was diagnosed properly — which is the
  problem. "Suspect the probe first" decays into "assume the probe", and once it
  has, a correction that quietly _widens_ a check is indistinguishable from one
  that fixes it: both make the red go away. So each correction keeps the defect
  it replaced executable beside it, via `unless()` from `scripts/probe-mutant.mjs`,
  and `npm run probe:mutations` restores each one and requires the measurement
  to get worse. `--check` runs in the build: a registry entry with no call site,
  or a call site with no entry, fails. **BLOCKED is not DECAYED** — a correction
  whose branch this host never entered has not stopped mattering, and the
  registry's `exercisedBy` names the row that tells them apart.
- **No file over ~400 lines.** A longer file is describing more than one thing.
- **A picture is drawn from the same evaluation the audio uses.** Never a second
  opinion. This is why `src/model/synthFace.ts` and the `*Of()` descriptors in
  `src/model/effects.ts` exist, and it is the rule that has caught the most
  bugs in this codebase.
- **When a shared fix moves a finished unit's number, re-derive it — never
  re-fit.** A row recalibrated to match a changed implementation has stopped
  being a check on it. The Optical Leveller's attack passed at 10.6 ms while the
  cell ran four times slower, because the model and the test were both
  downstream of a DC offset and agreed with each other; removing the offset made
  the same row read 41.9 ms. The constant had by then been re-fitted three
  times, each time absorbing an interference rather than removing it — a
  rectifier smoother that had become a second pole, that DC offset, and a second
  release branch whose _attack_ had quietly become the unit's attack. Deriving
  it instead took two steps and no rendering: the attenuator's own law gives the
  open-loop constant, and the loop's incremental gain gives the factor between
  that and the observable. Where a free parameter genuinely has no published
  value, choosing it against two _published_ constraints is calibration and is
  fine; choosing it against a measurement of your own code is not.

- **Every store mutator is swept by one pattern: invoke, undo, save, reload.**
  `tests/storeSweep/` drives all 186 of them. Phase 1 requires an observable
  change, so a recipe with wrong arguments fails rather than reading green.
  Phase 2 checks the recipe's `undo: 'step' | 'none'` declaration _both ways_ —
  a step pushes exactly one entry and restores exactly; none pushes nothing.
  Phase 3 diffs the paths the action wrote and requires every one of them to
  survive `validateProject`; a reload may add defaults, it may never drop or
  alter what was written. A store action added without a recipe fails
  `tests/storeSweep.test.ts`. The arguments are hand-written per row and the
  assertions are identical for all of them — that split is the design, and
  neither half can be weakened without the other noticing.

- **A control that does nothing is a bug of the same class as a wrong number.**
  Static guards enforce it: `tests/schemaWired.test.ts`, `tests/laneWired.test.ts`,
  `tests/prefs.test.ts`. Add to them rather than around them.

- **Ask the matrix before probing for a route: `npm run route -- <surface>`.**
  `docs/audit/REACHABILITY.md` records how every surface was reached on every
  form factor, and it has now been re-derived by guessing twice — three runs
  went into `editor-tab-synth` on a phone, which has no such tab, while the
  matrix already said `nav-perform`. The RA backlog was the same shape. A
  tracked answer re-derived is the awkwardness of asking, so asking is a
  command; `route:check` runs in the build and fails if the matrix's two tables
  stop agreeing, which is what stops the index rotting against a format change.

- **A reachability claim made with `el.click()` is not a reachability claim.**
  It invokes a handler; it does not ask whether anything is on top of the
  element, whether it can be seen, whether it is on screen, or whether the
  gesture a person makes would arrive. Neither does `hasTouch: true` plus
  `click()`, which makes `(pointer: coarse)` match and then sends a **mouse**.
  Any test asserting a control is reachable drives a real pointer sequence with
  the pointerType of the form factor it claims, through `e2e/pointer.ts`;
  `scripts/gesture-guard.mjs` runs in the build and fails on a scripted press,
  or a touch context pressed with a mouse, that has not been argued for in
  writing. Four defects reached users behind tests that used it, and the fifth
  was the _measurement_: `hitBox` added a declared `::after` inset to a border
  box, which is the intended rectangle and not the reachable one. Inside a
  scroller they are nowhere near each other — `.dev-power` declared 44 x 44 and
  delivered 1 x 1. **Measure a target with `reachableBox`, never with an inset
  you can read off the stylesheet.**

- **When a measurement disagrees with the product, measure what is on top
  before you change the product.** The sampler library's rows read 41pt against
  a 44 minimum. Two rounds went into making the control bigger — and the control
  was 46 x 46 border-box the whole time; what was actually wrong was that the
  on-screen keyboard clipped the last row of the scroller, which `reachableBox`
  was correctly refusing to count. The ruler was right both times, and adjusting
  a number until a measurement agrees is how a real defect gets absorbed rather
  than removed. `elementFromPoint` at the failing edge names the thing on top in
  one probe. `reachableBox` hit-tests on the pixel grid and so resolves to about
  a pixel — `TOUCH_MIN` and `RULER_SLACK` in `e2e/pointer.ts` say so once, and
  `RULER_SLACK` is an allowance on the instrument, never on the requirement.

- **A surface that opens on top of its opener has deleted the gesture that
  closes it.** The channel rail's contract is one tap to open a device and
  another to close it; on a phone the window opened over the card, so the second
  tap landed on the EQ curve inside the window and no gesture could reach the
  card at all — `elementFromPoint` at its centre returned `svg.fx-curve`. Nothing
  was too small and nothing was off screen. `placeClearOf` in
  `src/components/mixer/windowPlace.ts` opens below the opener, then above, then
  falls back, and the sweep that proves it found the band where neither fits: a
  420 px window in an 844 px viewport needs 428 clear pixels beside a 44 px
  control and the middle leaves 410 on both sides. **A placement rule cannot
  invent room, so say where it runs out rather than widening the claim.**

- **A gesture test must send what a browser sends.** `fireEvent.doubleClick`
  dispatches a lone `dblclick` and _no clicks at all_; a real double-click sends
  click, click, dblclick. Three tests built on it were asserting against an event
  sequence no person can produce. And do not freeze `performance.now()` to put
  two presses in the same instant — React's scheduler reads that clock, so the
  re-render never comes and the case fails for a reason that is not the product.
  A gesture reads the **event's own `timeStamp`**, which is when the input
  happened rather than when the handler ran, and which a test can simply set.

- **A target grown past the row that holds it is a target pointing at
  something else.** Three times now: a 44 px options button in a 16 px rack row
  landed on the third device's icon; a 44 px hit area on a 5 px lamp bypassed
  the _next_ device; `min-height: 44px` inside a 34 px toolbar measured 44 x 34.
  Where the row cannot hold the minimum, the row grows or the control goes —
  WCAG 2.5.8's equivalent-alternative provision is the route, and it obliges the
  alternative to carry _every_ command the small control offers.

- **A surface that needs an asset has a control that supplies one, and drag is
  never that control.** HTML5 drag-and-drop is a mouse protocol — a finger does
  not produce `dragstart` — so a drop-only surface has no route at all on a
  phone or a tablet. The sampler shipped that way: three buttons that said
  "load" all loaded a fixed procedural sample, and the only route to your own
  audio was a drag from a panel the sampler never mentions. One panel over,
  `rackAddItem(_, 'sampler')` made a layer the engine played and nothing could
  ever fill. `tests/assetSupply.test.ts` sweeps the component tree for both
  shapes: a component that _creates_ an empty asset slot must draw a control
  that fills it, and a component that accepts a drop must offer a route that
  needs no pointer. A surface that needs neither is registered with the reason.

## Documents that record state

- **No tracked document records product state unless it is generated from a run
  or machine-checked in both directions.** Four have gone stale this way:
  `SOAK.md` carried a FAIL a directive after the product fixed it, the parity
  chapters marked five closed items MISSING, the RA backlog held three closed
  tickets, and `DEVICE-PARITY.md` had never been told about seven shipped
  devices. A wrong document is worse than a missing one, for the same reason
  `tsconfig.e2e.json`'s existence stopped anybody asking.
- Every file under `docs/` is **GENERATED**, **GUARDED** or **NARRATIVE** in
  `scripts/docs/registry.mjs`, and `npm run docs-guard` enforces what each
  means. Unclassified fails the build; so does a registry entry for a file that
  is gone. A NARRATIVE document may carry `historical: true` and name the commit
  it describes — that is the conversion for an audit, because a measurement of a
  named tree is history and cannot go stale.
- **`npm run docs-guard:release` before a deploy.** It compares the source
  fingerprint `docs/audit/SOAK.md` declares against `src/` — not the bundle name.
  Comparing the bundle cannot work: `vite.config.ts` compiles the commit date in,
  so committing the fresh report invalidates the name the report has just been
  made to carry, and a check that cannot be satisfied gets turned off.
- **A guard that asks git anything declares what kind of copy can answer it.**
  `docs-guard`'s history check ran `git cat-file -e` on eleven commits
  Cloudflare's builder had never fetched, failed all eleven, and took the deploy
  down. A claim about the repository made from a truncated copy of it is the
  same error as BLOCKED being a claim about the host. Skip, and say so — and
  say it in the file: one `// @clone: working-tree | index | full-history` line,
  which `check-checks --check` reads. Declaring `full-history` obliges the
  script to detect a shallow clone and skip that part, and the build fails if it
  does not. `scripts/checks/clone.mjs` is the rule; `docs-guard`'s second
  satisfiability case is the proof, and it clones this repository `--depth 1` to
  get it.

- **Currency is not completeness.** A generated document can be _current_ and
  _empty_ at the same time: `docs/audit/SOAK.md` was overwritten with three
  lines by fifty-four scoped probe runs and `docs-guard` stayed green, because a
  partial run copies the source fingerprint forward correctly and the header is
  written before there is anything to render. **Everything that says a generated
  document can be trusted is written before it has any content in it.** So every
  GENERATED entry in `scripts/docs/registry.mjs` carries a `must`: the sections
  it has to contain, the shape of each, and a minimum it cannot be below. A
  report with no fuzz section, or a table with zero rows, fails whatever its
  fingerprint says. **A floor is derived or it is one** — the soak's property
  table is checked against the harness's own list and the Function Ledger's
  table against the total the ledger itself states, because a minimum chosen to
  sit under today's measurement is a constant fitted to the thing it checks.
  `docs-guard` truncates every generated document to the stub its own generator
  would write and requires all five to be rejected, on every build.

- **The build goes after the last edit, and git enforces it.** A commit was
  pushed that could not have built: a file split moved a string past an
  exemption, `npm run build` exited, and lint, `format:check` and
  `check-checks --check` all passed on that tree afterwards — none of them is
  the build. So the build's last step records what it read
  (`scripts/checks/build-tree.mjs --record`, into the gitignored
  `.build-tree.json`) and `.githooks/pre-push` refuses a push whose commit is
  not that tree. The comparison is a manifest rather than a tree hash, so an
  untracked scratch file is in neither side of it; `BUILD_OK_ANYWAY='reason'`
  is the override and it takes a reason for the same reason `MW_SCOPE_ALSO`
  does. `npm run hooks:install` points git at `.githooks`, and `prepare` runs it.

- **A gate may need more than one mutation.** `mutate` takes a list, and every
  edit in it has to turn the check red. A guard that enforces four unrelated
  rules is load-bearing in four ways, and one edit can only ever speak for one
  of them — `docs-guard`'s completeness rule would have been proved by nothing
  while the entry read HELD.

- **Every guard must be provably _satisfiable_, not only falsifiable.** A
  mutation says a check is load-bearing. It says nothing about whether the state
  the check demands can ever be reached, and `docs-guard`'s currency rule was
  both load-bearing and unreachable: it compared a bundle name that
  `vite.config.ts` changes on every commit, so committing the report it wanted
  invalidated the report. **A check that cannot be satisfied gets turned off**,
  and that is this whole apparatus failing by a side door. So every entry in
  `scripts/checks/mutants.mjs` carries a `satisfy` case beside its `mutate` one
  — a constructed state the check must accept — or a `satisfiedBy` reason why
  none can be built. The strongest form is `repairedBy('npm run …')`: apply the
  gate's own mutation, run the writer the error message names, and require the
  check to go green. `ACCEPTS` / `REFUSES` are the verdicts, and `REFUSES` fails
  the run.

## Motion Wave core: the rules that are not negotiable

- `motionwave/core/` has **no dependencies** — no platform headers, no GUI
  framework, no third-party library. That is what lets it compile for a phone,
  a desktop and a WebAssembly sandbox from one source (ADR-0003).
- **Nothing on a path reachable from `process()` may allocate, lock, do file
  I/O, or log.** Proven, not reviewed: `motionwave/core/test/rt_guard.h` arms an
  operator-new hook around the call and the test fails by name if anything
  allocates. That guard is itself mutation-tested.
- Parameters cross the audio boundary through `ParamSet` and nowhere else
  (ADR-0004). If you find yourself wanting a second mechanism, the answer is
  that you want a `ParamSpec`.
- No trademarked reference name appears anywhere under `motionwave/` — not in a
  filename, type, symbol, preset name or comment. Reference names live only in
  `docs/reference/`. See `LEGAL_NOTES.md`; this is a commercial-safety
  requirement.
- **A spec that names its own mutation has to be able to catch it.** VS-02 said
  "replace the partition with a boolean flag per voice and this case must fail",
  and its three stated criteria all _hold_ under that mutation: the array is
  never reordered, so it stays a permutation. What breaks is disjointness of
  ownership, and nothing was asking. Two more of the same shape were found by
  sweeping the document — VS-23's criteria are satisfied by a receiver that
  ignores the zone message its own prose says must not be ignored, and §5.2's
  exponential formula reaches its target at `x = 1` while starting 3 % away from
  where the previous segment ended. This is the cell-title failure at spec
  level: a row that tests what its title implies rather than what its criteria
  say. When you correct one, keep the version it replaces on the page.

- **A value marked `[I]` in a spec sheet is quarantined.** It came from an
  emulator implementation rather than from a measurement or a manual, which
  makes it somebody's design decision rather than a fact about the hardware.
  Re-derive it or choose your own before it reaches `motionwave/`. `LEGAL_NOTES.md`
  explains why and names the affected set.

## What NOT to refactor

- **MotionLab's offline bounce parity.** `src/audio/exportMix.ts` and the
  realtime engine build through the same `InsertChain`; the parity is asserted
  by e2e tests that render the same bars two ways. Changing one side without
  the other silently breaks exports.
- **`ControlVca`'s `envelopeTop`** in `src/audio/effectChain.ts`. The limiter
  widens it and the gate narrows it, and both are load-bearing: the limiter
  could otherwise only reduce 0.40 dB, and a gate below −66 dBFS threshold did
  nothing at all. The comment there records the numbers.
- **The three-theme contract.** An explicit choice stamps `data-theme`; "system"
  stamps nothing and follows `prefers-color-scheme`. Every palette token must be
  defined on bare `:root` first.
- **`paramIdExists` in `src/persistence/projectRepo.ts` is deliberately wide.**
  It is the predicate `validateProject` _drops_ lanes by; narrowing it deletes
  users' automation on the next save.

## Where the decisions are

`docs/adr/` — one file per locked decision, with the rejected alternatives.
`docs/reference/` — Reference Spec Sheets for every modelled unit, sources cited.
`PROGRESS.md` — phase board, QA dashboard, active bugs, next actions.
`LEGAL_NOTES.md` — provenance and IP compliance.
