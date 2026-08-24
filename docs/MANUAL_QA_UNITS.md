# Manual QA — the Motion Wave units in the app

## The live app

**https://txpps-motionlab-studio.roan-crest.workers.dev**

Deployed commit: `a98dd5e`. Open it in Safari or Chrome on the phone — nothing to
install, no terminal, no build step.

### Inserting a Motion Wave unit on a phone, tap by tap

1. Open the URL. Wait for the arrangement to appear.
2. **Tap once anywhere** before expecting sound. Browsers will not start audio
   until you have touched the page, so a first tap that seems to do nothing is
   the browser's rule and not a fault.
3. You need audio on a track to hear anything through an insert. Either:
   - tap **Browse** in the bottom bar, pick a loop, and drag it onto a track; or
   - tap **Record**, arm a track, and record a few seconds of anything.
4. Tap **Mix** in the bottom bar. This is the console — one strip per track.
5. Find the track's strip and its **inserts** area — the column of slots under
   the fader.
6. Tap the **"Add insert…"** control on that strip. A grouped menu opens:
   Dynamics, Tone, Modulation, Time, Stereo, Utility, and — at the bottom —
   **Motion Wave**.
7. Under **Motion Wave**, choose **Motion Shaper**. The slot fills with its name.
8. Play the track. The Motion Shaper starts as a **wire** — it should sound
   exactly like the track without it. That is deliberate: an undrawn shaper does
   nothing until you give it a shape.
9. **Tap the slot** to open the editor.
10. Move **Depth** up, and **Mix** to 100%. With the default flat shape you will
    still hear no change — the shape is what depth modulates, and a flat shape
    has nothing to modulate. Move **Rate** and the **crossovers** to hear the
    unit responding.
11. To close the editor: tap the **×** at its top right, or **swipe the header
    downward**. Both work with a thumb.

If you hear nothing at all at step 8 — not even the dry track — that is a fault
worth reporting; see the bottom of this document for what to include.

### What is not there yet

The units currently open the app's **generic control body** — a grid of labelled
knobs — rather than their own designed panels. Their meters and visualisers are
therefore not moving yet. The controls are real and reach the DSP; the artwork
and the live displays are the next piece of work.

---

A checklist to follow in the running application. Not a description of tests: if
you are reading a number rather than hearing something, you are on the wrong
document — the offline measurements live in `docs/UNIT_LEDGER.md`.

Ledger cell 25 asks whether a unit works _in the app_. Some of it is automated
(`e2e/motionwave.spec.ts`, which renders through the host's own insert chain and
asserts the audio changed); the rest is here, because it needs ears, fingers and
a screen.

---

## Running it

**Locally**, from a clone:

```bash
npm ci
npm run build      # builds the WASM core and asserts it reached the bundle
npm run preview    # serves the built app on http://localhost:4173
```

`npm run dev` also works and is faster to iterate on, but **run `npm run build`
at least once first**: the dev server serves the core from `public/worklets/`,
and that copy is produced by the build. Without it the units load but pass audio
through unprocessed, and the app says so in the diagnostics log rather than
failing visibly.

Building the core needs Emscripten, pinned to 4.0.7 — see `CLAUDE.md` under
"Build prerequisites". Without it `npm run build` stops with a message naming
what is missing.

**Deployed**: the Cloudflare Worker `txpps-motionlab-studio`. The deployed commit
is recorded in the release notes for each deploy; check it matches what you mean
to be testing before reporting anything.

**What to feed it.** Import a drum loop and a sustained pad into a session, on
separate tracks. Most of these checks need a transient source and a sustained
one, and switching between them is faster than re-importing.

---

## Every unit

Run this list per unit. Where a check needs a specific control, it is named in
that unit's own section below.

- [ ] **Appears in the insert picker**, under **Motion Wave**, with its name and
      a one-line description. It should be visibly a different group from the
      twenty-seven Web Audio devices — they are a different engine and the
      picker should not suggest they are alternatives of the same kind.
- [ ] **Inserts on an audio track** without an error, and the slot shows the
      unit's name.
- [ ] **Audibly processes audio.** Play the drum loop through it. Compare
      against the same track with the insert removed, not against silence.
- [ ] **Bypass toggles cleanly.** Toggle it repeatedly during playback: no click,
      no gap, no level jump at the moment of switching. A bypassed unit is still
      in circuit — its meters must keep moving.
- [ ] **Editor opens on desktop, tablet and phone.** On phone and tablet, check
      it can be dismissed **by touch** — the close control and the swipe-down on
      the header. A window you cannot dismiss with a thumb is a defect, and one
      this project has shipped before.
- [ ] **Every control audibly changes the sound.** The per-unit sections name
      what to listen for. A control that moves the readout and not the sound is
      the defect this check exists for.
- [ ] **Meters and visualisers move with the audio, and stop when it stops.** Not
      "go to zero and stay there" — stop. A meter that keeps moving after the
      transport stops is being driven by a timer rather than by the audio.
- [ ] **Presets save and recall.** Save one, change several controls, recall it,
      and confirm the sound returns to what was saved.
- [ ] **Automation writes and plays back.** Write a lane on one control, play it
      back, and hear the control move. Check the readout follows.
- [ ] **Project saves, reloads, and sounds identical.** Save, reload the page,
      reopen the project, play the same bars. Anything different here is a
      persistence bug and worth reporting with the project file.
- [ ] **Latency is compensated.** Put the unit on one track of a two-track
      session playing the same loop, and listen for flamming or phase
      cancellation against the untreated track. Several of these units declare
      46 to 49 samples; if that is not compensated you will hear it as comb
      filtering, not as a delay.

---

## Motion Shaper

The rhythmic modulator. Its subject is the **drawn shape**, so most of this is
about whether what you drew is what you hear.

- [ ] With no shape drawn, the unit is a **wire** — it should sound exactly like
      the bypassed track. (It did not always: an undrawn Motion Shaper used to
      render silence, which is why this is the first line.)
- [ ] Draw a shape that falls to zero halfway through its cycle. On the drum
      loop you should hear the level gate in time with the transport.
- [ ] **The drawn shape audibly matches the modulation.** Move a breakpoint later
      and the gate should move later by the same amount. Steepen a segment and
      the gate should get sharper. This is the check that matters most on this
      unit: a shape that draws one thing and plays another is the failure the
      whole "a picture is drawn from the same evaluation the audio uses" rule
      exists to prevent.
- [ ] **Depth** at zero should be inaudible whatever the shape; at full it should
      be the deepest the shape asks for.
- [ ] **Rate** and the sync division should lock to the transport — drop the
      tempo and the modulation should follow, staying in time with the drums.
- [ ] **The three bands modulate independently.** Set only the low band's depth
      and listen on the pad: the top should stay steady while the bottom pumps.
- [ ] **Smooth** should audibly round the edges of a square shape without moving
      where the gate happens.

## Program EQ

- [ ] The **low boost and low cut interact** — this is deliberate and is what the
      unit is. Boost and cut the same low frequency together and listen for the
      dip above the boost rather than for cancellation.
- [ ] The **high shelf** should open the top without the brittleness of a digital
      shelf.
- [ ] Frequency selectors should audibly land where they say.

## Optical Leveller

- [ ] **Two-stage release**: on a sustained pad, a short burst of gain reduction
      should recover quickly at first and then slowly. Listen for the tail of
      the recovery, not the onset.
- [ ] Gain reduction should be **programme dependent** — the same peak level on
      drums and on pad should not behave identically.

## FET Limiter

- [ ] **Fast enough to catch a snare** without audible overshoot.
- [ ] **All-buttons mode** should sound distinctly different — more aggressive,
      with an obvious pumping character. If it sounds like a small change,
      something is wrong.
- [ ] The attack and release dials are **numbered positions**, not milliseconds.
      Each should audibly differ from its neighbours.

## Variable-Mu Limiter

- [ ] Gain reduction should be **gentle and slow** compared with the FET — that
      contrast is the reason both exist.
- [ ] The **lateral/vertical** matrix should change how a wide mix is handled
      versus a centred one. Test on something with real stereo content.

## Console EQ

- [ ] The **two lineages sound different**, and switching between them changes
      what the controls mean. Check the panel relabels and the sound changes
      together.
- [ ] On the bridged-T lineage, **bandwidth follows the amount** — a small boost
      should be broad and a large one narrow. There is no Q control on purpose.

## Granular Reverb

- [ ] **Decay** should land near what it says — a 4 s setting should take about
      four seconds to fall away on a drum hit.
- [ ] **Density** should change the texture without changing the decay time.
      That independence is the point; listen for the tail getting smoother
      rather than longer.
- [ ] **Freeze** should hold the buffer indefinitely, with no drift in level or
      tone over a minute or more.
- [ ] **Shimmer** pitch sets should be audible and stable — no runaway, no rising
      whistle, however long you leave it.
- [ ] **Listen for flutter on transients.** This is the one the offline
      measurement cannot settle: `docs/HARDWARE_VERIFICATION.md` carries the full
      procedure and it should be run here. A dry snare, the first 200 ms of the
      tail, at three densities.

---

## Reporting

Say what you heard, on what source, at what settings, on what device and
browser. "The FET limiter pumps on the drum loop at ratio 20 on iPhone Safari"
is actionable; "the limiter sounds wrong" is not.

If a unit does not appear, or appears and makes no sound, check the diagnostics
log first (it says explicitly when the core failed to load) and include that
line in the report — it separates a broken build from a broken unit.
