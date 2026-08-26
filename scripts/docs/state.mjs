// The shapes a record of product state takes in a markdown file.
//
// A narrative document is allowed to say anything about the world, about a
// decision, or about somebody else's product. What it may not do is record
// what *this* product currently is, because nothing then checks it and it goes
// quietly wrong — which is how `docs/design/lib-voice-substrate.md` came to
// say "No implementation exists" while two of its files were in the tree.
//
// So this looks for the shapes rather than for the words. A verdict in a table
// cell, a checklist box, a status sentence that makes an implementation claim.
// Prose that happens to contain "shipping" is not a record; a table row whose
// last cell is `SHIPPING` is.

const VERDICT =
  'PASS|FAIL|MISSING|PARTIAL|SHIPPING|NOT STARTED|STARTED|DONE|CLOSED|OPEN|BLOCKED|TODO|WIP';

/** A table row whose final cell is a bare verdict and nothing else. */
const VERDICT_CELL = new RegExp(`\\|\\s*(?:\\*\\*)?(?:${VERDICT})(?:\\*\\*)?\\s*\\|`);

/**
 * A *ticked* checklist box.
 *
 * An empty box is an instruction — `docs/RELEASE-CHECKLIST.md` is thirty of
 * them and records nothing, which is why it is a procedure and not a report.
 * A ticked one is a claim that a named thing was done, with nothing behind it
 * but somebody's memory of ticking it.
 */
const CHECKBOX = /^\s*[-*]\s+\[[xX]\]/;

/**
 * A status sentence that claims something about whether code exists.
 *
 * An ADR's `**Status:** Accepted` is the *document's* status and is fine — it
 * says nothing about the tree. `**Status:** design only. No implementation
 * exists` says something about the tree, and it was wrong.
 */
const IMPLEMENTATION_CLAIM =
  /\b(no implementation exists|not yet implemented|nothing here is built|is not built|already built|now implemented|is implemented|now shipping|is shipping|none may be written)\b/i;

/** Lines inside a fenced code block are examples, not records. */
function* codeAware(text) {
  let fenced = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) yield { line, n: i + 1 };
  }
}

/**
 * Every place a document records product state, with the line and the reason.
 *
 * Reported rather than thrown so the caller can list all of them at once: a
 * guard that names the first offending line makes the reader run it twenty
 * times to find out how much work there is.
 */
export function stateRecords(text) {
  const found = [];
  for (const { line, n } of codeAware(text)) {
    if (VERDICT_CELL.test(line)) {
      found.push({
        n,
        why: 'a table cell holding a bare verdict',
        text: line.trim().slice(0, 110),
      });
    } else if (CHECKBOX.test(line)) {
      found.push({ n, why: 'a checklist box', text: line.trim().slice(0, 110) });
    } else if (/^\*\*Status/.test(line) && IMPLEMENTATION_CLAIM.test(line)) {
      found.push({
        n,
        why: 'a status line claiming what does or does not exist in the tree',
        text: line.trim().slice(0, 110),
      });
    }
  }
  return found;
}

/** Exposed so `--self-test` can prove the detector still detects. */
export const PATTERNS = { VERDICT_CELL, CHECKBOX, IMPLEMENTATION_CLAIM };
