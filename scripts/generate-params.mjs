#!/usr/bin/env node
/**
 * Motion Wave — generate a unit's parameter tables from its manifest.
 *
 * Ledger cell D1 asks two things of every unit: that the set of controls the UI
 * exposes and the set of setters the DSP has are the *same set*, and that each
 * of those setters actually reaches audio. The second is a measurement and has
 * to be a test. The first is a parity check between two tables, and a parity
 * check between two hand-maintained tables is a test that passes for years and
 * then fails once, after the drift it was meant to catch has already shipped.
 *
 * So the first half is not tested here, it is made unconstructible: both tables
 * come out of `motionwave/manifests/<unit>.json`, so a control that names no
 * parameter cannot be written down and a parameter with no control cannot
 * exist. Fourteen units of hand-maintained parallel tables would have given
 * fourteen chances to drift; this gives none. It is the same move as
 * `WetDryMixer`'s branded latency and the seqlock publish path — make the
 * defect fail to compile rather than fail a test.
 *
 *   node scripts/generate-params.mjs           # write the generated files
 *   node scripts/generate-params.mjs --check    # fail if they are out of date
 *
 * `--check` is what makes the guarantee hold. Without it a generated file could
 * be hand-edited and would then be exactly the second opinion this exists to
 * prevent, so the build runs it.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import * as prettier from 'prettier';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestDir = join(root, 'motionwave', 'manifests');
const check = process.argv.includes('--check');

const BANNER = (manifest) =>
  [
    '// GENERATED FILE — do not edit.',
    '//',
    `// Written by scripts/generate-params.mjs from motionwave/manifests/${manifest}.`,
    '// Edit the manifest and re-run `npm run params`. A hand edit here is exactly',
    '// the second opinion the manifest exists to prevent, and `npm run params:check`',
    '// fails the build if one is present.',
    '',
  ].join('\n');

/** `CrossoverLowMid` → `crossover-low-mid`, so a control id is never invented twice. */
function kebab(symbol) {
  return symbol.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function cppLiteral(v) {
  // `1` and `1.0` are the same value and different tokens, and a table of
  // doubles written with integer literals compiles to the same thing but reads
  // as a table of ints. Kept explicit so the generated file says what it is.
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

/** `MotionShaper` → `motionShaper`, for the value tables. */
function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Wrap a note into `//` lines that fit the core's 100-column format. */
function wrapComment(text, indent) {
  const pad = ' '.repeat(indent);
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (pad + '// ' + line + ' ' + word).length > 100) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => `${pad}// ${l}\n`).join('');
}

function generateCpp(m, file) {
  const ids = m.params.map((p) => `  ${p.symbol} = ${p.id},`).join('\n');
  const rows = m.params
    .map(
      (p) =>
        `    {${p.id}, "${p.symbol}", "${p.name}", ${cppLiteral(p.min)}, ${cppLiteral(p.max)}, ` +
        `${cppLiteral(p.def)}, ${cppLiteral(p.delta[0])}, ${cppLiteral(p.delta[1])}},`,
    )
    .join('\n');
  const cases = m.params
    .map((p) => {
      // Wrapped rather than emitted on one line: the core builds with -Werror
      // and the repo's own formatting expects 100 columns, so a long `note`
      // written as a single comment would be the generator producing code that
      // fails the checks the hand-written core has to pass.
      const note = p.note ? wrapComment(p.note, 6) : '';
      const body = p.apply
        .split('\n')
        .map((line) => `      ${line.trimStart()}`)
        .join('\n');
      return (
        `    case ${m.className}Param::${p.symbol}: {\n` +
        note +
        `${body}\n` +
        '      break;\n' +
        '    }'
      );
    })
    .join('\n');

  return `${BANNER(file)}#pragma once

#include "${m.header}"

namespace ${m.namespace} {

/**
 * The ${m.className}'s parameter ids.
 *
 * Stable and never renumbered: an id is what an automation lane and a saved
 * preset name a parameter by, so renumbering one silently re-points every
 * project that automated it.
 */
enum class ${m.className}Param : int {
${ids}
};

/// One row of the parameter table, for tests that sweep every parameter.
struct ${m.className}ParamRow {
  int id;
  const char* symbol;
  const char* name;
  double min;
  double max;
  double def;
  /**
   * Two values a render-delta test may set this parameter to. Chosen per
   * parameter rather than taken as the range ends, because for several of them
   * an end of the range is a setting where the unit does nothing audible — a
   * range of −90 dB with depth at zero modulates silence — and a delta test
   * that cannot hear a working setter proves nothing about a broken one.
   */
  double deltaLow;
  double deltaHigh;
};

inline constexpr int k${m.className}ParamCount = ${m.params.length};

inline constexpr ${m.className}ParamRow k${m.className}Params[k${m.className}ParamCount] = {
${rows}
};

/**
 * Route one parameter into the unit.
 *
 * Generated, which is the point: this switch and the TypeScript control table
 * are the same list, so a control naming no parameter does not compile and a
 * parameter with no control cannot be declared.
 */
inline void apply${m.className}Param(${m.className}& u, int id, double v) noexcept {
  switch (static_cast<${m.className}Param>(id)) {
${cases}
  }
}

}  // namespace ${m.namespace}
`;
}

function generateTs(m, file) {
  const ids = m.params.map((p) => `  ${p.symbol}: ${p.id},`).join('\n');
  const specs = m.params
    .map((p) => {
      const lines = [
        `    id: ${m.className}Param.${p.symbol},`,
        `    name: ${JSON.stringify(p.name)},`,
        `    unit: Unit.${p.unit},`,
        `    min: ${p.min},`,
        `    max: ${p.max},`,
        `    def: ${p.def},`,
        `    taper: Taper.${p.taper},`,
      ];
      if (p.steps !== undefined) lines.push(`    steps: ${p.steps},`);
      if (p.choices) lines.push(`    choices: ${JSON.stringify(p.choices)},`);
      lines.push(`    smoothingMs: ${p.smoothingMs},`);
      return `  defineParam({\n${lines.join('\n')}\n  }),`;
    })
    .join('\n');
  const controls = m.params
    .map(
      (p) =>
        `  {\n    id: '${kebab(p.symbol)}',\n    role: '${p.control}',\n` +
        `    paramId: ${m.className}Param.${p.symbol},\n` +
        `    accessibleName: ${JSON.stringify(p.accessibleName)},\n  },`,
    )
    .join('\n');

  return `${BANNER(file)}import { defineParam } from '../../param/spec';
import type { ParamSpec } from '../../param/spec';
import { Taper, Unit } from '../../param/units';

/** Parameter ids, the same numbers the C++ enum carries. */
export const ${m.className}Param = {
${ids}
} as const;

export type ${m.className}ParamId = (typeof ${m.className}Param)[keyof typeof ${m.className}Param];

/**
 * Every range, default and taper, straight from the manifest — which took them
 * from the Reference Spec Sheet. A control that sweeps a different range than
 * its sheet fails the unit's acceptance test on a number nobody checks by ear.
 */
export const ${camel(m.className)}Specs: readonly ParamSpec[] = [
${specs}
];

/**
 * What each parameter needs on the panel: which control, and what a screen
 * reader calls it. Not how it looks — colour and geometry are the face's, and
 * belong with the rest of the design language rather than in a generated file.
 *
 * \`paramId\` is a real id by construction. That is the half of D1 this file
 * exists to make unconstructible.
 */
export const ${camel(m.className)}Controls = [
${controls}
] as const;
`;
}

const prettierConfig = (await prettier.resolveConfig(join(root, 'package.json'))) ?? {};

let stale = 0;
let wrote = 0;
const manifests = readdirSync(manifestDir).filter((f) => f.endsWith('.json'));

for (const file of manifests) {
  const m = JSON.parse(readFileSync(join(manifestDir, file), 'utf8'));

  // Two ways a manifest could be wrong that generation would happily propagate.
  const seenIds = new Set();
  const seenSymbols = new Set();
  for (const p of m.params) {
    if (seenIds.has(p.id)) throw new Error(`${file}: duplicate parameter id ${p.id}`);
    if (seenSymbols.has(p.symbol)) throw new Error(`${file}: duplicate symbol ${p.symbol}`);
    if (p.delta[0] === p.delta[1])
      throw new Error(`${file}: ${p.symbol} has an empty delta pair, so D1 could not measure it`);
    seenIds.add(p.id);
    seenSymbols.add(p.symbol);
  }

  const targets = [
    [
      join(
        root,
        'motionwave',
        'core',
        'units',
        'generated',
        `${m.tsPrefix ?? m.unit}_params.gen.h`,
      ),
      generateCpp(m, file),
    ],
    [join(root, m.tsTarget), generateTs(m, file)],
  ];

  for (const [path, raw] of targets) {
    // Run the TypeScript through the repo's own formatter rather than trying to
    // emit formatted output. Otherwise `npm run format` would rewrite a
    // generated file and `--check` would then call it stale — two guards
    // disagreeing about the same file, each of them right.
    const content = path.endsWith('.ts')
      ? await prettier.format(raw, { ...prettierConfig, parser: 'typescript' })
      : raw;
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    if (check) {
      stale += 1;
      console.error(`STALE ${path.slice(root.length + 1)}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    wrote += 1;
    console.log(`wrote ${path.slice(root.length + 1)}`);
  }
}

if (check && stale > 0) {
  console.error(
    `\n${stale} generated file(s) do not match their manifest. Run \`npm run params\`.\n` +
      'If you hand-edited one, the edit belongs in motionwave/manifests/ instead: both\n' +
      'sides of the parity are generated from there, and that is what keeps a control\n' +
      'from naming a parameter the DSP does not have.',
  );
  process.exit(1);
}
if (check) console.log(`params: ${manifests.length} manifest(s) up to date`);
else if (wrote === 0) console.log('params: already up to date');
