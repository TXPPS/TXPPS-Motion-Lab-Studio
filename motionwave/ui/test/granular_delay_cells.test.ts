/**
 * The Granular Delay's face, judged by the harness.
 *
 * The same five UI cells every other face is judged by, and one thing no face
 * before it has had: groups. A hundred and thirty-nine controls sit behind a
 * tab strip, and a control that fell out of its tab — because the manifest
 * renamed it, or a tap gained a control the group list did not — would land on
 * the fascia among the eight that belong there. So the groups are checked
 * against the elements both ways.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HostCapabilities } from '../harness/capability';
import { verifyUnit } from '../harness/verify';
import { granularDelayGroups } from '../units/granular_delay/face';
import { granularDelayUnit } from '../units/granular_delay/unit';
import { granularDelayControls } from '../units/granular_delay/params.gen';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

const forbiddenNames = readFileSync(
  join(repoRoot, 'docs', 'reference', 'forbidden-names.txt'),
  'utf8',
)
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

const tokensCss = readFileSync(join(repoRoot, 'motionwave', 'ui', 'design', 'tokens.css'), 'utf8');

function resultsFor(host?: HostCapabilities) {
  const options = {
    tokensCss,
    forbiddenNames,
    ...(host === undefined ? {} : { host }),
  };
  return new Map(verifyUnit(granularDelayUnit, options).map((r) => [r.cell, r]));
}

describe('the Granular Delay face, judged by the harness', () => {
  it('passes U19 — original artwork with declared provenance and no reference name', () => {
    const result = resultsFor().get('U19')!;
    console.log(`fx-03 U19 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('passes U20 — every element bound to real engine state', () => {
    const result = resultsFor().get('U20')!;
    console.log(`fx-03 U20 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('passes U23 — themes complete, pairs legible, controls named', () => {
    const result = resultsFor().get('U23')!;
    console.log(`fx-03 U23 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('blocks U21 and U22 here, and names what would unblock them', () => {
    for (const cell of ['U21', 'U22'] as const) {
      const result = resultsFor().get(cell)!;
      expect(result.status).toBe('BLOCKED');
      expect(result.detail.length).toBeGreaterThan(10);
    }
  });

  it('passes U21 and U22 the moment a capable host appears', () => {
    const capable = new HostCapabilities(['displayRefresh', 'realtimeThread', 'layoutEngine']);
    const results = resultsFor(capable);
    for (const cell of ['U21', 'U22'] as const) {
      expect(results.get(cell)!.status, cell).toBe('PASS');
    }
  });

  it('draws every parameter the manifest declares, and invents none', () => {
    const drawn = granularDelayUnit.face!.elements.filter((e) => e.paramId !== null);
    expect(drawn.length).toBe(granularDelayControls.length);
    expect(new Set(drawn.map((e) => e.paramId)).size).toBe(granularDelayUnit.specs.length);
  });

  it('every grouped id is a control on the face, and no control is in two tabs', () => {
    const controls = new Set(
      granularDelayUnit.face!.elements.filter((e) => e.paramId !== null).map((e) => e.id),
    );
    const seen = new Map<string, string>();
    for (const group of granularDelayGroups) {
      for (const id of group.elementIds) {
        expect(controls.has(id), `${group.id} names "${id}", which is not a control`).toBe(true);
        expect(seen.get(id), `"${id}" is in both ${seen.get(id)} and ${group.id}`).toBeUndefined();
        seen.set(id, group.id);
      }
    }
    // Every tap has a tab, and each tab holds that tap's controls and no other's.
    for (let n = 1; n <= 8; n++) {
      const tab = granularDelayGroups.find((g) => g.id === `tap-${n}`)!;
      const own = [...controls].filter((id) => id.startsWith(`tap${n}-`));
      expect([...tab.elementIds].sort()).toEqual(own.sort());
    }
    // And what is left on the fascia is the defining set — small enough to be
    // a fascia, and carrying the controls a delay is operated by.
    const fascia = [...controls].filter((id) => !seen.has(id)).sort();
    expect(fascia).toEqual(
      [
        'bypass',
        'character',
        'feedback',
        'mix',
        'smear',
        'sync',
        'tap-count',
        'time-change',
      ].sort(),
    );
  });
});
