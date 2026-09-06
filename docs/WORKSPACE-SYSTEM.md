# The workspace system

What a layout is in MotionLab Studio, why it is one model rather than six
fields, and what "multiple workspaces on mobile" means now.

This is NARRATIVE: it records the reasoning and the shape of the design. Every
claim it makes about what the product _does_ is checked somewhere executable,
and each section says where — a document that records state and is checked by
nothing goes wrong silently, which is the failure `scripts/docs/registry.mjs`
exists to make impossible.

## Why row 11 of the layout audit says "No" and this says otherwise

[`LAYOUT-AUDIT.md`](LAYOUT-AUDIT.md) row 11 asks "Multiple workspaces on
mobile?" and answers:

> No — phone shows one mode; `browse` stacks browser+inspector inside the single
> Browse mode

That answer was correct, and it is **still correct about the tree it describes**.
That document is stamped `Describes commit 66bea096d8` and is registered as
history: a measurement of one tree at one moment cannot go stale, because it was
never a claim about now. Editing its row to say "Yes" would have made it describe
neither that commit nor this one — the conversion this repository already made
for four audits, arriving from the other direction.

So the answer moves rather than the row. **Multiple workspaces on mobile: yes**,
and the rest of this document is what that means.

## One authoritative model

`src/state/workspaceModel.ts` holds it and `src/state/workspaceStore.ts` is the
store over it. Three shells — `DesktopLayout`, `TabletLayout`, `PhoneLayout` —
derive every pixel they draw from that one model and keep nothing of their own.

```
panes: { browser, inspector, editor }   each { visible, collapsed, size, lastSize? }
maximized: null | 'arrange' | 'browser' | 'inspector' | 'editor'
editorTab: which editor the editor pane is showing
phoneMode:  which workspace a phone is showing
showMarkers / showSections / showChords / showTempoLane / showOverview
channelRackOpen
```

Four things about that shape were decisions rather than transcription, and each
one is a defect that had already happened:

**The tablet's bottom pane is the editor pane.** It was `tabletBottomSize`, a
field of its own, and two fields for one pane is how the two came to be clamped,
persisted and reset differently — the tablet was for a directive the one layout
that forgot its divider on reload.

**`editorTab` and `phoneMode` are layout, so they live here.** They were on
`uiStore`, and `TabletLayout` kept a third copy in a `useState`: a control that
set the tab and revealed the pane changed the tab, revealed the pane, and watched
the pane go on drawing the mixer. Six controls were inert on a tablet and worked
on a phone and a desktop, which is exactly why it survived a directive. If two
pieces of state can disagree about whether a surface is showing, derive one from
the other — or, as here, make them two fields of one model.

**`lastSize` is optional, not `0`.** The sentinel could not tell "never moved"
from "dragged to the floor", and the tablet read the same `0` as "use the height
heuristic" — so a user who dragged the divider all the way down got the heuristic
back on the next launch.

**`visible` and `collapsed` are different questions.** See below.

_Checked by:_ `tests/workspace.test.ts` (the model, the migration, the mutators),
`tests/workspaceWired.test.ts` (the static guard: no shell holds layout in local
state, no shell spells a pane limit as a literal, every pane in the model is
drawn and every pane drawn is in the model).

## The constraints are declared once

`PANE_LIMITS` in `workspaceModel.ts` carries every pane's pixel floor,
percentage bounds, rail width and default size. Both the normaliser and the
shells read it.

They used to be written twice — `minSize="180px"` in `DesktopLayout`'s JSX and a
`10..40` clamp in the store — and the two could disagree: a browser the store
clamped to 40 % came back from the panel library at 34, and the store wrote 34
over the preference on the next resize event. The size could never be made to
stick at the top of its range.

_Checked by:_ `tests/workspaceWired.test.ts`, "the pane constraints are declared
once" — which matches a sizing literal against the `<Panel>` element that carries
it rather than against a table of numbers, because the arrangement's own
`minSize="180px"` collides with the browser's 180 and is not a duplicate of
anything.

## Collapse is a state, not a hide

A hidden pane is not drawn. A **collapsed** pane is drawn as a rail: a 44 px
strip carrying one control, which expands it back to the size it had.

44 is WCAG 2.5.8's minimum and the rail is exactly as thick as the button it
exists to hold. That is not a design preference — collapse used to be
`showEditor: false`, which unmounted the pane, forgot its size, and left the top
bar's toggle and an F-key as the only routes back. A phone has neither. A pane a
finger can fold away and never re-open is a trap, and the rail is what stops the
gesture being one.

`paneIsOpen(pane)` is the single derived answer to "is this pane drawing its
contents". Any component asking `visible` alone would draw a browser inside a
44 px strip.

_Checked by:_ `tests/workspace.test.ts` ("collapse is a state, not a hide"),
`e2e/workspaces.spec.ts` (the rail measured with `reachableBox` on every touch
form factor, pressed with a real pointer, and the size asserted to survive the
round trip).

## The phone's mapping for full screen

A phone mode already fills the workspace, so "maximise" cannot make a surface
bigger. What it can do is withdraw the transport and the bottom navigation —
about 100 px of an 844 px screen, and the difference between four visible lanes
and six. So on a phone `maximized` means **immersive**.

That leaves the phone with no navigation at all, which is why the immersive state
draws its own rail: there is no Escape key, and the control that opened the state
has gone with the chrome. A gesture that removes every route out of a state is
not a gesture.

Which pane `maximized` names does not change the phone's picture, because a phone
shows one surface either way. It is preserved rather than cleared so that
rotating a tablet into a phone and back does not lose it.

_Checked by:_ `e2e/workspaces.spec.ts`, "phone: full screen means immersive, and
the rail is the way out" — which asserts the navigation is gone (otherwise full
screen gave the surface nothing) and measures the way back out.

## Named workspaces

Save the current layout under a name, recall it, rename it, delete it. Three
built-ins ship: **Arrange**, **Mix**, **Edit**.

A workspace records the **whole** model, not a diff against the defaults. A diff
would have to name the fields it covers, and the first field added to
`WorkspaceLayout` afterwards would silently not be recalled — a defect arriving a
release later, looking like the layout "forgot" something.

The built-ins are **derived** from `DEFAULT_LAYOUT` rather than written out, each
stated as what it changes: Arrange is the default; Mix hides the side panels and
gives the editor its maximum; Edit hides the browser, opens a note editor and
drops the overview. A change to a default size moves all three rather than
leaving three stale copies of a number.

Because `editorTab` and `phoneMode` are fields of the same model, one preset says
what a phone, a tablet and a desktop should each show — which is what makes
"recall the Mix workspace" mean the same thing on all three.

_Checked by:_ `tests/workspace.test.ts` ("named workspaces": save, recall,
rename, delete, the built-ins' derivation, name collisions, and a workspace saved
in the v1 shape being migrated on recall), `tests/storeSweep/recipes/shell.ts`
(every mutator, through the four-phase sweep).

## Where each command is reached, per form factor

| command                | desktop                                       | tablet                        | phone              |
| ---------------------- | --------------------------------------------- | ----------------------------- | ------------------ |
| show/hide a pane       | top bar buttons, F2/F4/F5, overflow menu      | overflow menu                 | overflow menu      |
| collapse/expand a pane | pane title row, Shift+F2/F4/F5, overflow menu | editor toolbar, overflow menu | overflow menu      |
| maximise/restore       | pane title row, Shift+F                       | editor toolbar                | the immersive rail |
| workspaces             | the top bar's own button                      | overflow menu                 | overflow menu      |

The overflow menu carries the same five workspace commands on every form factor,
built from one list in `WorkspaceMenu.tsx` — a shell that grew its own copy is
how the tablet came to have a second opinion about which editor was showing.

_Checked by:_ `docs/audit/REACHABILITY.md`, generated by `npm run reachability`;
ask it with `npm run route -- workspaces`. `e2e/workspaces.spec.ts` drives the
routes with a real pointer per form factor and measures each control with
`reachableBox`.

### Two measurements disagree about the tablet, and the sweep is the wrong one

The matrix reports **named workspaces** as NOT REACHED on `tablet-portrait` and
`tablet-landscape`. `e2e/workspaces.spec.ts` reaches them there with a real
touch pointer, on every run, and asserts a 44 px menu row before pressing it.

The sweep is what is wrong, and the cause is measured rather than guessed:
`open-settings` is one of the sweep's openers, and a settings sheet left open
puts a `.sheet-scrim` over the whole app. Instrumented, `topbar-overflow` sat at
724,3 with `DIV.sheet-scrim` on top of it, every click on it timed out, and the
menu opened **zero** times — so every command behind the overflow reads as
unreached on the form factors whose route is the overflow.
`selectByTapping` already dismisses modals for exactly this reason and says so;
`walkRoutes` does not.

**It is written down here rather than fixed, and that is deliberate.** Two
corrections were tried against it and mutation-tested, which is what stopped
either being believed: walking submenus changed nothing at all, and dismissing
modals before every opener fixed the tablet while taking the phone from 3/3 to
0/3 on settings, export and the shortcut sheet — a correction that trades one
form factor for another is a widening, and only the mutation said so. A third
attempt narrowed it and fixed neither. A probe correction that has not converged
is a probe correction that should not ship: `docs/audit/REACHABILITY.md` is what
the unmodified instrument measured, and this paragraph is why one of its rows
should not yet be read as a product defect.

The work left is one correction to `walkRoutes` in `scripts/reach/walk.mjs`,
with a registry entry in `scripts/probe-mutant.mjs` whose mutation must make the
tablet worse **without** making the phone worse.

## The v1 migration

The previous shape was stored under `txpps-motionlab-workspace-v1`. The current
one is `-v2`, and a v1 blob is read forward on load: `showX: false` becomes
`visible: false` and **not** `collapsed` (they are different states now, and only
one of them keeps a rail — a migration that made every hidden pane a collapsed
one would hand every existing user three rails they never asked for), and
`tabletBottomSize` becomes the editor pane's `lastSize`, with the `0` sentinel
correctly producing no remembered size at all.

The v1 entry is read rather than deleted, so somebody who rolls back to the
previous build still finds their layout there.

_Checked by:_ `tests/workspace.test.ts`, "a layout saved by the previous build
loads to the same picture" — against a literal capture of the JSON the shipping
v1 store wrote, because a migration checked against a blob written by the
migration is checked against nothing.
