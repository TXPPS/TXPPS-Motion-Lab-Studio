import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { NO_LATENCY, declareLatency } from '../mix/latency';
import { WetDryMixer } from '../mix/wet_dry';

/**
 * The compile-time half of the wet/dry contract.
 *
 * Every `@ts-expect-error` below is an assertion that the expression under it
 * does not type-check. If a future edit adds a convenience constructor, a
 * default latency, or an overload that takes a plain number, the error these
 * lines expect disappears, TypeScript reports the unused suppression, and
 * `npm run typecheck` fails. That is the mechanism: the guarantee is enforced
 * by the compiler on every build rather than by a reviewer noticing.
 */
describe('an uncompensated blend cannot be constructed', () => {
  // Each suppressed expression is kept on its own short line and assigned to a
  // name. A directive only covers the line beneath it, and Prettier will wrap a
  // long call across several — which silently moves the error out from under
  // the directive and turns a proof into an unused suppression.
  it('has no public constructor', () => {
    // @ts-expect-error the constructor is private so that forWetPath is the only door
    const built = () => new WetDryMixer(NO_LATENCY, 'linear', 1);
    expect(built).toBeTypeOf('function');
  });

  it('cannot be built without saying what the wet path costs', () => {
    // @ts-expect-error the latency argument is required and has no default
    const built = () => WetDryMixer.forWetPath();
    expect(built).toBeTypeOf('function');
  });

  it('will not accept a bare number where a declaration is required', () => {
    // @ts-expect-error 192 is a number, not something anybody has measured
    const built = () => WetDryMixer.forWetPath(192);
    expect(built).toBeTypeOf('function');
  });

  it('will not accept an object that merely looks like a declaration', () => {
    const shaped = { frames: 192, source: 'measured' as const, note: 'guessed' };
    // @ts-expect-error the brand cannot be minted outside declareLatency
    const built = () => WetDryMixer.forWetPath(shaped);
    expect(built).toBeTypeOf('function');
  });

  it('will not read an undeclared latency off a processor either', () => {
    // @ts-expect-error declaredLatency must be a declaration, not a sample count
    const built = () => WetDryMixer.forProcessor({ declaredLatency: 192 });
    expect(built).toBeTypeOf('function');
  });

  it('accepts a real declaration, so the errors above are about the guard and not the call', () => {
    const mixer = WetDryMixer.forWetPath(declareLatency(192, 'measured', 'oversampled shaper'));
    expect(mixer.compensationFrames).toBe(192);
  });
});

describe('there is exactly one door into a DeclaredLatency', () => {
  it('casts to the branded type in one place, and that place validates', () => {
    // A second `as DeclaredLatency` anywhere would be a second way to produce
    // one, and the compile-time guarantee above would only be as strong as the
    // weakest of them. The brand is worth nothing if it can be minted twice.
    const directory = fileURLToPath(new URL('../mix/', import.meta.url));
    const casts: string[] = [];
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.ts')) continue;
      const source = readFileSync(`${directory}${name}`, 'utf8');
      const found = source.match(/as\s+DeclaredLatency/g) ?? [];
      for (let occurrence = 0; occurrence < found.length; occurrence++) casts.push(name);
    }
    expect(casts).toEqual(['latency.ts']);
  });
});
