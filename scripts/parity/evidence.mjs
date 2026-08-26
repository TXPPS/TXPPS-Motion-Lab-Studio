/**
 * What the audit says it looked at, checked against what is there now.
 *
 * The chapters do not only record verdicts; they record the *evidence* for
 * them. Its own key says so — "`MISSING` — absent, with the grep that
 * established it named" — and the prose keeps that promise: "Grepped
 * `audioPart`, `consolidate`: no hits in `src/`", "`src/model/types.ts` defines
 * `Clip = AudioClip | MidiClip`", "no hits for `soloSafe` outside …".
 *
 * That is the half of the audit this repository can settle, and it is the half
 * that went stale. Six items had been closed while the documents still called
 * them missing — one of them a P0, output device selection, built and shipped
 * with a preference and a settings control while the setup chapter went on
 * calling it unbuilt. Its first full run found the sixth, and two sentences
 * whose stated grep had stopped returning what the sentence said. Nine hundred
 * hand-written registry entries would not have caught any of them any better,
 * and would have rotted the same way.
 *
 * The reference half — whether FSP8 does what the manual says — is not knowable
 * from here, and pretending otherwise would be the second opinion CLAUDE.md's
 * rule is about. Claims whose MotionLab half yields no checkable evidence are
 * reported as needing judgement, by name, so that set is a decision somebody
 * made rather than a silence.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** Roots a citation may point into. Anything else is prose that looks like a path. */
const CITABLE = ['src', 'e2e', 'tests', 'scripts', 'motionwave', 'docs', 'public'];

/** A backticked repository path: `src/model/types.ts`, `src/audio/pdc.ts:41`. */
const PATH_RE = new RegExp(
  '`(' + CITABLE.join('|') + ')/([\\w./@-]+\\.(?:ts|tsx|css|mjs|js|h|cpp|json|md))(?::[\\d–-]+)?`',
  'g',
);

/**
 * A bare filename with no directory: `useKeyboard.ts:224`, `TransportBar.tsx`.
 *
 * The shortcuts chapter cites this way almost exclusively — two hundred rows of
 * "`Space` → `engine.togglePlay()` (`useKeyboard.ts:224`)" — so a path pattern
 * that insisted on a `src/` prefix found evidence in none of them and reported
 * the whole chapter as unverifiable. Resolved by basename against the tree,
 * which is unambiguous here: no two source files in this repository share one.
 */
const FILENAME_RE = /`([A-Za-z][\w.-]*\.(?:ts|tsx|css|mjs|h|cpp))(?::[\d–-]+)?`/g;

/**
 * The chapters' four ways of saying "we looked and it is not there".
 *
 * Each captures a list of backticked symbols. Written as separate patterns
 * rather than one alternation because the lists sit on different sides of the
 * verb: "Grepped `x`, `y`: no hits" puts them before, "no hits for `x`" after.
 */
/**
 * A search was performed, and it came back empty.
 *
 * Matched as a verb and an outcome with a window between them, rather than as
 * one pattern per sentence. The chapters write this eleven different ways —
 * "Grepped `x`, `y`: no hits", "Grepped for `x`: no hits anywhere in `src/`",
 * "Grepped `src/` for `x`: no hits", "grep for `x` / `y` returns nothing",
 * "`x` appears nowhere" — and a pattern list that tried to enumerate them found
 * eleven symbols out of the corpus. Anchoring on the pair finds every phrasing
 * that has an outcome, and a search sentence with no outcome ("Grepped `Spot`:
 * the only hit is…") is correctly left alone, because it is not an absence.
 */
const SEARCH_VERB = /\b(?:Grepped|Greps|Searched|grep(?:ped)?\s+for|grep\s+for)\b/gi;
const EMPTY_RESULT =
  /\b(?:no hits|no matches|nothing|zero (?:hits|results)|not found|no results)\b/i;
/** How far past the verb the outcome may sit. Long enough for a wrapped list. */
const WINDOW = 220;

/** Legacy shapes with no search verb at all. */
const ABSENT_PATTERNS = [
  /((?:`[^`]+`[,\s/]*)+)\s+(?:appears?|exists?|occurs?)\s+nowhere\b/gi,
  /\bno\s+((?:`[^`]+`[,\s/]*)+)\s+(?:anywhere|in\s+`?src)/gi,
];

/** Load every source file once; a grep per claim over 900 claims is not free. */
let corpus = null;
let basenames = null;
function scan() {
  if (corpus) return;
  const parts = [];
  basenames = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'build') continue;
        walk(rel);
      } else if (/\.(ts|tsx|css|mjs|h|cpp)$/.test(e.name)) {
        basenames.add(e.name);
        if (dir.startsWith('src') && /\.(ts|tsx|css)$/.test(e.name)) {
          parts.push(readFileSync(join(ROOT, rel), 'utf8'));
        }
      }
    }
  };
  for (const root of CITABLE) if (existsSync(join(ROOT, root))) walk(root);
  corpus = parts.join('\n');
}
const sources = () => {
  scan();
  return corpus;
};

/** Symbols the audit says are absent, pulled out of one sentence's backticks. */
const backticked = (blob) => [...blob.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

/**
 * A symbol worth grepping for.
 *
 * A one- or two-character token, or one carrying spaces or punctuation, is a
 * word the author happened to quote rather than an identifier — and grepping
 * for it would find it in every file and report a closed claim that is not.
 * The `PARTIAL` on §1.1 is a real claim; `` `#` `` inside it is not evidence.
 */
const isSymbol = (s) => /^[A-Za-z_$][\w$.]{2,}$/.test(s) && !/^(src|the|and|not|for)$/i.test(s);

/**
 * Everything checkable in one section of the audit.
 *
 * @param text the section's whole body, headings included
 * @returns `{ paths, absent }` — repository paths it cites, and symbols it
 *   states are not present
 */
export function evidenceIn(text) {
  const paths = [...new Set([...text.matchAll(PATH_RE)].map((m) => `${m[1]}/${m[2]}`))];
  const files = [...new Set([...text.matchAll(FILENAME_RE)].map((m) => m[1]))].filter(
    // A path citation already covers its own basename; listing it twice would
    // report one missing file as two.
    (f) => !paths.some((p) => p.endsWith(`/${f}`)),
  );
  const absent = new Set();
  for (const m of text.matchAll(SEARCH_VERB)) {
    const window = text.slice(m.index, m.index + WINDOW);
    const end = EMPTY_RESULT.exec(window);
    if (!end) continue;
    // Only the symbols named *before* the outcome. Past it the sentence has
    // moved on — "no hits; the nearest thing is `takeLanes`" would otherwise
    // record `takeLanes` as absent, which it is not.
    const searched = window.slice(0, end.index);
    /*
     * A search scoped to one file is not a claim about the tree.
     *
     * "grepped `ChannelStrip.tsx` for `inputDeviceId`: no hits" says the mixer
     * strip has no input selector — true, and the same section says three
     * paragraphs earlier that `RecordControls.tsx` does. Checking that symbol
     * against all of `src/` reported the audit as stale about a P0 it had got
     * exactly right. A claim this checker cannot evaluate at the scope it was
     * made falls to the judgement path, which is where an unevaluable claim
     * belongs.
     */
    if (/`[\w.-]+\.(?:ts|tsx|css|mjs|h|cpp)`/.test(searched)) continue;
    for (const sym of backticked(searched)) if (isSymbol(sym)) absent.add(sym);
  }
  for (const re of ABSENT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      for (const sym of backticked(m[1])) if (isSymbol(sym)) absent.add(sym);
    }
  }
  return { paths, files, absent: [...absent] };
}

/** Is a bare filename still a file somewhere in the tree? */
export function fileExists(name) {
  scan();
  return basenames.has(name);
}

/** Does this path still exist? Line-number suffixes are already stripped. */
export function pathExists(p) {
  const full = join(ROOT, p);
  return existsSync(full) && statSync(full).isFile();
}

/** Is this symbol still absent from `src/`? */
export function stillAbsent(symbol) {
  return !sources().includes(symbol);
}
