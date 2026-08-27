# The channel: strip, view and rack

Design for directive items 12, 13 and 14. Written before the build, because the
three of them are one surface and building them one at a time would mean
designing it three times.

This document is the argument. `docs/adr/` is where a locked decision goes; this
is not locked yet — one channel's worth ships against it and is judged, and what
survives judgement becomes the ADR.

## 1. What the measurement says, before any of it is design

Item 10's sweep found the console's landscape overlaps, and three attempted
fixes each traded the defect for another one. The reason is arithmetic and it is
worth writing down as a number rather than as "the strip is crowded".

Measured on the shipped build, coarse pointer, mixer reached by its own control:

| form             | strip height | rows still drawn | sum of rows | over       |
| ---------------- | ------------ | ---------------- | ----------- | ---------- |
| phone-portrait   | 642 px       | 8                | 601 px      | fits       |
| phone-landscape  | 254 px       | 6                | 282 px      | 28 px      |
| tablet-landscape | **131 px**   | 5                | 234 px      | **103 px** |

At the two landscape tiers `strip-input` and `strip-pan` are already
`display: none`, and on tablet-landscape `strip-readout` is too. Three of the
nine rows have already been spent and it is still 103 px over.

Now the number that ends the argument. On a coarse pointer `--dev-slot-h` and
`--dev-add-h` are both 44 px, so the rack's derived floor is

```
--dev-rack-min = 44 + 2 (gap) + 44 + 2*2 (pad)          =  94 px
.dev-rack:has(.dev-instrument) adds a row               = 140 px
```

and tablet-landscape gives the whole channel **131 px**. **The rack's floor
alone is larger than the entire strip.** Delete the name, the fader, the meter,
the mute, the solo, the readout and the routing, and it still does not fit.

That is why every cap moved the collision instead of removing it. The floor is
not wrong — it exists because a device row clipped part-way down yields an
options button under the touch minimum, which is a device on the channel that
cannot be bypassed, moved or removed. **The floor is right and the container is
wrong.** A vertical list of 44 px touch rows does not go in a 112 x 131 box, and
no arithmetic inside that box will make it.

## 2. Three surfaces, three questions

The strip is trying to answer three questions with one shape.

| surface       | the question it answers        | the shape that answers it       |
| ------------- | ------------------------------ | ------------------------------- |
| console strip | how do these channels compare? | narrow and tall, twenty at once |
| channel view  | what is on _this_ channel?     | wide and short, one at a time   |
| plugin window | what is this device doing?     | floating, one device            |

The chain is the part that does not fit in the strip, and it is also the part
that is never compared across channels: nobody scans twenty strips to compare
their fourth insert. So the chain is what moves, and it moves to the shape that
suits it — horizontal, which is the affordance landscape actually has and the
one the console has been refusing to use.

## 3. Item 12 — the Channel view

`ChannelOverview` already exists and is already the right idea: input, the EQ
curve, dynamics with its gain reduction, the rest of the chain, sends, fader.
What is wrong is where it lives. It is a band inside the mixer, toggled by
`showChannelOverview`, taking 116 px out of the mixer pane's height — a
permanent tenant of the track area, taken from the strips, which is exactly what
item 12 says to stop doing.

It becomes an editor. One entry in `src/app/editors.ts`:

```ts
{ id: 'channel', label: 'Channel', icon: 'mixer', hint: '…', component: ChannelView }
```

That registry is the reason this is one file rather than six: the phone's editor
strip, the tablet's combo control and the desktop's bottom editor all read it, so
the surface appears on every form factor at once. It is also why it is a tab
rather than a pane — a pane is a layout decision each shell makes separately, and
five of eight editors were once on the desktop and nowhere else for that reason.

Layout: sections in signal order, left to right, scrolling horizontally.

```
 Kick                                                    [rack ▾]
+--------+----------+---------+---------+---------+-----+-------------+
| IN     | MIDI FX  | INSTR   | EQ      | Comp    |  +  | SENDS   OUT |
| Ø  M   | Arp   >  | Sampler | .-^-.   | ####..  |     | (o)(o) ->Bus|
| ±0.0   |          | 12 zone | 8 bands | -4.2 dB |     | Rev Dly  o  |
+--------+----------+---------+---------+---------+-----+-------------+
                                            the rail scrolls | sticky |
```

Height budget, so it fits the pane that broke the strip: title 22 + two 44 px
control rows = 110 px, against tablet-landscape's 131. Width is unbounded and
scrolls. **The Output section is a separate flex child pinned to the right, not
a card in the rail** — that is how "never stealing room from the fader" becomes
structural rather than a promise: the rail cannot push what it does not contain.

## 4. Item 13 — the rack's interaction model

Inside the Channel view every device is a card in a horizontal rail, in three
states:

| state     | width         | entered by                                           |
| --------- | ------------- | ---------------------------------------------------- |
| collapsed | 84 px         | default                                              |
| quick     | 168 px        | **double tap** — its `microParams`, inline           |
| open      | 84 px, marked | **single tap** — the plugin window; tap again closes |

Today this is inverted: `dev-name` single-click toggles the micro params and
double-click opens the window. The two swap. That is a real change to muscle
memory on the desktop as well, and it is the right way round: the window is what
you want most often and it is currently the one that costs two clicks.

**Tap-again-closes** works because `openDevice` is already
`{ trackId, effectId }` — identity, not a boolean. A tap sets it; a tap on the
device that is already open clears it.

**The ambiguity, and how it is resolved.** A tap that opens, followed 200 ms
later by a tap that closes, is indistinguishable from the first half of a double
tap. There are two ways out and the obvious one is wrong: deferring the open by
one double-tap interval puts 250 ms of latency on the common case in order to
serve the rare one. So the open happens immediately and **a second tap inside
the interval reverts it** and toggles the quick controls instead. Reverting is a
state flag rather than a navigation, so it costs nothing; the cost is a brief
flash on a gesture that is rare, which is the right place to put it.

**Collapsible.** The rack header carries a caret that collapses every card to a
24 px chip — names only, no controls — for when the channel view is being used
for its sends and its fader. It is a view preference and lives in the workspace
store, not the project: it is not a property of the music.

**Scrollable.** `overflow-x: auto` on the rail. A chain longer than the pane
scrolls; it never re-tiers anything, because there are no tiers to re-enter — the
rail is one row of fixed-width cards, and adding a twelfth device changes the
scroll extent and nothing else. That is the whole reason horizontal is the right
axis: a vertical rack in a fixed-height strip has to decide what to drop, and a
horizontal rail in a scroller does not.

## 5. Item 14 — a send is not a bus

The model already distinguishes them and the UI does not say so.

- **Output** is `track.output`. Exactly one, and it moves the whole signal.
- **Sends** are `track.sends[]`. Any number, each an _amount_ of a copy, and the
  channel keeps going where it was already going.

Drawn so that the difference is the drawing rather than a label: **output is an
arrow** and **a send is a knob**. An arrow has no quantity and a knob is nothing
but quantity, which is precisely the distinction. Each send knob carries the
target's name and its pre/post tag underneath.

And one defect that item 14 names exactly. `Mixer.tsx` builds
`sendTargets = [...buses, ...fxChannels]` and passes it to the strip as `buses`,
where it fills the **output** select — so the output dropdown currently offers FX
returns as output destinations. The `fx` type exists to say "fed by sends rather
than by output routing", and offering it as an output erases the one distinction
the type was created for. After this: the output control offers buses, and the
sends row offers FX returns and buses.

A track whose output _is_ an fx track today keeps that option in its own select,
so the control can still represent its own value. Nothing is silently re-routed —
the same rule `paramIdExists` follows, and for the same reason.

## 6. Item 12's other half — the console strip, and nine rows in four

This is the part the measurement makes unavoidable, and it is not "fit nine rows
into four". It is: **four rows is a real number, the other five have somewhere
to be, and the strip says so with a control that goes there.**

The strip keeps what a console is for:

1. **name** — you cannot compare channels you cannot tell apart
2. **fader + meter** — the reason the surface exists
3. **mute / solo / arm** — the state you flip while listening
4. **route** — where it goes

and one row that replaces the rack: a **chain summary**, one 44 px control
carrying a family-coloured dot per device. It still answers the comparison
question — what _kind_ of chain is on this channel, across twenty channels at a
glance — and tapping it opens the Channel view on that channel.

That is WCAG 2.5.8's equivalent-alternative provision, which obliges the
alternative to carry every command the small control offered. The Channel view
does, because it _is_ the rack.

Tiers, derived from the token heights rather than chosen, so they move when the
tokens do. The mixer container computes at 12.5 px, which is what turns each
budget into the `em` a `@container` query needs:

| tier     | budget | em    | rows                                                |
| -------- | ------ | ----- | --------------------------------------------------- |
| full     | 430 px | 34.4  | all nine                                            |
| standard | 300 px | 24    | name, chain, sends, pan, fader, M/S, readout, route |
| compact  | 212 px | 16.96 | name, chain, fader, M/S, route                      |
| minimal  | below  | —     | name, fader, M/S + the chain control                |

Minimal against tablet-landscape: 22 (name) + 44 (fader floor) + 44 (buttons) +
13 (padding) = **123 px** into 131. Compact: 22 + 44 + 44 + 44 + 44 + 13 = 211.
Standard: 22 + 44 + 44 + 26 + 44 + 44 + 18 + 44 + 13 = 299.

## 7. What ships first, and what waits for judgement

Item 12 and the strip's tiers are the same redesign but not the same risk. The
Channel view is a new surface: if it is wrong it is wrong on its own. Re-tiering
the console changes every strip on every form factor, against a design nobody
has looked at yet.

So **phase A is the Channel view, complete — items 12, 13 and 14 — and the
console is not touched.** Nothing regresses, the two `landscape.spec.ts`
`test.fail` cases stay red-by-design because the strip they describe has not
changed, and there is a real surface to judge.

**Phase B is the console strip's tiers**, and it is what deletes those two cases
by name. It is deliberately not in phase A: it is the half that cannot be undone
channel by channel.

## 8. What the build corrected

Four things this document had wrong, kept beside their replacements rather than
quietly edited, because a design that only ever records what worked is a design
nobody can learn the shape of a mistake from.

**The card was two rows and had to become one.** Section 4 gave a card a head
row of power and options and a name row under it. On a coarse pointer that is
44 + 44, and the rail came to 103 px inside a channel that has 131 — the console
strip's own arithmetic, faithfully reproduced on the new axis. Across, the card
is 44 tall like every other control here and the whole view fits with room. The
card is wider for it, and width is the thing a horizontal surface has.

**The controls were sized to fit the card; the card has to be sized to fit the
controls.** They were `--chn-ctl-h - 4px` so two would fit the card's declared
width, which measured 41 x 41 against a 44 requirement — with a comment two lines
above saying a card narrower than its own contents is the strip's defect in a new
orientation. Measured by `reachableBox`, not read off the stylesheet, which is
the only reason it was caught.

**The rail scrolls in both axes, not one.** Section 4 said `overflow-x`. The
default state fits every form factor with nothing outside the view, and opening
a card's quick controls grows the row past it — a deliberate act that asks for
the room. One scroller with two axes is not what the "no nested scrollers" rule
warns about; that is two scrollers competing for one drag.

**A window must not cover the control that opened it**, and nothing in this
document anticipated that. On a phone the first tap opened the device window on
top of the card, so the second tap landed on the EQ curve inside the window and
"tap again to close" was unreachable by any gesture — `elementFromPoint` at the
card's centre returned `svg.fx-curve`. Nothing was too small and nothing was off
screen; the control was behind something. `placeClearOf` opens below the opener,
then above it, and falls back when neither fits — and there is a band where
neither does: a 420 px window in an 844 px phone needs 428 clear pixels on one
side of a 44 px control, and a control in the middle leaves 410 on both.

## 9. What would falsify this

- If the Channel view cannot hold input, MIDI FX, instrument, EQ, dynamics, the
  rest of the chain, sends and output inside 131 px on tablet-landscape, the
  horizontal argument is wrong and section 3's budget is where it broke.
- If the rail's collapsed cards at 84 px cannot carry a 44 pt power control and a
  44 pt name, the card is the strip's problem again in a new orientation.
- If revert-on-second-tap reads as a glitch rather than as a correction, section
  4 put the cost in the wrong place and the deferral is the answer after all.

Each of these is a measurement, and each has a spec.
