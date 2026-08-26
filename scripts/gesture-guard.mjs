/**
 * A reachability claim made without a hand is not a reachability claim.
 *
 *   node scripts/gesture-guard.mjs          # fail on an unargued gesture
 *   node scripts/gesture-guard.mjs --list   # what is registered, and why
 *
 * `el.click()` invokes a handler. It does not ask whether anything is on top
 * of the element, whether it can be seen, whether it is on screen, or whether
 * the gesture a person makes would arrive — so a control that is covered,
 * transparent, clipped, or that moves out from under the press is clicked
 * exactly as happily as one that works. Three defects reached users behind a
 * passing test that used it: the drum rack's Insert button, which re-laid out
 * 107px between `pointerdown` and `pointerup`; the device options button on
 * touch, which was `opacity: 0` with hover the only rule that revealed it; and
 * the same button wrapping onto a second line, on top of the Insert button.
 *
 * The same shape one step over: `hasTouch: true` makes `(pointer: coarse)`
 * match, and Playwright's `click()` still sends a **mouse**. A spec can be
 * measuring a phone while pressing it with a pointer no phone has — which is
 * how `longPress` came to be dead in the reachability sweep, since it returns
 * immediately unless `e.pointerType === 'touch'`.
 *
 * Neither is a mistake. Both are the right tool for arranging a fixture, and
 * both are wrong for a claim. So this does not ban them: it requires that each
 * one has been argued for, in writing, at the site. The reason is never
 * inspected — having to write one is the mechanism, the same as `MW_SCOPE_ALSO`
 * in CLAUDE.md.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LIST = process.argv.includes('--list');

/**
 * A press that skips the browser's own hit test, and why it may.
 *
 * Keyed by `file:line-ish` — the file and the enclosing function or comment
 * are what identify it, because line numbers move. Each entry names what the
 * site is doing and why a real pointer is the wrong tool there. Every one of
 * these is a *fixture step*: getting the app into the state a claim is about
 * to be made against. None of them is the claim.
 */
const SCRIPTED = [
  {
    file: 'e2e/devicewindow.spec.ts',
    what: 'addDevice and offeredKinds open the picker; the window drag dispatches its own pointer events',
    why: 'the picker is a fixture step, and a drag whose move events go to `window` by design cannot be expressed as a locator press',
  },
  {
    file: 'e2e/devicemenu.spec.ts',
    what: 'addDevice opens the picker',
    why: 'arranging the fixture; every claim in that file goes through e2e/pointer.ts',
  },
  {
    file: 'e2e/orientation.spec.ts',
    what: 'openFirstDevice opens the picker',
    why: 'documented at the site: a real press there would make the test flaky about RA-006',
  },
  {
    file: 'scripts/overflow-audit.mjs',
    what: 'openPicker falls back after two real presses fail',
    why: 'the fallback is recorded in the report, so the sweep says "unclickable" rather than working around it',
  },
  {
    file: 'scripts/reach/menus.mjs',
    what: 'pressAndHold dispatches its own pointer sequence',
    why: 'the pointerType is the subject — Playwright mouse.down() sends a mouse even with hasTouch',
  },
  {
    file: 'e2e/app.spec.ts',
    what: 'a piano key pressed and released by dispatched pointer events',
    why: 'the note-off path is what is being asserted, and it needs the two events apart',
  },
];

/**
 * A file that opens a touch context and presses it with a mouse.
 *
 * Legitimate when nothing is being *claimed* about touch — a spec that
 * measures boxes on a phone viewport is measuring geometry, and geometry has
 * no pointerType. It stops being legitimate the moment the press is the point.
 */
const MOUSE_ON_TOUCH = [
  {
    file: 'e2e/orientation.spec.ts',
    why: 'measures geometry — row counts, hit areas, sheet insets. The presses are navigation.',
  },
  {
    file: 'e2e/motionwave-face.spec.ts',
    why: 'Cell 26 measures every control on every panel; the presses open panels rather than assert them',
  },
  {
    file: 'scripts/overflow-audit.mjs',
    why: 'an overflow sweep: what it asserts is that nothing is clipped, which no press decides',
  },
];

/** Every `.ts`/`.mjs` under a root, recursively. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|mjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/**
 * Two files hold this idiom as *text* rather than running it.
 *
 * This one describes the idioms in order to forbid them, and
 * `scripts/checks/mutants.mjs` holds, as a string literal, the scripted press
 * that proves this guard can fail — so the guard fired on the mutation written
 * to prove it fires. Named rather than pattern-matched: an exemption that
 * matches a pattern is an exemption somebody else can fall into.
 */
const NOT_CODE = new Set(['scripts/gesture-guard.mjs', 'scripts/checks/mutants.mjs']);

const FILES = [...walk('e2e'), ...walk('scripts')].filter((f) => !NOT_CODE.has(f));

/**
 * A scripted click, or a hand-dispatched event.
 *
 * Matched as "this line both evaluates in the page and clicks" rather than by
 * trying to parse the arrow function: the first version of this pattern used
 * `[^)]*` for the parameter list, which cannot cross the closing paren of
 * `(el: HTMLElement)` — so it silently matched none of the typed call sites,
 * which is every one of them in `e2e/`. A guard that matches nothing reports
 * a clean sweep.
 */
const SCRIPTED_PRESS = [
  (l) => l.includes('.evaluate(') && l.includes('.click()'),
  // Pointer and mouse events only. A `DragEvent` dispatched at a pad is not a
  // press with the hit test skipped — it is the only way to deliver a
  // `DataTransfer`, and what those cases assert is what the drop handler does
  // with it. Widening this to every synthetic event would have collected two
  // file-drop specs that have no pointer sequence to drive in the first place.
  (l) => /dispatchEvent\(\s*new (Pointer|Mouse)Event/.test(l),
  (l) => /\.dispatchEvent\(\s*['"](pointer|mouse)/.test(l),
];
/** A press that goes through the browser's hit test, as a mouse. */
const MOUSE_PRESS = /\.(click|dblclick)\(|page\.mouse\./;
/** A press that goes through it as a finger. */
const TOUCH_PRESS = /\.tap\(|touchscreen/;
/** A comment line describes an idiom; it does not use one. */
const IS_COMMENT = /^\s*(\*|\/\/|\/\*)/;

const problems = [];
const seenScripted = new Set();
const seenMouseOnTouch = new Set();

for (const file of FILES) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    // A line inside a block comment is describing the idiom, not using it.
    if (IS_COMMENT.test(lines[i])) continue;
    if (!SCRIPTED_PRESS.some((match) => match(lines[i]))) continue;
    const entry = SCRIPTED.find((e) => e.file === file);
    if (!entry) {
      problems.push(
        `${file}:${i + 1} presses without the browser's hit test:\n      ${lines[i].trim()}\n` +
          '      A press that skips the hit test cannot say a control is reachable. Either drive a\n' +
          '      real pointer through `e2e/pointer.ts`, or add this file to SCRIPTED in\n' +
          '      scripts/gesture-guard.mjs with the reason it is a fixture step and not a claim.',
      );
      continue;
    }
    seenScripted.add(entry.file);
  }

  // Rule two: the hand has to match the form factor being claimed.
  //
  // `hasTouch: form.touch` counts. The flag is often computed from a form
  // factor table — which is the *right* shape — and a guard that only knew the
  // literal would have exempted every sweep that enumerates its form factors,
  // meaning every sweep that could have this defect. Comment lines are dropped
  // first: three files discuss `hasTouch` without ever setting it.
  const code = lines.filter((l) => !IS_COMMENT.test(l));
  const claimsTouch = code.some((l) => /hasTouch:\s*(?!false)\S/.test(l));
  const pressesWithMouse = code.some((l) => MOUSE_PRESS.test(l));
  const pressesWithFinger = code.some((l) => TOUCH_PRESS.test(l));
  // A spec whose presses go through `e2e/pointer.ts` is pressing with the hand
  // it declared — `reach()` takes the hand as an argument and calls `tap()` for
  // touch. Without this the helper's own users would be the files this rule
  // fires on, which is precisely backwards.
  const viaHelper = /from '\.\/pointer'/.test(src);
  if (claimsTouch && pressesWithMouse && !pressesWithFinger && !viaHelper) {
    const entry = MOUSE_ON_TOUCH.find((e) => e.file === file);
    if (!entry) {
      problems.push(
        `${file} opens a touch context and presses it with a mouse.\n` +
          '      `hasTouch: true` makes `(pointer: coarse)` match, and `click()` still sends a mouse —\n' +
          '      so a handler gated on `pointerType === "touch"` never runs and the case proves nothing\n' +
          '      about the form factor it names. Use `tap()`, or register it in MOUSE_ON_TOUCH with the\n' +
          '      reason no claim here depends on the hand.',
      );
    } else {
      seenMouseOnTouch.add(entry.file);
    }
  }
}

/*
 * A stale entry is the same failure pointing the other way.
 *
 * An exemption that outlives the thing it exempts is an exemption nobody can
 * see is unused, and the next scripted press in that file inherits it silently.
 * Exactly the drift `parity-guard`'s anchors exist to catch.
 */
for (const e of SCRIPTED) {
  if (!seenScripted.has(e.file)) {
    problems.push(
      `${e.file} is registered in SCRIPTED ("${e.what}") and no longer contains a scripted press. ` +
        'Drop the entry — leaving it exempts whatever lands there next.',
    );
  }
}
for (const e of MOUSE_ON_TOUCH) {
  if (!seenMouseOnTouch.has(e.file)) {
    problems.push(
      `${e.file} is registered in MOUSE_ON_TOUCH and no longer presses a touch context with a mouse. ` +
        'Drop the entry.',
    );
  }
}

/*
 * The helper itself must be reached by something.
 *
 * `tsconfig.e2e.json` was correct and invoked by nothing for four directives,
 * and its existence is what stopped anybody asking. A pointer helper that no
 * spec imports is the same object: it would make every claim in this file look
 * satisfied while nothing drove a real gesture at all.
 */
const HELPER = 'e2e/pointer.ts';
const users = FILES.filter(
  (f) => f !== HELPER && /from '\.\/pointer'/.test(readFileSync(join(ROOT, f), 'utf8')),
);
if (users.length === 0) {
  problems.push(
    `${HELPER} is imported by no spec. It is the only thing in this repository that lands a press ` +
      'on coordinates with a declared pointerType; unused, this guard is checking an idiom nobody uses.',
  );
}

if (LIST) {
  console.log('Scripted presses, registered as fixture steps:\n');
  for (const e of SCRIPTED) console.log(`  ${e.file}\n      ${e.what} — ${e.why}`);
  console.log('\nTouch contexts pressed with a mouse, registered:\n');
  for (const e of MOUSE_ON_TOUCH) console.log(`  ${e.file}\n      ${e.why}`);
  console.log(`\n${HELPER} is imported by: ${users.map((u) => relative('e2e', u)).join(', ')}`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error('gesture-guard: a press that cannot support the claim above it.\n');
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}
console.log(
  `gesture-guard: ${FILES.length} file(s) swept — ${SCRIPTED.length} scripted press site(s) and ` +
    `${MOUSE_ON_TOUCH.length} mouse-on-touch file(s), each with a reason; ${users.length} spec(s) ` +
    'drive a real pointer through e2e/pointer.ts.',
);
