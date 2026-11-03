// Deterministic, unnormalised WAV captures of the same WASM DSP the browser runs.
// A synthetic snare and plucked chord reveal transient flutter and feedback
// without using copyrighted source recordings. These are listening fixtures,
// not proof of hardware fidelity or an automated sound-approval verdict.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const rate = 48000;
const block = 256;
const duration = process.argv.includes('--smoke') ? 1 : 4;
const frames = rate * duration;
const arg = process.argv.indexOf('--out');
const directory =
  arg >= 0 && process.argv[arg + 1]
    ? resolve(process.argv[arg + 1])
    : join(root, 'audit-out', 'granular-captures');

const modulePath = join(root, 'motionwave', 'wasm', 'dist', 'motionwave.mjs');
if (!existsSync(modulePath)) {
  console.error('The verified WASM core is missing. Run npm run wasm:check first.');
  process.exit(1);
}
const factory = (await import(pathToFileURL(modulePath).href)).default;
const core = await factory();
mkdirSync(directory, { recursive: true });

function manifest(unit) {
  const path = join(root, 'motionwave', 'manifests', unit + '.json');
  const spec = JSON.parse(readFileSync(path, 'utf8'));
  return {
    params: spec.params,
    byName: new Map(spec.params.map((p) => [p.symbol, p])),
  };
}
const specs = {
  reverb: manifest('fx-02-granular-reverb'),
  delay: manifest('fx-03-granular-delay'),
};

function stimulus(kind) {
  const result = new Float32Array(frames * 2);
  let rng = 0xa0b34f11;
  const noise = () => {
    rng = (Math.imul(1664525, rng) + 1013904223) >>> 0;
    return rng / 2147483648 - 1;
  };
  for (let i = 0; i < frames; i++) {
    const time = i / rate - 0.12;
    let sample = 0;
    if (time >= 0) {
      if (kind === 'snare') {
        const tail = Math.exp(-time * 23);
        sample = 0.19 * tail * noise() + 0.11 * Math.exp(-time * 37) * Math.sin(2 * Math.PI * 180 * time);
      } else {
        const attack = 1 - Math.exp(-time * 350);
        const envelope = attack * Math.exp(-time * 1.5);
        const notes = [220, 261.6256, 329.6276];
        for (const hz of notes) {
          sample +=
            envelope *
            (0.09 * Math.sin(2 * Math.PI * hz * time) +
              0.025 * Math.sin(2 * Math.PI * 2 * hz * time) +
              0.01 * Math.sin(2 * Math.PI * 3 * hz * time));
        }
      }
    }
    result[2 * i] = sample;
    result[2 * i + 1] = sample;
  }
  return result;
}

function render(unit, input, overrides) {
  const prefix = unit === 'reverb' ? '_mw_granular_reverb' : '_mw_granular_delay';
  const prepare = core[prefix + '_prepare'];
  const setParam = core[prefix + '_set_param'];
  const inputPtr = core[prefix + '_input'];
  const outputPtr = core[prefix + '_output'];
  const process = core[prefix + '_process'];
  for (const [method, fn] of Object.entries({ prepare, setParam, inputPtr, outputPtr, process })) {
    if (typeof fn !== 'function') throw new Error('Missing WASM export ' + prefix + ': ' + method);
  }
  prepare(rate, block, 2);
  for (const param of specs[unit].params) {
    if (typeof param.def === 'number') setParam(param.id, param.def);
  }
  for (const [symbol, value] of Object.entries(overrides)) {
    const param = specs[unit].byName.get(symbol);
    if (!param) throw new Error('Unknown parameter ' + unit + '/' + symbol);
    if (value < param.min || value > param.max) {
      throw new Error('Out of range ' + unit + '/' + symbol + ': ' + value);
    }
    setParam(param.id, value);
  }

  const result = new Float32Array(input.length);
  for (let at = 0; at < frames; at += block) {
    const count = Math.min(block, frames - at);
    const ptr = inputPtr() / Float32Array.BYTES_PER_ELEMENT;
    core.HEAPF32.set(input.subarray(at * 2, (at + count) * 2), ptr);
    process(count, rate, at / rate, 1);
    const out = outputPtr() / Float32Array.BYTES_PER_ELEMENT;
    const values = core.HEAPF32.subarray(out, out + count * 2);
    for (let i = 0; i < values.length; i++) {
      if (!Number.isFinite(values[i])) throw new Error(unit + ': non-finite audio at ' + (at * 2 + i));
    }
    result.set(values, at * 2);
  }
  return result;
}

// IEEE float32 preserves peaks above 0 dBFS instead of clipping them to PCM16.
function wave(samples) {
  const bytes = Buffer.alloc(44 + samples.length * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(3, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 8, 28);
  bytes.writeUInt16LE(8, 32);
  bytes.writeUInt16LE(32, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 4, 40);
  for (let i = 0; i < samples.length; i++) bytes.writeFloatLE(samples[i], 44 + i * 4);
  return bytes;
}

function stats(samples) {
  let sum = 0;
  let peak = 0;
  let over = 0;
  for (const v of samples) {
    sum += v * v;
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 1) over += 1;
  }
  return { peak, rms: Math.sqrt(sum / samples.length), overFullScaleSamples: over };
}

const cases = [
  { label: 'reverb-density100-wet', unit: 'reverb', params: { Mix: 100, Density: 100, Damping: 0 } },
  { label: 'reverb-density350-wet', unit: 'reverb', params: { Mix: 100, Density: 350, Damping: 0 } },
  { label: 'reverb-density1500-wet', unit: 'reverb', params: { Mix: 100, Density: 1500, Damping: 0 } },
  { label: 'delay-smear25-wet', unit: 'delay', params: { Mix: 100, Smear: 25 } },
  { label: 'delay-smear50-wet', unit: 'delay', params: { Mix: 100, Smear: 50 } },
];
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const records = [];
const writeCapture = (name, samples) => {
  const bytes = wave(samples);
  writeFileSync(join(directory, name), bytes);
  return createHash('sha256').update(bytes).digest('hex');
};
for (const name of ['snare', 'chord']) {
  const dry = stimulus(name);
  const dryFile = name + '-dry.wav';
  const dryHash = writeCapture(dryFile, dry);
  records.push({ file: dryFile, stimulus: name, unit: 'dry', sha256: dryHash, stats: stats(dry) });
  for (const candidate of cases) {
    const output = render(candidate.unit, dry, candidate.params);
    const file = name + '-' + candidate.label + '.wav';
    const measured = stats(output);
    if (measured.rms <= 1e-8) {
      throw new Error('Unexpected silent render: ' + file);
    }
    const sha256 = writeCapture(file, output);
    records.push({
      file,
      stimulus: name,
      unit: candidate.unit,
      params: candidate.params,
      sha256,
      stats: measured,
    });
    console.log(file + ': peak ' + measured.peak.toFixed(4));
  }
}
writeFileSync(
  join(directory, 'capture-manifest.json'),
  JSON.stringify(
    {
      sourceSha: sha,
      sampleRate: rate,
      durationSeconds: duration,
      format: 'stereo IEEE float32 WAV, no normalization or loudness matching',
      stimuli: 'synthetic, deterministic; NOT comparable to recorded instruments for fidelity',
      soundApproved: false,
      records,
    },
    null,
    2,
  ) + '\n',
);
console.log('Unapproved listening captures written to ' + directory);
