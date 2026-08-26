/**
 * Every verdict the FSP8 parity audit records, enumerated from the documents.
 *
 * Eleven thousand lines across eight chapters, written over several sittings,
 * and they do not agree on notation: `**Gap.** \`PARTIAL\` — …`,
 * `**Gap — \`MISSING\`.**`, `**Gap:** \`PARITY\` — …`, and `### Gap` tables
 * whose rows carry `**MISSING** — …` in a later column. A reader takes all four
 * in stride. A guard that knows three of them reports a clean sweep over the
 * fourth, which is the failure this file exists to make impossible.
 *
 * So the parser is deliberately loud, and it is loud about the right thing.
 * Requiring every *sentence* mentioning a verdict to be registered would drown
 * the registry in narrative — chapters close with paragraphs like "the
 * highest-value item here is…" that name verdicts without making one. What it
 * requires instead is that **no section states a verdict without a claim being
 * parsed from it**. A section the enumerator cannot read is a section nobody is
 * checking, and it looks exactly like a section that passed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DIR = 'docs/reference';

/** The words the audit uses, longest first so the hyphenated one wins. */
const VERDICTS = ['DIVERGENT-BY-DESIGN', 'PARITY', 'PARTIAL', 'MISSING', 'DIVERGENT'];
const VERDICT_RE = new RegExp(`\\b(${VERDICTS.join('|')})\\b`);

/**
 * A line that defines the vocabulary rather than using it.
 *
 * Every chapter opens with a key — "`PARITY` · `PARTIAL` · `MISSING` ·
 * `DIVERGENT-BY-DESIGN`" — and one says "exactly one of" the same four.
 *
 * Matched on the *shape* of a legend: three or more backticked verdicts in a
 * row with only punctuation between them. It was "three or more distinct
 * verdict words anywhere in the block", and that silently ate real claims — a
 * gap paragraph that goes on to weigh three outcomes reads as a legend under
 * that rule, and three whole sections of the mixing chapter disappeared behind
 * it. A heuristic that fails by *dropping* claims is the worst kind here,
 * because what it leaves behind still looks like a complete sweep.
 */
const V = VERDICTS.join('|');
/** "`PARITY` · `PARTIAL` · `MISSING`" — three or more in a row. */
const LEGEND_RUN = new RegExp(`(\`?\\*{0,2}(?:${V})\\*{0,2}\`?[ \\t]*[·/,|][ \\t]*){2,}`);
/** The same key set out as a bulleted list, one verdict defined per line. */
const LEGEND_LINE = new RegExp(`^\\s*[-*]\\s*\\*{0,2}\`?(?:${V})\`?\\*{0,2}\\s*[—–-]`);
const isLegend = (text) =>
  LEGEND_RUN.test(text) ||
  /exactly one of|^\s*Legend[:.]|\bGap key\b|\bGap vocabulary\b/im.test(text) ||
  text.split('\n').filter((l) => LEGEND_LINE.test(l)).length >= 3;

/** `### 1.2 Event contextual menu` → `1.2-event-contextual-menu`. */
export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[`*_[\]()]/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

const verdictOf = (text) => {
  const m = VERDICT_RE.exec(text);
  return m ? m[1] : null;
};

const isTable = (line) => line.trimStart().startsWith('|');
const isSeparator = (cells) => cells.every((c) => /^[-: ]*$/.test(c));

/**
 * One row of a verdict table.
 *
 * The verdict may be in any column after the first: `### Gap` tables put it in
 * the second, and the shortcut chapter's tables put a status column fifth. The
 * first cell is the subject, so a row with an empty one is a continuation of
 * the row above rather than a claim of its own.
 */
function tableRow(line) {
  const cells = line
    .split('|')
    .slice(1, -1)
    .map((c) => c.trim());
  if (cells.length < 2 || isSeparator(cells) || cells[0] === '') return null;
  const rest = cells.slice(1).join(' | ');
  const verdict = verdictOf(rest);
  return verdict ? { subject: cells[0], verdict, detail: rest } : null;
}

/**
 * Does this paragraph state a gap, in any of the spellings the chapters use?
 *
 * Seven of them, found by running this over the corpus and looking at what was
 * left: `**Gap.** \`X\` — …`, `**Gap — \`X\`.**`, `**Gap:** \`X\``,
 * `**Gap: X.**` with no backticks, a `### Gap` table, the editing chapter's
 * bare `→ \`X\`` arrow, and a lone sentence — "Covered in §11.5. \`PARTIAL\`
 * (auto colours, no names)." Each was a section reading as nothing to check.
 */
const isGapParagraph = (text) => /\*\*Gap\b|\bGap[:.]\s*\*{0,2}`?/.test(text);

/**
 * A one-line verdict with no scaffolding around it.
 *
 * Bounded by length so a long narrative paragraph mentioning an outcome does
 * not become a claim: a claim stated this way is a sentence and a parenthesis.
 */
const isBareVerdict = (text) =>
  text.length <= 200 && new RegExp(`\`?\\*{0,2}(?:${V})\\*{0,2}\`?`).test(text);

/**
 * The editing chapter's fifth spelling.
 *
 * A bare `→ \`PARTIAL\`: …` closing a paragraph that opened with a bolded
 * subject — `**Move.**`, `**Size.**`, `**Audio Event volume envelope…**`. It
 * carries no "Gap" word at all, which is how §2.1 came to hold six verdicts and
 * yield none.
 */
const ARROW_RE = /(^|\s)→\s*`?\*{0,2}(PARITY|PARTIAL|MISSING|DIVERGENT)/;

/** `**Move.** FSP8: …` → `Move`, the subject an arrow verdict belongs to. */
const boldSubject = (text) => /^\s*\*\*([^*]{1,60}?)\.?\*\*/.exec(text)?.[1] ?? null;

/**
 * Every claim in every chapter, and every section that states a verdict.
 *
 * `id` is `chapter/section#subject`, built from the document's own structure,
 * so it survives an edit to the surrounding prose but not a renamed section.
 * That is the right sensitivity: a renamed section is a claim that moved, and
 * somebody should say where it went.
 */
export function readClaims() {
  const files = readdirSync(join(ROOT, DIR))
    .filter((f) => /^fsp8-parity-.*\.md$/.test(f))
    .sort();

  const claims = [];
  /** Sections that mention a verdict, and whether any claim came out of them. */
  const sections = new Map();

  for (const file of files) {
    const chapter = file.replace(/^fsp8-parity-|\.md$/g, '');
    const lines = readFileSync(join(ROOT, DIR, file), 'utf8').split(/\r?\n/);
    let heading = '(preamble)';
    let headingLine = 1;
    const seen = new Map();

    /*
     * Every section's own body, kept so the evidence in it can be read.
     *
     * The audit records what it looked at as well as what it concluded, and
     * that is the half this repository can settle. Collected here rather than
     * re-read later because a claim's evidence is the *section's* prose — the
     * "MotionLab does" paragraph above the verdict — not the verdict line.
     */
    const sectionId = () => `${chapter}/${heading}`;
    const sectionAt = () => {
      const id = sectionId();
      let s = sections.get(id);
      if (!s) {
        s = { id, file: `${DIR}/${file}`, line: headingLine, claims: 0, mentions: 0, text: '' };
        sections.set(id, s);
      }
      return s;
    };
    const note = (key) => {
      sectionAt()[key] += 1;
    };
    const collect = (line) => {
      sectionAt().text += `${line}\n`;
    };

    const add = (subject, verdict, detail, line) => {
      let id = `${chapter}/${heading}#${slug(subject)}`;
      // Two claims that slug the same are numbered in document order rather
      // than merged: they are different claims, and merging hides one.
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      if (n > 1) id = `${id}~${n}`;
      claims.push({
        id,
        section: sectionId(),
        file: `${DIR}/${file}`,
        chapter,
        line,
        verdict,
        what: detail.slice(0, 150),
      });
      note('claims');
    };

    let para = [];
    let paraLine = 0;
    const flushParagraph = () => {
      if (para.length === 0) return;
      const text = para.join(' ');
      const body = para;
      para = [];
      // The legend test reads the paragraph as lines, because a key is a
      // *list* — one verdict defined per bullet. Joining first and testing the
      // join was why three legends read as claims and one chapter's summary
      // read as none.
      if (!VERDICT_RE.test(text) || isLegend(body.join('\n'))) return;
      note('mentions');

      const arrow = ARROW_RE.test(text);
      if (isGapParagraph(text) || arrow) {
        // A gap paragraph can carry more than one verdict — "`MISSING` for (b)
        // and for (c)" — and they are one claim about one subject. The subject
        // of an arrow verdict is the bold label the paragraph opened with, so
        // §2.1's six read as Move, Size, Fades rather than as gap~2 … gap~6.
        const subject = arrow ? (boldSubject(text) ?? 'gap') : 'gap';
        add(subject, verdictOf(text), body[0].replace(/^\s*3\.\s*/, '').trim(), paraLine);
        return;
      }

      /*
       * A bulleted round-up, where each bullet is its own verdict.
       *
       * The recording chapter closes §10 with nine of them — "Loop recording:
       * **MISSING**", "Record Takes to Layers: **MISSING** (no layers)" — and a
       * paragraph-level parser collapses all nine into one claim or, as it did,
       * into none. They are the chapter's own summary of what is absent, which
       * makes them the last claims that should go unread.
       */
      const bullets = body.filter((l) => /^\s*[-*]\s/.test(l) && VERDICT_RE.test(l));
      if (bullets.length > 0) {
        for (const b of bullets) {
          const before = b.replace(/^\s*[-*]\s*/, '').split(VERDICT_RE)[0];
          add(slug(before) || 'gap', verdictOf(b), b.trim(), paraLine);
        }
        return;
      }
      // The eighth spelling: a bolded verdict sentence closing a paragraph —
      // "**PARITY on the notation model.**". Narrow on purpose; a verdict word
      // inside ordinary prose is a mention, and this asks for the emphasis the
      // author put on it.
      const bolded = new RegExp(`\\*\\*(?:${V})\\b[^*]{0,80}\\*\\*`).test(text);
      if (bolded || isBareVerdict(text)) add('gap', verdictOf(text), body[0].trim(), paraLine);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const h = /^(#{2,4})\s+(.*)$/.exec(line);
      if (!h) collect(line);
      if (h) {
        flushParagraph();
        // A `### Gap` heading is a section's verdict table, not a new subject —
        // its rows belong to the section above it.
        if (!/^gap\b/i.test(h[2].trim())) {
          heading = slug(h[2]);
          headingLine = i + 1;
        }
        continue;
      }
      if (isTable(line)) {
        flushParagraph();
        if (!VERDICT_RE.test(line) || isLegend(line)) continue;
        note('mentions');
        const row = tableRow(line);
        if (row) add(row.subject, row.verdict, `${row.subject} — ${row.detail}`, i + 1);
        continue;
      }
      if (line.trim() === '') {
        flushParagraph();
        continue;
      }
      if (para.length === 0) paraLine = i + 1;
      para.push(line);
    }
    flushParagraph();
  }

  /*
   * A section that names verdicts and yielded none is the failure mode: a
   * notation nobody taught the parser, reading as nothing to check.
   */
  const unread = [...sections.values()].filter((s) => s.mentions > 0 && s.claims === 0);
  return { claims, unread, sections };
}

/** Counts by verdict, for the guard's summary line. */
export function tally(claims) {
  const out = {};
  for (const c of claims) out[c.verdict] = (out[c.verdict] ?? 0) + 1;
  return out;
}
