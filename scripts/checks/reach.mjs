/**
 * Who actually invokes what.
 *
 * The question is not whether a check exists or whether it passes. It is
 * whether anything ever runs it — and for that, "an npm script exists" is not
 * an answer, because every orphan this sweep has found was a script or a config
 * that existed. So reachability is computed from the two places that run
 * without anybody choosing to: the CI workflows, and the commands `CLAUDE.md`
 * tells a person to run.
 *
 * Anything reachable from neither runs only when somebody remembers, and a
 * check that runs when somebody remembers is the one that was not run.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './inventory.mjs';

/**
 * Read a file with its line endings normalised.
 *
 * A Windows checkout has carriage returns, and every regex below is anchored on
 * a bare newline. Without this, `documentedCommands` matched nothing at all and
 * reported every command in CLAUDE.md as absent — a sweep about checks that
 * silently do nothing, silently doing nothing. Caught on its own first run.
 */
const readLines = (path) => readFileSync(path, 'utf8').split('\r\n').join('\n');

/**
 * Every shell command a CI workflow runs, flattened.
 *
 * A regex over `run:` rather than a YAML parse, so this file has no dependency
 * — and because what is wanted is the command text, block scalars included, not
 * a structured document.
 */
export function ciCommands() {
  const dir = join(ROOT, '.github', 'workflows');
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (!/\.ya?ml$/.test(entry)) continue;
    const src = readLines(join(dir, entry));
    for (const m of src.matchAll(/^(\s*)-?\s*run:\s*(\|[-+]?)?\s*(.*)$/gm)) {
      const [, indent, block, first] = m;
      if (!block) {
        out.push({ workflow: entry, command: first.trim() });
        continue;
      }
      // A block scalar: take every following line indented past the key.
      const rest = src.slice(m.index + m[0].length).split('\n');
      const body = [];
      for (const line of rest) {
        if (line.trim() === '') continue;
        if (line.search(/\S/) <= indent.length) break;
        body.push(line.trim());
      }
      for (const line of body) out.push({ workflow: entry, command: line });
    }
  }
  return out;
}

/**
 * The commands `CLAUDE.md` names in its "Build and test" block.
 *
 * Parsed out of the document rather than copied, so a command that is removed
 * from the instructions stops counting as a way anything is reached. That is
 * the point: a check whose only invocation was a line in a document nobody
 * follows any more is an orphan, and it should read as one the moment the line
 * goes.
 */
export function documentedCommands() {
  const src = readLines(join(ROOT, 'CLAUDE.md'));
  const out = [];
  for (const block of src.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const line of block[1].split('\n')) {
      const command = line.replace(/#.*$/, '').trim();
      if (command) out.push(command);
    }
  }
  return out;
}

/**
 * The commands git runs on its own, from the hooks this repository ships.
 *
 * A third route, and it is not `documented`: a hook runs without anybody
 * choosing to, which is the same property CI has and the whole reason the
 * pre-push guard exists. Calling it documented would say the ordering rule is
 * enforced by somebody reading `CLAUDE.md`, and a rule enforced by reading is
 * the rule that had already failed.
 *
 * Read from `.githooks/` rather than from `.git/hooks/`, which is not tracked:
 * the question is what this repository installs, not what one checkout happens
 * to have.
 */
export function hookCommands() {
  const dir = join(ROOT, '.githooks');
  const out = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    for (const line of readLines(join(dir, entry)).split('\n')) {
      const command = line
        .replace(/#.*$/, '')
        .replace(/^\s*exec\s+/, '')
        .trim();
      if (command && !command.startsWith('!')) out.push({ hook: entry, command });
    }
  }
  return out;
}

/**
 * Expand one command into every npm script it transitively runs.
 *
 * `npm run build` runs eleven checks in a chain and each of them is reached by
 * it; `npm run e2e:mw` runs `npm run build:panel` first. Without following the
 * chain, ten of the eleven would read as orphans and the sweep would be noise.
 */
export function expand(command, scripts, seen = new Set()) {
  const reached = new Set();
  const visit = (text) => {
    for (const m of text.matchAll(/\bnpm\s+(?:run\s+)?([\w:.-]+)/g)) {
      const name = m[1] === 'ci' || m[1] === 'install' ? null : m[1];
      if (!name || !scripts.has(name) || seen.has(name)) continue;
      seen.add(name);
      reached.add(name);
      visit(scripts.get(name));
    }
  };
  visit(command);
  return reached;
}

/**
 * A command with its whitespace flattened, for comparing one against another.
 *
 * `npm run build` runs `node scripts/generate-accent.mjs --check` directly
 * rather than as `npm run accent:check`, so the *check* runs and the alias does
 * not. Matching on the body as well as on the name is what tells that apart
 * from a check nothing invokes at all — and getting it wrong in this direction
 * would bury the real orphans under a dozen false ones.
 */
export const signature = (command) => command.replace(/\s+/g, ' ').trim();

/**
 * Everything reached, by route.
 *
 * Three routes rather than one union, because they answer different questions:
 * a check reached only by `CLAUDE.md` does not run on a push, and a reviewer
 * needs to be told which of those they are looking at.
 */
export function reachability(scripts) {
  const byCi = new Set();
  const byDocs = new Set();
  const byHook = new Set();
  const hookText = [];
  for (const { command } of hookCommands()) {
    hookText.push(command);
    for (const name of expand(command, scripts, new Set())) byHook.add(name);
  }
  const ciText = [];
  for (const { command } of ciCommands()) {
    ciText.push(command);
    for (const name of expand(command, scripts, new Set())) byCi.add(name);
  }
  const docText = [];
  for (const command of documentedCommands()) {
    docText.push(command);
    for (const name of expand(command, scripts, new Set())) byDocs.add(name);
  }
  // The literal text of everything that runs, for the things that are not npm
  // scripts: a tsconfig is reached by being named (`tsc -p tsconfig.e2e.json`)
  // and so is a guard invoked as `node scripts/check-bundle.mjs` with no script
  // wrapping it.
  const bodies = [...byCi, ...byDocs, ...byHook].map((name) => scripts.get(name) ?? '');
  const ciAll = signature([...ciText, ...[...byCi].map((n) => scripts.get(n) ?? '')].join(' ; '));
  const hookAll = signature(hookText.join(' ; '));
  const all = signature([...ciText, ...docText, ...hookText, ...bodies].join(' ; '));
  for (const [name, command] of scripts) {
    const body = signature(command);
    if (!body || byCi.has(name)) continue;
    if (ciAll.includes(body)) byCi.add(name);
    else if (hookAll.includes(body)) byHook.add(name);
    else if (all.includes(body)) byDocs.add(name);
  }
  return { byCi, byDocs, byHook, ciText: ciAll, allText: all };
}
