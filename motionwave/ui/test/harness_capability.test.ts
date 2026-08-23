import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  HostCapabilities,
  UNBLOCKED_BY,
  probeHost,
  registerCoreModule,
  unregisterCoreModule,
} from '../harness/capability';
import { CELLS, CELL_IDS } from '../harness/cells';
import { makeReferenceEffect } from '../harness/reference_effect';
import { verifyUnit } from '../harness/verify';
import type { UnitUnderTest } from '../harness/types';

const TOKENS = readFileSync(
  fileURLToPath(new URL('../design/tokens.css', import.meta.url)),
  'utf8',
);

afterEach(() => {
  unregisterCoreModule();
});

describe('capabilities are probed, not assumed', () => {
  it('finds none of the device capabilities on this host, which is ADR-0005 in one line', () => {
    const host = probeHost({});
    for (const capability of [
      'wasmCore',
      'audioContext',
      'displayRefresh',
      'layoutEngine',
    ] as const) {
      expect(host.has(capability), capability).toBe(false);
    }
  });

  it('does not call a runtime that could load a core module a host that has one', () => {
    // `typeof WebAssembly !== 'undefined'` says the runtime could load a
    // module, not that one exists. Reporting D1–D12 runnable on that basis is
    // exactly the false green ADR-0005 forbids.
    expect(probeHost({ WebAssembly: {} }).has('wasmCore')).toBe(false);
    registerCoreModule();
    expect(probeHost({ WebAssembly: {} }).has('wasmCore')).toBe(true);
  });

  it('rejects a layout engine that answers zero for every box', () => {
    // jsdom implements getBoundingClientRect and computes nothing, so a harness
    // that trusted the method's existence would report every responsive check
    // as passing against boxes that are all the same size.
    const zeroLayout = fakeDocument(0);
    expect(probeHost(zeroLayout).has('layoutEngine')).toBe(false);
    const realLayout = fakeDocument(100);
    expect(probeHost(realLayout).has('layoutEngine')).toBe(true);
  });

  it('survives a document that throws when measured', () => {
    const hostile = {
      document: {
        createElement: () => {
          throw new Error('no');
        },
        body: { appendChild: () => undefined },
      },
    };
    expect(probeHost(hostile as never).has('layoutEngine')).toBe(false);
  });

  it('names what would supply every capability it can be missing', () => {
    const host = new HostCapabilities([]);
    for (const capability of Object.keys(UNBLOCKED_BY) as (keyof typeof UNBLOCKED_BY)[]) {
      expect(host.reasonFor(capability)).toContain(UNBLOCKED_BY[capability]);
      expect(UNBLOCKED_BY[capability].length).toBeGreaterThan(10);
    }
  });
});

describe('a cell that cannot run says which capability is missing', () => {
  const results = verifyUnit(makeReferenceEffect(), {
    host: new HostCapabilities([]),
    tokensCss: TOKENS,
  });

  it('blocks the two cells this host genuinely cannot run, and only those', () => {
    const blocked = results.filter((result) => result.status === 'BLOCKED').map((r) => r.cell);
    expect(blocked).toEqual(['U21', 'U22']);
  });

  it('names the missing capability rather than saying BLOCKED and stopping', () => {
    for (const result of results) {
      if (result.status !== 'BLOCKED') continue;
      const named = CELLS.find((cell) => cell.id === result.cell)?.requires ?? [];
      expect(named.length).toBeGreaterThan(0);
      expect(result.detail).toMatch(/^no \w+ — needs .+/);
    }
  });

  it('runs those two cells the moment a host can, rather than staying blocked forever', () => {
    const capable = new HostCapabilities(['displayRefresh', 'realtimeThread', 'layoutEngine']);
    const onCapableHost = verifyUnit(makeReferenceEffect(), { host: capable, tokensCss: TOKENS });
    expect(onCapableHost.find((result) => result.cell === 'U21')?.status).toBe('PASS');
    expect(onCapableHost.find((result) => result.cell === 'U22')?.status).toBe('PASS');
  });
});

describe('a unit whose DSP cannot be built here is blocked, not failed', () => {
  const withoutRenderer: UnitUnderTest = (() => {
    // What a real Motion Wave unit looks like on this host: its DSP is C++
    // compiled to WebAssembly, and Emscripten is not installed here, so there
    // is no renderer to hand over (ADR-0001's environment table, ADR-0005).
    const unit: UnitUnderTest = { ...makeReferenceEffect(), rendererBlockedBy: 'wasmCore' };
    delete (unit as { renderer?: UnitUnderTest['renderer'] }).renderer;
    return unit;
  })();
  const results = verifyUnit(withoutRenderer, {
    host: new HostCapabilities([]),
    tokensCss: TOKENS,
  });

  it('still answers all twenty-three cells', () => {
    expect(results.map((result) => result.cell)).toEqual([...CELL_IDS]);
  });

  it('blocks every cell that needs the DSP, naming Emscripten as what is missing', () => {
    for (const cell of ['D1', 'D3', 'D4', 'D6', 'D7', 'D8', 'D9', 'D10']) {
      const result = results.find((entry) => entry.cell === cell);
      expect(result?.status, cell).toBe('BLOCKED');
      expect(result?.detail, cell).toContain('Emscripten');
    }
  });

  it('still runs the cells that do not need it, rather than blocking the whole unit', () => {
    for (const cell of ['D2', 'D11', 'U19', 'U20', 'U23']) {
      expect(results.find((entry) => entry.cell === cell)?.status, cell).toBe('PASS');
    }
  });

  it('reports nothing as PASS that did not actually run', () => {
    const passed = results
      .filter((result) => result.status === 'PASS')
      .map((result) => result.cell);
    expect(passed).toEqual(['D2', 'D11', 'U19', 'U20', 'U23']);
  });
});

describe('a missing declaration is the unit’s gap, not the host’s', () => {
  const host = new HostCapabilities([]);

  it('fails rather than blocks when the unit simply has no face', () => {
    const unit: UnitUnderTest = { ...makeReferenceEffect() };
    delete (unit as { face?: UnitUnderTest['face'] }).face;
    const results = verifyUnit(unit, { host, tokensCss: TOKENS });
    for (const cell of ['U19', 'U20', 'U23']) {
      const result = results.find((entry) => entry.cell === cell);
      expect(result?.status, cell).toBe('FAIL');
      expect(result?.detail).toContain('no face');
    }
  });

  it('fails rather than blocks when the unit has no sheet claims to check', () => {
    const unit = makeReferenceEffect();
    const results = verifyUnit({ ...unit, sheetTargets: [] }, { host, tokensCss: TOKENS });
    expect(results.find((entry) => entry.cell === 'D3')?.status).toBe('FAIL');
  });

  it('marks n/a, not PASS, for the two features a unit may legitimately not have', () => {
    const unit = makeReferenceEffect();
    const results = verifyUnit({ ...unit, tempoSyncedParams: [] }, { host, tokensCss: TOKENS });
    expect(results.find((entry) => entry.cell === 'D5')?.status).toBe('n/a');
    expect(results.find((entry) => entry.cell === 'D12')?.status).toBe('n/a');
  });

  it('fails an instrument that declares no voice control', () => {
    const unit = makeReferenceEffect();
    const results = verifyUnit({ ...unit, kind: 'instrument' }, { host, tokensCss: TOKENS });
    for (const cell of ['I13', 'I14', 'I15']) {
      const result = results.find((entry) => entry.cell === cell);
      expect(result?.status, cell).toBe('FAIL');
      expect(result?.detail).toContain('no voice control');
    }
  });
});

/** A document whose one measurable box reports the width it is given. */
function fakeDocument(width: number) {
  return {
    document: {
      createElement: () => ({
        style: {} as Record<string, string>,
        getBoundingClientRect: () => ({ width }),
        remove: () => undefined,
      }),
      body: { appendChild: () => undefined },
    },
  };
}
