/**
 * Design-only parameter fidelity gate for the four CP-UI-LOCK-003 faces.
 * Reads generated source tables; it never changes ParamSpec or audio.
 */
import { readFileSync } from 'node:fs';

const contracts = [
  {
    id: 'DYN-02',
    dir: 'optical_leveller',
    groups: {
      primary: ['Peak Reduction', 'Gain', 'Mode'],
      secondary: ['Input', 'Emphasis'],
      advanced: ['Cell Wear', 'Variance', 'Oversampling', 'Noise'],
    },
    forbidden: ['Attack', 'Release', 'Threshold', 'Ratio'],
  },
  {
    id: 'DYN-03',
    dir: 'fet_limiter',
    groups: {
      primary: ['Input', 'Output', 'Attack', 'Release', 'Ratio', 'Limiting'],
      advanced: ['Variance', 'Oversampling', 'Noise'],
    },
    forbidden: ['Threshold'],
  },
  {
    id: 'DYN-04',
    dir: 'variable_mu',
    groups: {
      channelA: ['Input A', 'Threshold A', 'Time Constant A', 'DC Threshold A'],
      channelB: ['Input B', 'Threshold B', 'Time Constant B', 'DC Threshold B'],
      common: ['Mode', 'Oversampling'],
    },
    forbidden: ['Attack', 'Release', 'Ratio', 'Stereo Link'],
  },
  {
    id: 'DYN-05',
    dir: 'console_eq',
    groups: {
      common: ['Lineage', 'Drive', 'Output', 'EQ In', 'Oversampling'],
      inductor: ['Low Freq', 'Low', 'Mid Freq', 'Mid', 'High', 'High-Pass'],
      bridgedT: [
        'Band 1 Freq',
        'Band 1',
        'Band 1 Shape',
        'Band 2 Freq',
        'Band 2',
        'Band 3 Freq',
        'Band 3',
        'Band 3 Shape',
        'Band-Pass',
      ],
    },
    forbidden: ['High Freq', 'Low Q'],
  },
];

for (const contract of contracts) {
  const file = new URL(`../../motionwave/ui/units/${contract.dir}/params.gen.ts`, import.meta.url);
  const source = readFileSync(file, 'utf8');
  // Parameter definitions are always written by the manifest generator
  // as defineParam({ name: '...', ... }). Extract only within each block,
  // never from explanatory comments or docs.
  const blocks = source.split('defineParam({').slice(1);
  const live = blocks.map((b) => /\bname:\s*'([^']+)'/.exec(b)?.[1]);
  if (live.some((v) => !v)) throw new Error(`${contract.id}: missing generated name`);
  const wanted = Object.values(contract.groups).flat();
  const duplicates = (values) => values.filter((v, i) => values.indexOf(v) !== i);
  if (duplicates(wanted).length || duplicates(live).length) {
    throw new Error(`${contract.id}: duplicate face group or generated parameter name`);
  }
  const unknown = wanted.filter((name) => !live.includes(name));
  const omitted = live.filter((name) => !wanted.includes(name));
  const illegal = contract.forbidden.filter((name) => wanted.includes(name));
  if (unknown.length || omitted.length || illegal.length) {
    throw new Error(
      `${contract.id}: unknown=${unknown.join(',')}; omitted=${omitted.join(',')}; forbidden=${illegal.join(',')}`,
    );
  }
  if (contract.dir === 'fet_limiter' && !source.includes("'All In'")) {
    throw new Error('DYN-03: five-position ratio must retain All In');
  }
  if (contract.dir === 'console_eq' && !source.includes("'Bridged-T'")) {
    throw new Error('DYN-05: independent bridged-T circuit mode absent');
  }
  console.log(
    `${contract.id} ${contract.dir}: ${wanted.length} generated params matched exactly across ${Object.keys(contract.groups).length} honest face zones`,
  );
}

const firstWave = [
  ['program_eq', 14],
  ['granular_reverb', 23],
  ['granular_delay', 139],
];
for (const [name, count] of firstWave) {
  const source = readFileSync(
    new URL(`../../motionwave/ui/units/${name}/params.gen.ts`, import.meta.url),
    'utf8',
  );
  const found = source.split('defineParam({').length - 1;
  if (found !== count) {
    throw new Error(`CP-UI-LOCK-002 ${name} parameter count drift: ${found} != ${count}`);
  }
  console.log(`CP-UI-LOCK-002 ${name}: ${found} generated parameters accounted for`);
}
