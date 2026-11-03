// @clone: working-tree — a HEAD stamp names the captured source tree.
// Deterministic listening evidence for the five Motion Wave vintage-style
// processors. This renders the production C++/WASM units, not a JS model.
// Numerical health checks do NOT certify vintage accuracy or sound quality.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rate = 48000;
const block = 256;
const seconds = process.argv.includes('--smoke') ? 1 : 4;
const frames = seconds * rate;
const at = process.argv.indexOf('--out');
const outDir =
  at !== -1 && process.argv[at + 1]
    ? resolve(process.argv[at + 1])
    : join(root, 'audit-out', 'vintage-captures');
const wasm = join(root, 'motionwave', 'wasm', 'dist', 'motionwave.mjs');
if (!existsSync(wasm)) {
  throw new Error('Verified Motion Wave WASM is missing. Run npm run wasm:check.');
}
const core = await (await import(pathToFileURL(wasm).href)).default();
mkdirSync(outDir, { recursive: true });

const units = [
  {
    slug: 'dyn-01-program-eq',
    prefix: 'mw_program_eq',
    label: 'program-eq',
    characteristic: { LowBoost: 0.65, LowAtten: 0.2, HighBoost: 0.3 },
  },
  {
    slug: 'dyn-02-optical-leveller',
    prefix: 'mw_optical_leveller',
    label: 'optical-leveller',
    characteristic: { PeakReduction: 0.65, Gain: 0, Mode: 0 },
  },
  {
    slug: 'dyn-03-fet-limiter',
    prefix: 'mw_fet_limiter',
    label: 'fet-limiter',
    characteristic: { Input: 12, Ratio: 3, Attack: 7, Release: 4 },
  },
  {
    slug: 'dyn-04-variable-mu',
    prefix: 'mw_variable_mu',
    label: 'variable-mu',
    characteristic: { InputA: 8, InputB: 8, ThresholdA: 4, ThresholdB: 4 },
  },
  {
    slug: 'dyn-05-console-eq',
    prefix: 'mw_console_eq',
    label: 'console-eq',
    characteristic: { LowAmount: 8, MidAmount: -5, HighAmount: 4 },
  },
].map((u) => {
  const p = JSON.parse(
    readFileSync(join(root, 'motionwave', 'manifests', u.slug + '.json'), 'utf8'),
  ).params;
  return { ...u, params: p, bySymbol: new Map(p.map((x) => [x.symbol, x])) };
});

function excitation(name) {
  const samples = new Float32Array(frames * 2);
  let rng = 0x63d5d24a;
  const rand = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 2147483648 - 1;
  };
  for (let i = 0; i < frames; ++i) {
    const t = i / rate - 0.12;
    let signal = 0;
    if (t >= 0) {
      if (name === 'snare') {
        signal =
          0.18 * Math.exp(-t * 20) * rand() +
          0.09 * Math.exp(-t * 24) * Math.sin(2 * Math.PI * 180 * t);
      } else {
        const envelope = (1 - Math.exp(-t * 230)) * Math.exp(-t * 0.8);
        for (const hz of [110, 164.8138, 220, 329.6276]) {
          signal +=
            envelope *
            (0.052 * Math.sin(2 * Math.PI * hz * t) + 0.016 * Math.sin(2 * Math.PI * hz * 2 * t));
        }
      }
    }
    samples[2 * i] = signal;
    samples[2 * i + 1] = signal;
  }
  return samples;
}

function render(unit, dry, characteristic, bypass) {
  const prefix = '_' + unit.prefix;
  const prepare = core[prefix + '_prepare'];
  const set = core[prefix + '_set_param'];
  const input = core[prefix + '_input'];
  const output = core[prefix + '_output'];
  const process = core[prefix + '_process'];
  const setBypass = core[prefix + '_set_bypass'];
  for (const [name, fn] of Object.entries({
    prepare,
    set,
    input,
    output,
    process,
    setBypass,
  })) {
    if (typeof fn !== 'function') {
      throw new Error(unit.label + ': WASM export missing ' + name);
    }
  }
  prepare(rate, block, 2);
  for (const p of unit.params) set(p.id, p.def);
  // Noise is disabled for deterministic comparisons. This does not claim the
  // hardware hiss model is correct; those cases require a separate review.
  if (unit.bySymbol.has('Noise')) set(unit.bySymbol.get('Noise').id, 0);
  for (const [symbol, value] of Object.entries(characteristic ? unit.characteristic : {})) {
    const p = unit.bySymbol.get(symbol);
    if (!p) throw new Error(unit.label + ': no parameter ' + symbol);
    if (value < p.min || value > p.max) {
      throw new Error(unit.label + ': out-of-range parameter ' + symbol);
    }
    set(p.id, value);
  }
  setBypass(bypass ? 1 : 0);

  const result = new Float32Array(dry.length);
  for (let offset = 0; offset < frames; offset += block) {
    const n = Math.min(block, frames - offset);
    core.HEAPF32.set(dry.subarray(offset * 2, (offset + n) * 2), input() / 4);
    process(n, rate, offset / rate, 1);
    const rendered = core.HEAPF32.subarray(output() / 4, output() / 4 + n * 2);
    for (const sample of rendered) {
      if (!Number.isFinite(sample)) {
        throw new Error(unit.label + ' generated a non-finite sample');
      }
    }
    result.set(rendered, offset * 2);
  }
  return result;
}

function metrics(samples, reference) {
  let square = 0;
  let delta = 0;
  let peak = 0;
  let maxAbsError = 0;
  let aboveFullScale = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const difference = x - reference[i];
    square += x * x;
    delta += difference * difference;
    peak = Math.max(peak, Math.abs(x));
    maxAbsError = Math.max(maxAbsError, Math.abs(difference));
    if (Math.abs(x) > 1) aboveFullScale++;
  }
  return {
    peak,
    rms: Math.sqrt(square / samples.length),
    differenceRmsFromDry: Math.sqrt(delta / samples.length),
    maxAbsDifferenceFromDry: maxAbsError,
    aboveFullScale,
  };
}

function wavFloat32(samples) {
  const data = Buffer.allocUnsafe(44 + samples.length * 4);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVE', 8);
  data.write('fmt ', 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(3, 20);
  data.writeUInt16LE(2, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 8, 28);
  data.writeUInt16LE(8, 32);
  data.writeUInt16LE(32, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) {
    data.writeFloatLE(samples[i], 44 + i * 4);
  }
  return data;
}
const records = [];
function capture(filename, values, dry, context) {
  const bytes = wavFloat32(values);
  writeFileSync(join(outDir, filename), bytes);
  records.push({
    file: filename,
    ...context,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    metrics: metrics(values, dry),
  });
  console.log(filename + '  peak ' + metrics(values, dry).peak.toFixed(5));
}

for (const name of ['snare', 'chord']) {
  const dry = excitation(name);
  capture(name + '-dry.wav', dry, dry, { stimulus: name, mode: 'dry' });
  for (const unit of units) {
    const neutral = render(unit, dry, false, false);
    const character = render(unit, dry, true, false);
    const bypassed = render(unit, dry, true, true);
    const neutralFile = name + '-' + unit.label + '-neutral.wav';
    const characterFile = name + '-' + unit.label + '-character.wav';
    const bypassFile = name + '-' + unit.label + '-bypass.wav';
    capture(neutralFile, neutral, dry, { stimulus: name, unit: unit.slug, mode: 'neutral' });
    capture(characterFile, character, dry, {
      stimulus: name,
      unit: unit.slug,
      mode: 'character',
      overrides: unit.characteristic,
    });
    capture(bypassFile, bypassed, dry, {
      stimulus: name,
      unit: unit.slug,
      mode: 'bypass',
      overrides: unit.characteristic,
    });

    // No unapproved compensation, automatic normalisation, or silent success.
    const altered = metrics(character, neutral);
    const off = metrics(bypassed, dry);
    if (!(altered.differenceRmsFromDry > 1e-7)) {
      throw new Error(unit.slug + ' characteristic controls had no detectable effect');
    }
    if (off.maxAbsDifferenceFromDry > 1e-6) {
      throw new Error(unit.slug + ' bypass deviated from dry: ' + off.maxAbsDifferenceFromDry);
    }
  }
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
writeFileSync(
  join(outDir, 'capture-manifest.json'),
  JSON.stringify(
    {
      sourceSha: sha,
      format: 'stereo IEEE float32 WAV, unnormalised',
      sampleRate: rate,
      seconds,
      stimuli: 'deterministic synthetic snare and chord',
      noiseDisabledForComparison: true,
      soundApproved: false,
      notes:
        'Technical sanity and audibility fixtures only. No microphone, hardware, or human reference matching performed.',
      records,
    },
    null,
    2,
  ) + '\n',
);
console.log('Vintage audio evidence written to ' + outDir);
