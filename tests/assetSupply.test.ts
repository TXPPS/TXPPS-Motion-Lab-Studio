/**
 * A surface that needs an asset has a control that supplies one.
 *
 * The defect, twice over and shipped:
 *
 *   - the sampler's only route to a user's own audio was an HTML5 drag from
 *     Browser → Samples. Drag-and-drop is a mouse protocol; a finger never
 *     produces `dragstart`, so on a phone and a tablet there was no route at
 *     all, and the three buttons that said "load" all loaded a fixed
 *     procedural sample.
 *   - `rackAddItem(_, 'sampler')` created an instrument-rack layer with
 *     `zones: []`. The engine played `item.sampler` and `exportMix` rendered
 *     it, and no control in the product could ever write to it — so "+ Sampler
 *     layer" added a layer that was permanently silent.
 *
 * One cause: the slot and the thing that fills it were written in different
 * places, and nothing asked whether the second existed. So two rules, both
 * mechanical, each of which fails on one of the two above:
 *
 *   1. A component that **creates** an asset slot draws a control that can
 *      **fill** it.
 *   2. A component that accepts an asset by **drag** also offers a route that
 *      does not need one, because drag is not available to every hand.
 *
 * Files that legitimately do neither are registered with a reason. Discovery
 * runs against the tree rather than against this list, so a new surface fails
 * the build until it is classified — the alternative is a list that records
 * state and goes stale, which is the failure one directory up.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const COMPONENTS = join(ROOT, 'src/components');

/** Store actions that bring an asset slot into existence with nothing in it. */
const CREATES_A_SLOT = [
  /rackAddItem\([^)]*'sampler'/,
  /setInstrument\([^)]*'(quick|drum|multi)'/,
  /addSamplerZones\(/,
];

/**
 * A control that fills a sample slot: the button, the menu it opens, or a
 * direct call into the import pipeline. Anything a hand can reach without a
 * drag.
 */
const SUPPLIES_A_SAMPLE = [
  /SampleSourceButton/,
  /openSampleSourceMenu/,
  /pickSamplesInto|placeSamples|pickAndImport/,
];

/**
 * Accepting an asset by drag — a mouse-only protocol.
 *
 * The drop side, not merely the media type: the *source* side of a drag
 * carries the same string and needs no supply route of its own, because it is
 * the supply. Matching the type alone flagged Browser → Samples, which is
 * where samples come from.
 */
const ACCEPTS_A_DRAG = /onDrop=\{/;

/**
 * Files that touch media and need no supply control, each with the reason.
 *
 * The reason is never inspected. Having to write one is the mechanism: it is
 * the difference between deciding a surface does not need a route and not
 * having thought about it.
 */
const NO_SUPPLY_NEEDED: Record<string, string> = {
  'browser/InstrumentsTab.tsx#InstrumentsTab':
    'adds the track and selects it, which opens the sampler panel — the empty slot is made here and filled on the surface this reveals',
  'sampler/SamplerPanel.tsx#InstrumentKindSelect':
    'switches the instrument on a panel that draws four load controls under it',
  'arrangement/Arrangement.tsx#Arrangement':
    'drops audio files onto a track; the pointer-independent route is Browser → Pool → Import audio, which is the same pipeline',
  'mixer/DeviceRack.tsx#DeviceSlot': 'the drop reorders devices — it carries no asset',
  'mixer/DeviceRack.tsx#DeviceRack': 'the drop reorders devices — it carries no asset',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Where one component stops and the next begins.
 *
 * Per file was the first version of this and it was too coarse to be worth
 * running: `SamplerPanel.tsx` holds five surfaces in 1700 lines, so once *any*
 * of them drew a supply control the whole file counted as supplied. Deleting
 * the rack layer's — the exact defect this was written for — left the guard
 * green. Mutation-tested, DECAYED, rewritten.
 *
 * Top-level declarations only: a component nested inside another shares its
 * parent's region, which is right, because that is the scope a reader sees.
 *
 * The component is as fine as this goes, and that is a real limit rather than
 * an oversight. `QuickView` draws two states — empty and loaded — with a load
 * control in each; deleting one of them leaves this green, and the mutation
 * that proves it is recorded as DECAYED-by-design. A state within a component
 * is not visible to a regex, and pretending otherwise would make the guard
 * report a confidence it does not have. `e2e/samplerload.spec.ts` is the half
 * that renders the states and reaches for the control in each of them.
 */
const BOUNDARY = /^(?:export )?(?:function|const) ([A-Z]\w*)/gm;

interface Surface {
  key: string;
  creates: boolean;
  drags: boolean;
  supplies: boolean;
}

function regionsOf(src: string, file: string): Surface[] {
  const marks: { name: string; at: number }[] = [];
  for (const m of src.matchAll(BOUNDARY)) marks.push({ name: m[1], at: m.index });
  // A file with no top-level component (a helper module) is still one region,
  // so nothing falls out of the sweep by having an unusual shape.
  if (marks.length === 0) marks.push({ name: '(module)', at: 0 });
  return marks.map((mark, i) => {
    const body = src.slice(mark.at, marks[i + 1]?.at ?? src.length);
    return {
      key: `${file}#${mark.name}`,
      creates: CREATES_A_SLOT.some((re) => re.test(body)),
      drags: ACCEPTS_A_DRAG.test(body),
      supplies: SUPPLIES_A_SAMPLE.some((re) => re.test(body)),
    };
  });
}

const surfaces: Surface[] = walk(COMPONENTS).flatMap((full) =>
  regionsOf(readFileSync(full, 'utf8'), relative(COMPONENTS, full).split('\\').join('/')),
);

describe('every surface that needs an asset can be given one', () => {
  it('a component that creates a sample slot draws a control that fills it', () => {
    const offenders = surfaces
      .filter((s) => s.creates && !s.supplies && !(s.key in NO_SUPPLY_NEEDED))
      .map((s) => s.key);
    expect(
      offenders,
      `these draw a control that makes an empty sample slot and no control that fills it: ` +
        `${offenders.join(', ')}. That is "+ Sampler layer" — a button whose result cannot ` +
        `be made to sound. Add a SampleSourceButton, or register the surface in ` +
        `NO_SUPPLY_NEEDED with the reason it does not need one.`,
    ).toEqual([]);
  });

  it('a drop target is never the only way in', () => {
    const offenders = surfaces
      .filter((s) => s.drags && !s.supplies && !(s.key in NO_SUPPLY_NEEDED))
      .map((s) => s.key);
    expect(
      offenders,
      `these accept an asset by drag and offer no other route: ${offenders.join(', ')}. ` +
        `HTML5 drag-and-drop is a mouse protocol — a finger never produces dragstart — so ` +
        `on a phone or a tablet a drop-only surface has no route at all.`,
    ).toEqual([]);
  });

  it('the registry has no entry for a file that is gone', () => {
    const present = new Set(surfaces.map((s) => s.key));
    const stale = Object.keys(NO_SUPPLY_NEEDED).filter((k) => !present.has(k));
    // A registry that outlives its files is the stale-document failure in
    // miniature: it reads as "considered and cleared" and means nothing.
    expect(stale, `NO_SUPPLY_NEEDED names surfaces that do not exist: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('the sweep is not vacuous — it finds the surfaces it is meant to police', () => {
    // Without this, deleting `CREATES_A_SLOT`'s patterns would turn both rules
    // above green by finding nothing at all to check.
    expect(surfaces.filter((s) => s.creates).length).toBeGreaterThan(0);
    expect(surfaces.filter((s) => s.drags).length).toBeGreaterThan(0);
    expect(surfaces.filter((s) => s.supplies).length).toBeGreaterThan(0);
  });
});
