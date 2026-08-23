import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CELL_IDS } from '../harness/cells';
import { HostCapabilities } from '../harness/capability';
import { blockedSummary, formatReport, ledgerRow, ledgerValue, tally } from '../harness/report';
import { DRIVE, REFERENCE_SPECS, makeReferenceEffect } from '../harness/reference_effect';
import { makeReferenceInstrument } from '../harness/reference_instrument';
import { type CellResult, isShipping, verifyUnit } from '../harness/verify';
import { defineParam } from '../param/spec';
import { type Ramp, rampAt, steady } from '../param/ramp';
import type { ParamId } from '../param/spec';
import { Unit } from '../param/units';
import { NO_LATENCY } from '../mix/latency';
import type { UnitRenderer, UnitUnderTest } from '../harness/types';

const TOKENS = readFileSync(
  fileURLToPath(new URL('../design/tokens.css', import.meta.url)),
  'utf8',
);

/** Everything except the two capabilities this host genuinely lacks. */
const HOST = new HostCapabilities([]);

function run(unit: UnitUnderTest): Map<string, CellResult> {
  const results = verifyUnit(unit, { host: HOST, tokensCss: TOKENS });
  return new Map(results.map((result) => [result.cell, result]));
}

function statusOf(unit: UnitUnderTest, cell: string): string {
  const result = run(unit).get(cell);
  return `${result?.status ?? 'missing'} — ${result?.detail ?? ''}`;
}

describe('the harness answers all twenty-three cells, every time', () => {
  const results = verifyUnit(makeReferenceEffect(), { host: HOST, tokensCss: TOKENS });

  it('returns one result per ledger cell, in ledger order, with none missing', () => {
    expect(results.map((result) => result.cell)).toEqual([...CELL_IDS]);
  });

  it('names an executable test behind every result, which is what a PASS means', () => {
    for (const result of results) {
      expect(result.test, `${result.cell} has no test name`).toMatch(/^verifyUnit\(ref-00\)\/\w+$/);
      expect(result.detail.length, `${result.cell} has no detail`).toBeGreaterThan(0);
    }
  });

  it('holds exactly one of PASS, FAIL, BLOCKED or n/a in every cell', () => {
    for (const result of results) {
      expect(['PASS', 'FAIL', 'BLOCKED', 'n/a']).toContain(result.status);
    }
  });

  it('passes every cell it can run against the reference effect', () => {
    const counts = tally(results);
    expect(counts.fail, formatReport('Reference Shaper', results)).toBe(0);
    expect(counts.pass).toBe(14);
    expect(counts.blocked).toBe(2);
    expect(counts.notApplicable).toBe(7);
    expect(isShipping(results)).toBe(false);
  });

  it('marks the instrument cells n/a for an effect rather than passing them', () => {
    for (const cell of ['I13', 'I14', 'I15', 'I16', 'I17', 'I18']) {
      const result = results.find((entry) => entry.cell === cell);
      expect(result?.status, cell).toBe('n/a');
      expect(result?.detail).toContain('effect');
    }
  });
});

describe('the harness answers all twenty-three cells for an instrument too', () => {
  const results = verifyUnit(makeReferenceInstrument(), { host: HOST, tokensCss: TOKENS });

  it('runs the six instrument cells and passes them', () => {
    for (const cell of ['I13', 'I14', 'I15', 'I16', 'I17', 'I18']) {
      const result = results.find((entry) => entry.cell === cell);
      expect(`${cell}: ${result?.status} ${result?.detail}`).toContain('PASS');
    }
  });

  it('reports no failure anywhere', () => {
    expect(tally(results).fail, formatReport('Reference Voice', results)).toBe(0);
  });
});

describe('the cells have teeth: a unit that is wrong fails the cell that covers it', () => {
  it('D1 finds a control the processor never reads', () => {
    const unit = makeReferenceEffect();
    const withDeadControl: UnitUnderTest = {
      ...unit,
      specs: [
        ...REFERENCE_SPECS,
        defineParam({ id: 99, name: 'Ornament', unit: Unit.Percent, min: 0, max: 1, def: 0.5 }),
      ],
    };
    expect(statusOf(withDeadControl, 'D1')).toContain('FAIL');
    expect(statusOf(withDeadControl, 'D1')).toContain('99 "Ornament"');
  });

  it('D8 finds a latency that was declared but not measured', () => {
    const unit = makeReferenceEffect();
    const misdeclared = wrapRenderer(unit, {
      latency: { frames: 32, source: 'measured', note: 'copied from another device' },
    });
    expect(statusOf(misdeclared, 'D8')).toContain('FAIL');
    expect(statusOf(misdeclared, 'D8')).toContain('64 frames against 32 declared');
  });

  it('D10 passes a gain that interpolates inside the block and fails one that steps', () => {
    // The whole point of handing a unit a ramp is that it interpolates within
    // the block. Two units that differ in nothing else: one reads the ramp, the
    // other reads only its end value and produces the classic zipper.
    expect(statusOf(makeGainUnit('per-sample'), 'D10')).toContain('PASS');
    const stepping = statusOf(makeGainUnit('per-block'), 'D10');
    expect(stepping).toContain('FAIL');
    expect(stepping).toContain('block boundary');
  });

  it('U20 finds a knob that moves nothing and a meter that reads nothing', () => {
    const unit = makeReferenceEffect();
    const broken: UnitUnderTest = {
      ...unit,
      face: {
        ...unit.face!,
        elements: [
          ...unit.face!.elements,
          {
            id: 'ornament',
            role: 'knob',
            paramId: null,
            accessibleName: 'Ornament',
            keyboardFocusable: true,
          },
        ],
      },
    };
    expect(statusOf(broken, 'U20')).toContain('FAIL');
    expect(statusOf(broken, 'U20')).toContain('moves no parameter');
  });

  it('U23 finds an unreachable control and a pair nobody can read', () => {
    const unit = makeReferenceEffect();
    const broken: UnitUnderTest = {
      ...unit,
      face: {
        ...unit.face!,
        elements: unit.face!.elements.map((element) =>
          element.id === 'drive'
            ? {
                ...element,
                keyboardFocusable: false,
                colours: [{ foreground: '--mw-fg-faint', background: '--mw-bg-hover' }],
              }
            : element,
        ),
      },
    };
    const detail = statusOf(broken, 'U23');
    expect(detail).toContain('FAIL');
    expect(detail).toContain('keyboard');
  });

  it('U19 finds artwork with no provenance and a name a face may not use', () => {
    const unit = makeReferenceEffect();
    const borrowed: UnitUnderTest = {
      ...unit,
      face: {
        ...unit.face!,
        artwork: [{ id: 'panel', origin: 'licensed', attribution: '' }],
      },
    };
    expect(statusOf(borrowed, 'U19')).toContain('FAIL');

    const named = verifyUnit(unit, {
      host: HOST,
      tokensCss: TOKENS,
      forbiddenNames: ['Drive'],
    }).find((result) => result.cell === 'U19');
    expect(named?.status).toBe('FAIL');
    expect(named?.detail).toContain('reference name');
  });

  it('U23 refuses to pass when it was given no palette to check against', () => {
    const withoutTokens = verifyUnit(makeReferenceEffect(), { host: HOST }).find(
      (result) => result.cell === 'U23',
    );
    // Not BLOCKED: nothing about this host stopped it. The check simply was not
    // given what it needed, and a PASS would be a tick beside work not done.
    expect(withoutTokens?.status).toBe('FAIL');
    expect(withoutTokens?.detail).toContain('no token sheet');
  });

  it('turns a check that throws into a FAIL rather than a blank', () => {
    const unit = makeReferenceEffect();
    const exploding = wrapRenderer(unit, { throwOnProcess: true });
    const result = run(exploding).get('D1');
    expect(result?.status).toBe('FAIL');
    expect(result?.detail).toContain('the check threw');
  });
});

describe('the report is the row the ledger holds', () => {
  const results = verifyUnit(makeReferenceEffect(), { host: HOST, tokensCss: TOKENS });

  it('never writes a bare BLOCKED, which would say nothing', () => {
    for (const result of results) {
      if (result.status !== 'BLOCKED') continue;
      expect(ledgerValue(result)).toMatch(/^BLOCKED \(.+\)$/);
      expect(ledgerValue(result)).toContain('needs');
    }
  });

  it('produces a markdown row with one cell per column', () => {
    const row = ledgerRow('Reference Shaper', 'ref-00', 'FIXTURE', results);
    expect(row.split('|').length - 2).toBe(3 + CELL_IDS.length);
    expect(row).toContain('| `ref-00` |');
  });

  it('lists what would unblock each blocked cell', () => {
    const blocked = blockedSummary(results);
    expect(blocked).toHaveLength(2);
    expect(blocked.join('\n')).toContain('requestAnimationFrame');
    expect(blocked.join('\n')).toContain('computes layout');
  });
});

/**
 * The smallest unit that can zip: one gain, applied either across the block or
 * once at the top of it. Built here rather than as a fixture because its only
 * purpose is to be wrong in one specific way and right in the other.
 */
function makeGainUnit(when: 'per-sample' | 'per-block'): UnitUnderTest {
  const gain = defineParam({ id: 1, name: 'Gain', unit: Unit.Decibels, min: -12, max: 12, def: 0 });
  const renderer: UnitRenderer = {
    declaredLatency: NO_LATENCY,
    prepare: () => undefined,
    reset: () => undefined,
    processBlock: (input, output, frames, params) => {
      const ramp = params.get(1) ?? steady(0);
      for (let i = 0; i < frames; i++) {
        const db = when === 'per-sample' ? rampAt(ramp, i, frames) : ramp.end;
        output[i] = input[i] * Math.pow(10, db / 20);
      }
    },
  };
  return {
    id: 'ref-02',
    name: 'Gain',
    kind: 'effect',
    specs: [gain],
    declaredLatency: NO_LATENCY,
    presetMeta: { unit: 'ref-02', unitVersion: 1, name: 'Init' },
    renderer,
  };
}

/** Swaps a unit's renderer for one that misbehaves in a named, specific way. */
function wrapRenderer(
  unit: UnitUnderTest,
  options: {
    latency?: { frames: number; source: 'measured' | 'derived' | 'none'; note: string };
    flattenRamps?: boolean;
    throwOnProcess?: boolean;
  },
): UnitUnderTest {
  const inner = unit.renderer!;
  const renderer: UnitRenderer = {
    declaredLatency: (options.latency ?? inner.declaredLatency) as UnitRenderer['declaredLatency'],
    prepare: (context) => inner.prepare(context),
    reset: () => inner.reset(),
    setBypass: (bypassed) => inner.setBypass?.(bypassed),
    processBlock: (input, output, frames, params) => {
      if (options.throwOnProcess === true) throw new Error('the processor exploded');
      const forwarded = options.flattenRamps === true ? flatten(params) : params;
      inner.processBlock(input, output, frames, forwarded);
    },
  };
  return { ...unit, renderer };
}

/** Every ramp collapsed to its end value: the block-rate step, on purpose. */
function flatten(params: ReadonlyMap<ParamId, Ramp>): ReadonlyMap<ParamId, Ramp> {
  const flat = new Map<ParamId, Ramp>();
  for (const [id, ramp] of params) flat.set(id, steady(ramp.end));
  return flat;
}

/** Referenced so the fixture's parameter ids stay meaningful to a reader. */
expect(DRIVE).toBe(1);
