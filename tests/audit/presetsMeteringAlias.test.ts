/**
 * PA probes 7, 8 and 9 — preset round-trip, gain-reduction metering, aliasing.
 *
 * Round-trip: a preset is applied, saved and reloaded through the real
 * validator, and compared key by key. `validateProject` runs the state through
 * `JSON.parse(JSON.stringify(…))` first, so this is also the export/import path.
 *
 * Metering: the gain-reduction figure a device publishes is read straight by the
 * face, sixty times a second, with no reference to bypass. Whether that figure
 * is still non-zero on a bypassed insert is a property of the builder, and can
 * be read off the builder.
 *
 * Aliasing: the harmonic distortion a shaper *curve* generates is pure maths and
 * is measured here at full drive, at 1× and against an ideal 4× reference. What
 * cannot be measured here is the browser's own `oversample: '4x'` filters, which
 * are the ones the five shapers actually run — see the report.
 */
import { describe, expect, it } from 'vitest';
import {
  EFFECT_PRESETS,
  CHAIN_PRESETS,
  chainSteps,
  presetParams,
} from '../../src/model/effectPresets';
import { EFFECT_SPECS, defaultParams, normaliseParams } from '../../src/model/effects';
import { buildEffectNode } from '../../src/audio/effectChain';
import { validateProject } from '../../src/persistence/projectRepo';
import { createDemoProject } from '../../src/model/demoProject';
import { saturationCurve, clipCurve, quantiserCurve, dbToGain } from '../../src/audio/dsp/curves';
import {
  fftInPlace,
  ifftInPlace,
  realFft,
  magnitudeSpectrum,
  makeWindow,
} from '../../src/model/fft';
import type { Effect, EffectKind, ProjectData } from '../../src/model/types';
import { createProbeContext } from './probeContext';

const BPM = 120;

function effectOf(kind: EffectKind, params: Record<string, number>): Effect {
  return { id: `fx-${kind}`, kind, bypass: false, params };
}

// ------------------------------------------------------------- preset round-trip

describe('PA · preset save / load round-trip', () => {
  it('reloads every factory effect preset byte for byte', () => {
    const base = createDemoProject('p-round');
    const track = base.tracks.find((t) => t.type === 'audio') ?? base.tracks[0];
    const mismatches: string[] = [];
    for (const preset of EFFECT_PRESETS) {
      const params = presetParams(preset);
      const project: ProjectData = {
        ...base,
        tracks: base.tracks.map((t) =>
          t.id === track.id
            ? { ...t, effects: [{ id: 'fx1', kind: preset.kind, bypass: false, params }] }
            : t,
        ),
      };
      const back = validateProject(JSON.parse(JSON.stringify(project)));
      const reloaded = back.tracks.find((t) => t.id === track.id)?.effects?.[0];
      if (!reloaded) {
        mismatches.push(`${preset.id}: the insert did not survive the load`);
        continue;
      }
      if (reloaded.kind !== preset.kind) mismatches.push(`${preset.id}: kind changed`);
      for (const [k, v] of Object.entries(params)) {
        if (!Object.is(reloaded.params[k], v)) {
          mismatches.push(`${preset.id}.${k}: ${v} → ${reloaded.params[k]}`);
        }
      }
      for (const k of Object.keys(reloaded.params)) {
        if (!(k in params)) mismatches.push(`${preset.id}.${k}: invented on load`);
      }
    }
    console.log(
      `${EFFECT_PRESETS.length} factory presets round-tripped, ${mismatches.length} mismatches`,
    );
    expect(mismatches).toEqual([]);
  });

  it('reloads every chain preset with its bypass flags intact', () => {
    const base = createDemoProject('p-chain');
    const track = base.tracks.find((t) => t.type === 'audio') ?? base.tracks[0];
    for (const chain of CHAIN_PRESETS) {
      const steps = chainSteps(chain);
      const effects = steps.map((s, i) => ({
        id: `fx${i}`,
        kind: s.kind,
        bypass: s.bypass,
        params: s.params,
      }));
      const project: ProjectData = {
        ...base,
        tracks: base.tracks.map((t) => (t.id === track.id ? { ...t, effects } : t)),
      };
      const back = validateProject(JSON.parse(JSON.stringify(project)));
      const reloaded = back.tracks.find((t) => t.id === track.id)?.effects ?? [];
      expect(
        reloaded.map((e) => e.kind),
        chain.id,
      ).toEqual(effects.map((e) => e.kind));
      expect(
        reloaded.map((e) => e.bypass),
        chain.id,
      ).toEqual(effects.map((e) => e.bypass));
      for (let i = 0; i < effects.length; i++) {
        expect(reloaded[i].params, `${chain.id} step ${i}`).toEqual(effects[i].params);
      }
    }
  });

  it("reloads a value that is not on a parameter's own step grid, unrounded", () => {
    // A knob dragged with a pointer, a macro, and every automation write land
    // between steps. Snapping on load would move a mix the user made.
    const params = { ...defaultParams('compressor'), threshold: -17.3719, ratio: 3.14159 };
    expect(normaliseParams('compressor', params).threshold).toBe(-17.3719);
    expect(normaliseParams('compressor', params).ratio).toBe(3.14159);
  });

  it('reloads a settled graph to the same settled graph', () => {
    // The stronger form of the round-trip: not "are the numbers equal" but
    // "does the audio graph the reloaded numbers build match", which is what a
    // recall actually has to promise.
    for (const spec of EFFECT_SPECS) {
      const params = normaliseParams(spec.kind, defaultParams(spec.kind));
      const reloaded = normaliseParams(
        spec.kind,
        JSON.parse(JSON.stringify(params)) as Record<string, number>,
      );
      const snap = (p: Record<string, number>): string => {
        const probe = createProbeContext();
        const e = effectOf(spec.kind, p);
        const node = buildEffectNode(probe.ctx, e);
        node.update(e, BPM, false);
        node.update(e, BPM, false);
        const s = probe.snapshot();
        node.dispose();
        return s;
      };
      expect(snap(reloaded), spec.kind).toBe(snap(params));
    }
  });
});

// ---------------------------------------------------------------- GR metering

describe('PA-008 · the gain-reduction readout on a bypassed insert', () => {
  it('reads zero on every VCA-based processor when bypassed', () => {
    for (const kind of ['compressor', 'gate', 'limiter', 'deesser'] as EffectKind[]) {
      const probe = createProbeContext();
      const e = effectOf(kind, defaultParams(kind));
      const node = buildEffectNode(probe.ctx, e);
      node.update({ ...e, bypass: true }, BPM, true);
      // The control tap is fed through the `depth` gain, which bypass takes to
      // zero, so the meter cannot report reduction that is not happening.
      expect(node.gainReductionDb?.(), kind).toBe(0);
      node.dispose();
    }
  });

  it('keeps reporting reduction on a bypassed multiband', () => {
    const probe = createProbeContext();
    const e = effectOf('multiband', defaultParams('multiband'));
    const node = buildEffectNode(probe.ctx, e);
    node.update(e, BPM, false);
    // Bypass mutes the wet leg but leaves all three `DynamicsCompressorNode`s
    // connected to the input and working; `reduction` is the browser's own
    // read-back on them, so standing in for the browser is the only way to ask
    // what the builder does with it.
    const comps = probe.nodesOfKind('compressor');
    expect(comps.length).toBe(3);
    for (const c of comps) c.reduction = -7.5;
    expect(node.gainReductionDb?.()).toBe(-7.5);
    node.update({ ...e, bypass: true }, BPM, true);
    const whileBypassed = node.gainReductionDb?.();
    console.log(
      `multiband: reports ${whileBypassed} dB of reduction while bypassed ` +
        `(the four VCA processors report 0)`,
    );
    expect(whileBypassed).toBe(-7.5);
    node.dispose();
  });
});

// -------------------------------------------------------------------- aliasing

/** What a WaveShaper does with a curve, from the specification. */
function readShaper(curve: Float32Array, x: number): number {
  const n = curve.length;
  const clamped = x < -1 ? -1 : x > 1 ? 1 : x;
  const position = ((clamped + 1) / 2) * (n - 1);
  const i = Math.floor(position);
  if (i >= n - 1) return curve[n - 1];
  return curve[i] + (position - i) * (curve[i + 1] - curve[i]);
}

const SR = 48000;
const N = 8192;
const F0 = 5000;
const OS = 4;

/**
 * Ideal oversampled shaping: shape at `os`·SR, brickwall at 24 kHz, decimate.
 *
 * "Ideal" is the decimation filter, not the result. Oversampling by any finite
 * factor still folds whatever the curve generates above that factor's own
 * Nyquist, which is why the residual falls with `os` rather than vanishing.
 */
function shapedOversampled(curve: Float32Array, amp: number, os = OS): Float32Array {
  const long = N * os;
  const re = new Float32Array(long);
  const im = new Float32Array(long);
  for (let i = 0; i < long; i++) {
    // The 4× version of the same tone is its exact band-limited interpolation.
    re[i] = readShaper(curve, amp * Math.sin((2 * Math.PI * F0 * i) / (SR * os)));
  }
  fftInPlace(re, im);
  // Keep only what fits under the 48 kHz Nyquist; discard the rest, which is
  // exactly what a perfect decimation filter would remove.
  const keep = Math.floor(long / (2 * os));
  for (let k = keep; k < long - keep + 1; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  ifftInPlace(re, im);
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = re[i * os];
  return out;
}

function shapedPlain(curve: Float32Array, amp: number): Float32Array {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++)
    out[i] = readShaper(curve, amp * Math.sin((2 * Math.PI * F0 * i) / SR));
  return out;
}

/**
 * Peak magnitude in dB, relative to the fundamental, at a set of frequencies.
 *
 * Windowed with Blackman-Harris first, and that is not cosmetic: 5 kHz at
 * 48 kHz over 8192 points is 853.33 bins, so a rectangular window leaks skirts
 * at about −31 dBc and every alias measured against it would read as that
 * number whatever the curve did. The window puts the leakage floor near
 * −90 dBc, which is below anything being looked for here.
 */
const WINDOW = makeWindow('blackmanHarris', N);

function levelsAt(signal: Float32Array, freqs: number[]): { hz: number; db: number }[] {
  const windowed = new Float32Array(N);
  for (let i = 0; i < N; i++) windowed[i] = signal[i] * WINDOW[i];
  const mag = magnitudeSpectrum(realFft(windowed));
  const binOf = (hz: number) => Math.round((hz * N) / SR);
  const peakNear = (hz: number) => {
    const b = binOf(hz);
    let peak = 0;
    // Blackman-Harris spreads a tone over about four bins either side.
    for (let k = Math.max(0, b - 4); k <= Math.min(mag.length - 1, b + 4); k++) {
      peak = Math.max(peak, mag[k]);
    }
    return peak;
  };
  const ref = peakNear(F0);
  return freqs.map((hz) => ({ hz, db: 20 * Math.log10(Math.max(peakNear(hz), 1e-12) / ref) }));
}

/** Where harmonic k of F0 lands after folding about the 48 kHz Nyquist. */
function foldedAliases(): number[] {
  const out = new Set<number>();
  for (let k = 2; k <= 12; k++) {
    const f = k * F0;
    if (f <= SR / 2) continue;
    const folded = Math.abs(f - SR * Math.round(f / SR));
    if (folded > 100 && folded < SR / 2 - 100) out.add(folded);
  }
  return [...out].sort((a, b) => a - b);
}

describe('PA · aliasing of the shaper curves at high drive', () => {
  it('measures how much alias energy 4× oversampling is there to remove', () => {
    const aliases = foldedAliases();
    const rows: string[] = [];
    const cases: [string, Float32Array, number][] = [
      ['saturator tube @36 dB', saturationCurve('tube', 36), 1],
      ['saturator tape @36 dB', saturationCurve('tape', 36), 1],
      ['saturator transistor @36 dB', saturationCurve('transistor', 36), 1],
      ['distortion @48 dB, hardness 12', clipCurve(48, 12), 1],
      ['distortion @18 dB, hardness 8 (default)', clipCurve(18, 8), 1],
      ['saturator tube @8 dB (default), −12 dBFS in', saturationCurve('tube', 8), dbToGain(-12)],
    ];
    for (const [name, curve, amp] of cases) {
      const plain = levelsAt(shapedPlain(curve, amp), aliases);
      const over = levelsAt(shapedOversampled(curve, amp), aliases);
      const worstPlain = Math.max(...plain.map((p) => p.db));
      const worstOver = Math.max(...over.map((p) => p.db));
      // The 5th harmonic folds to 23 kHz, which most listeners never hear; the
      // one that matters is the worst alias inside the band people work in.
      const audible = Math.max(...plain.filter((p) => p.hz <= 16000).map((p) => p.db));
      rows.push(
        `${name.padEnd(42)} worst ${worstPlain.toFixed(1)} dBc at 1× ` +
          `(${audible.toFixed(1)} dBc below 16 kHz), ${worstOver.toFixed(1)} dBc with ideal 4× ` +
          `— ${(worstPlain - worstOver).toFixed(1)} dB removed`,
      );
      expect(Number.isFinite(worstPlain)).toBe(true);
    }
    console.log(
      `Alias energy relative to a ${F0} Hz fundamental at ${SR} Hz, ` +
        `measured at ${aliases.join(', ')} Hz:\n  ${rows.join('\n  ')}`,
    );
  });

  it('keeps falling as the oversampling factor rises, which is what proves it is folding', () => {
    const aliases = foldedAliases();
    const curve = saturationCurve('tube', 36);
    const rows = [1, 2, 4, 8, 16].map((os) => {
      const sig = os === 1 ? shapedPlain(curve, 1) : shapedOversampled(curve, 1, os);
      return { os, worst: Math.max(...levelsAt(sig, aliases).map((p) => p.db)) };
    });
    console.log(
      'saturator tube @36 dB, worst alias by oversampling factor: ' +
        rows.map((r) => `${r.os}× ${r.worst.toFixed(1)} dBc`).join(', '),
    );
    // Not monotonic, and it should not be expected to be: which harmonic order
    // lands on which probe frequency changes with the factor, so 2× happens to
    // put nothing near 23 kHz while 4× puts the 21st there. What the ladder
    // shows is the thing worth showing — that the 1× figure is folding rather
    // than genuine in-band harmonic content, and that it keeps falling as the
    // fold point moves up.
    const at = (os: number) => rows.find((r) => r.os === os)!.worst;
    expect(at(1)).toBe(Math.max(...rows.map((r) => r.worst)));
    expect(at(16)).toBeLessThan(at(1) - 40);
    expect(at(4)).toBeLessThan(at(1) - 15);
  });

  it('finds no alias energy worth removing on the bitcrusher quantiser, which runs at 1×', () => {
    // Stated for the record rather than as a fault: the quantiser is the one
    // shaper here built with `oversample: 'none'`, and the aliasing a
    // bit-reduction folds back is the sound the control is for.
    const aliases = foldedAliases();
    const plain = levelsAt(shapedPlain(quantiserCurve(4), 1), aliases);
    const worst = Math.max(...plain.map((p) => p.db));
    console.log(`bitcrusher at 4 bit, 1× (as built): worst alias ${worst.toFixed(1)} dBc`);
    expect(worst).toBeGreaterThan(-60);
  });
});
