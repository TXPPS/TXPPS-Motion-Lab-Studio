/**
 * The Optical Leveller's face, judged by the harness.
 *
 * The same five UI cells the Motion Shaper's face is judged by, run against the
 * second unit — which is the first time the framework is asked to hold two
 * faces to one standard rather than one face to a standard built around it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HostCapabilities } from '../harness/capability';
import { verifyUnit } from '../harness/verify';
import { opticalLevellerUnit } from '../units/optical_leveller/unit';
import { opticalLevellerControls } from '../units/optical_leveller/params.gen';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/**
 * The names no face may contain, from `docs/reference/`.
 *
 * Read from the file rather than listed here, because `LEGAL_NOTES.md` forbids
 * a trademarked reference name appearing anywhere under `motionwave/` —
 * including inside the guard that looks for one. That rule was written after I
 * hard-coded five of them into a test in this directory.
 */
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
  return new Map(verifyUnit(opticalLevellerUnit, options).map((r) => [r.cell, r]));
}

describe('the Optical Leveller face, judged by the harness', () => {
  it('passes U19 — original artwork with declared provenance and no reference name', () => {
    const result = resultsFor().get('U19')!;
    console.log(`dyn-02 U19 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('passes U20 — every element bound to real engine state', () => {
    const result = resultsFor().get('U20')!;
    console.log(`dyn-02 U20 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('passes U23 — themes complete, pairs legible, controls named', () => {
    const result = resultsFor().get('U23')!;
    console.log(`dyn-02 U23 ${result.status}: ${result.detail}`);
    expect(result.status).toBe('PASS');
  });

  it('blocks U21 and U22 here, and names what would unblock them', () => {
    // Judged for real in `motionwave/ui/e2e/panel.spec.ts`, where Chromium
    // supplies a display clock, an audio thread and a layout engine. Blocked
    // here because jsdom answers zero for every box, and a cell that reported
    // PASS from that would be reporting a layout nobody laid out.
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
    // The half of D1 that is unconstructible, seen from the face's side: the
    // control list is the manifest's, so this cannot fail by drift — only by
    // somebody adding a control here by hand, which is what it is here to stop.
    const drawn = opticalLevellerUnit.face!.elements.filter((e) => e.paramId !== null);
    expect(drawn.length).toBe(opticalLevellerControls.length);
    expect(new Set(drawn.map((e) => e.paramId)).size).toBe(opticalLevellerUnit.specs.length);
  });
});
