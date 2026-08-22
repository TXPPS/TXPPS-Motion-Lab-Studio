/**
 * Responsive overflow audit.
 *
 * A user reported "tracks are having UI issues cutting off certain portions"
 * from a phone, and the only evidence was a screenshot of one panel. Finding
 * the rest of that class of bug by taking more screenshots does not scale: a
 * DAW has six workspaces, four pages and three layouts, and a clipped control
 * is invisible precisely because it is clipped. So this walks the real DOM at
 * each viewport and asks the questions a person cannot ask by eye — is this
 * box wider than the space it was given, and if so can anyone reach the part
 * that fell off the end?
 *
 * Four questions are asked of every element on every surface:
 *
 *   1. Does its content overflow horizontally while its own `overflow-x` is
 *      `visible`, `hidden` or `clip`? Those are the two ways content goes
 *      missing: cut at the box edge, or painted over whatever sits beside it.
 *   2. Does its border box cross the right edge of the viewport? That is the
 *      reported bug — a control the screen has no room for.
 *   3. Is it a clipping box with truncated text but no `text-overflow:
 *      ellipsis`? Text that stops mid-word reads as a rendering fault; an
 *      ellipsis reads as a name that is longer than the column.
 *   4. Is it an interactive control smaller than 32x32 CSS px? Advisory only —
 *      a DAW legitimately has small controls — but worth a list on phones.
 *
 * Anything reachable by scrolling is deliberately NOT a finding. An element
 * whose own `overflow-x` is `auto`/`scroll` is a scroller doing its job, and
 * content that spills inside such a scroller can still be brought into view,
 * so the ancestor chain is checked before a spill is reported. Without that
 * filter the arrangement timeline alone would bury every real defect.
 *
 * Findings are de-duplicated by a class-only DOM path, so a component that
 * repeats twenty-seven times in a list reports once, with a count.
 *
 *   npm run preview &        # already running on 4173 in CI and dev boxes
 *   AUDIT_JSON=/tmp/overflow.json node scripts/overflow-audit.mjs
 *
 * Env: AUDIT_JSON (output path, default audit-out/overflow-audit.json),
 * AUDIT_BASE (default http://localhost:4173), AUDIT_THEME (dark|light|contrast,
 * default light — the theme the bug was reported in), AUDIT_SETTLE (ms to wait
 * after each click), AUDIT_ONLY (substring filter on "<viewport>/<surface>",
 * for re-checking one fix without a full run).
 *
 * The JSON is sorted and free of coordinates that jitter between runs, so two
 * runs can be diffed to prove a fix removed findings and added none.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4173';
const JSON_OUT = process.env.AUDIT_JSON ?? 'audit-out/overflow-audit.json';
const THEME = process.env.AUDIT_THEME ?? 'light';
const SETTLE = Number(process.env.AUDIT_SETTLE ?? 350);
const ONLY = (process.env.AUDIT_ONLY ?? '').trim();

/**
 * The viewports worth defending. The three phones are the narrowest device in
 * common use, the reference iPhone, and the wide iPhone the bug was reported
 * from; the two tablets straddle the 1024px boundary in `useViewport`; the
 * desktop entry is the smallest laptop the desktop layout claims to support,
 * which is where its pixel minimums are tightest.
 */
const VIEWPORTS = [
  { name: 'phone-360x740', w: 360, h: 740 },
  { name: 'phone-390x844', w: 390, h: 844 },
  { name: 'phone-430x932', w: 430, h: 932 },
  { name: 'tablet-768x1024', w: 768, h: 1024 },
  { name: 'tablet-834x1112', w: 834, h: 1112 },
  { name: 'desktop-1280x800', w: 1280, h: 800 },
];

const BROWSER_TABS = ['projects', 'instruments', 'effects', 'loops', 'samples', 'pool'];
const EDITOR_TABS = ['mixer', 'piano', 'drums', 'score', 'audio', 'chords', 'synth', 'diagnostics'];
const PHONE_MODES = ['arrange', 'record', 'perform', 'edit', 'mix', 'browse'];

/** Back to the workstation, which every surface below is reached from. */
const TO_SONG = { click: '[data-testid="page-song"]' };

/**
 * Which surfaces exist depends on the layout the app chose for the viewport,
 * not on the viewport itself — the same 768px width is a tablet in portrait
 * and a phone in a short landscape window. So the layout is read back off the
 * shell (`.app[data-layout]`) and the surface list is built from that, which
 * also means this file cannot drift from `useViewport`'s breakpoints.
 *
 * Every surface declares which selection it needs (`prime`). The Inspector is
 * three different panels depending on what is selected — nothing, a track, or
 * a clip — and the insert rack the bug was reported against only exists in the
 * track one, so both are visited. The list is ordered `track` before `clip`
 * because opening a clip is a one-way gesture in this UI: clearing a clip
 * selection again needs a drag on empty timeline, which is not a thing a
 * scripted click can do reliably.
 */
function surfacesFor(layout) {
  const workspace = [];
  const browser = [];
  const editors = [];

  if (layout === 'phone') {
    for (const m of PHONE_MODES) {
      workspace.push({
        id: `song-${m}`,
        prime: 'track',
        steps: [TO_SONG, { click: `[data-testid="nav-${m}"]` }],
        expect: `[data-testid="phone-mode-${m}"]`,
      });
    }
    for (const t of BROWSER_TABS) {
      browser.push({
        id: `browser-${t}`,
        prime: 'track',
        steps: [
          TO_SONG,
          { click: '[data-testid="nav-browse"]' },
          { click: `[data-testid="browser-tab-${t}"]` },
        ],
        expect: '[data-testid="browser-panel"]',
      });
    }
    editors.push(
      {
        id: 'song-edit-clip',
        prime: 'clip',
        steps: [TO_SONG, { click: '[data-testid="nav-edit"]' }],
        expect: '[data-testid="phone-mode-edit"]',
      },
      {
        id: 'inspector-clip',
        prime: 'clip',
        steps: [TO_SONG, { click: '[data-testid="nav-browse"]' }],
        expect: '[data-testid="inspector"]',
      },
    );
  } else if (layout === 'tablet') {
    for (const c of ['mixer', 'synth']) {
      workspace.push({
        id: `song-${c}`,
        prime: 'track',
        steps: [TO_SONG, { click: `[data-testid="combo-${c}"]` }],
        expect: '[data-testid="bottom-editor"]',
      });
    }
    workspace.push({
      id: 'song-maxi-editor',
      prime: 'track',
      steps: [TO_SONG, { click: '[data-testid="maximize-editor"]' }],
      expect: '[data-testid="maxi-editor"]',
      close: [{ click: '[data-testid="maximize-editor"]' }],
    });
    workspace.push({
      id: 'drawer-inspector-track',
      prime: 'track',
      steps: [TO_SONG, { click: '[data-testid="tablet-inspector"]' }],
      expect: '[data-testid="inspector"]',
      close: [{ click: '.drawer [aria-label="Close panel"]' }],
    });
    for (const t of BROWSER_TABS) {
      browser.push({
        id: `browser-${t}`,
        prime: 'track',
        steps: [
          TO_SONG,
          { click: '[data-testid="tablet-browser"]' },
          { click: `[data-testid="browser-tab-${t}"]` },
        ],
        expect: '[data-testid="browser-panel"]',
        close: [{ click: '.drawer [aria-label="Close panel"]' }],
      });
    }
    editors.push(
      {
        id: 'song-piano-clip',
        prime: 'clip',
        steps: [TO_SONG, { click: '[data-testid="combo-piano"]' }],
        expect: '[data-testid="bottom-editor"]',
      },
      {
        id: 'drawer-inspector-clip',
        prime: 'clip',
        steps: [TO_SONG, { click: '[data-testid="tablet-inspector"]' }],
        expect: '[data-testid="inspector"]',
        close: [{ click: '.drawer [aria-label="Close panel"]' }],
      },
    );
  } else {
    // The desktop layout shows the browser, the arrangement, the bottom editor
    // and the inspector at once, so every editor tab is also an inspector probe.
    for (const t of ['mixer', 'chords', 'synth', 'diagnostics']) {
      workspace.push({
        id: `song-editor-${t}`,
        prime: 'track',
        steps: [TO_SONG, { click: `[data-testid="editor-tab-${t}"]` }],
        expect: '[data-testid="bottom-editor"]',
      });
    }
    for (const t of BROWSER_TABS) {
      browser.push({
        id: `browser-${t}`,
        prime: 'track',
        steps: [TO_SONG, { click: `[data-testid="browser-tab-${t}"]` }],
        expect: '[data-testid="browser-panel"]',
      });
    }
    for (const t of EDITOR_TABS.filter(
      (e) => !['mixer', 'chords', 'synth', 'diagnostics'].includes(e),
    )) {
      editors.push({
        id: `song-editor-${t}`,
        prime: 'clip',
        steps: [TO_SONG, { click: `[data-testid="editor-tab-${t}"]` }],
        expect: '[data-testid="bottom-editor"]',
      });
    }
  }

  const pages = [
    {
      id: 'page-start',
      prime: 'track',
      steps: [{ click: '[data-testid="page-start"]' }],
      expect: '[data-testid="start-page"]',
    },
    {
      id: 'page-mastering',
      prime: 'track',
      steps: [{ click: '[data-testid="page-mastering"]' }],
      expect: '[data-testid="mastering-page"]',
    },
    {
      id: 'page-show',
      prime: 'track',
      steps: [{ click: '[data-testid="page-show"]' }],
      expect: '[data-testid="show-page"]',
    },
    {
      id: 'page-show-stage',
      prime: 'track',
      steps: [{ click: '[data-testid="page-show"]' }, { click: '[data-testid="stage-mode"]' }],
      expect: '[data-testid="show-page"]',
      close: [{ click: '[data-testid="stage-mode"]' }],
    },
  ];

  /*
   * The sheets are opened through the overflow menu on every layout rather
   * than through the topbar icons, because those icons exist only on tablet
   * and desktop — the menu is the one route a phone user actually has.
   */
  const sheets = [
    {
      id: 'sheet-preferences',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Preferences' }],
      expect: '[data-testid="settings-sheet"]',
      close: [{ key: 'Escape' }],
    },
    {
      id: 'sheet-export',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Export…' }],
      expect: '[data-testid="export-sheet"]',
      close: [{ key: 'Escape' }],
    },
    {
      id: 'sheet-shortcuts',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Keyboard shortcuts' }],
      expect: '[data-testid="shortcuts-sheet"]',
      close: [{ key: 'Escape' }],
    },
    {
      id: 'sheet-diagnostics',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Diagnostics' }],
      expect: '[data-testid="diagnostics-sheet"]',
      close: [{ click: '[aria-label="Close diagnostics"]' }],
    },
  ];

  return [...workspace, ...browser, ...pages, ...sheets, ...editors];
}

/**
 * The measurement, run inside the page.
 *
 * Everything it needs is in its arguments: Playwright serializes the function
 * source, so it can close over nothing from this module.
 */
const probe = () => {
  const vw = document.documentElement.clientWidth;
  const MIN_TAP = 32;
  const SLOP = 1; // sub-pixel rounding is not a defect

  const classesOf = (el) => {
    const raw = typeof el.className === 'string' ? el.className : el.getAttribute('class') || '';
    return raw.split(/\s+/).filter(Boolean);
  };

  /** Human-readable location: nearest testid ancestor, then classes below it. */
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 6; n = n.parentElement) {
      const tid = n.getAttribute('data-testid');
      // React's useId values (":r7:") are testids only by accident — they say
      // nothing about the component and change between builds.
      if (tid && !/^:r/.test(tid)) {
        parts.unshift(`[data-testid="${tid}"]`);
        break;
      }
      const cls = classesOf(n).slice(0, 3);
      parts.unshift(n.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''));
      if (n === document.body) break;
    }
    return parts.join(' > ');
  };

  /*
   * The de-duplication key. Testids are deliberately excluded: they carry the
   * project name, the track name or a list index, so a row that repeats for
   * every effect in a rack would otherwise report twenty-seven times. Classes
   * are what identify the component.
   */
  const sigOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      const cls = classesOf(n).slice(0, 3);
      parts.unshift(n.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''));
      if (n === document.body) break;
    }
    return parts.join(' > ');
  };

  /*
   * Can a user still get to content that left this element's box? Yes if any
   * ancestor is actually scrolled-able horizontally. `overflow-x: auto` on a
   * box with nothing to scroll is not an escape hatch, hence the scrollWidth
   * test rather than just reading the property.
   */
  const reachableByScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };

  const hasOwnText = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim().length > 1) return true;
    }
    return false;
  };

  const label = (el) =>
    (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48);

  const INTERACTIVE =
    'a[href],button,select,textarea,summary,input:not([type="hidden"]),' +
    '[role="button"],[role="menuitem"],[role="tab"],[role="switch"],[role="checkbox"],' +
    '[tabindex]:not([tabindex="-1"])';

  const out = [];
  /*
   * When a whole subtree hangs off the right edge, only the outermost box is
   * the bug — its children are just along for the ride. This remembers the
   * right edge of each reported ancestor so a child with the same edge is
   * suppressed, which turns a fifteen-line cascade into one actionable line.
   */
  const reportedRight = new WeakMap();
  const ancestorAlreadyPastEdge = (el, right) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const r = reportedRight.get(p);
      if (r !== undefined && Math.abs(r - right) <= 2) return true;
    }
    return false;
  };

  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const rect = el.getBoundingClientRect();
    /*
     * A screen-reader-only label is a 1x1 box holding a whole sentence, so it
     * overflows by definition and would top the report every single time. It
     * is not a layout defect — it is the standard way to say something to
     * assistive technology and nothing to the screen — so anything shrunk to
     * near-nothing, or clipped away with the `inset(50%)` idiom, is skipped.
     */
    if (rect.width < 2 || rect.height < 2) continue;
    if (cs.clipPath === 'inset(50%)') continue;

    const ox = cs.overflowX;
    const scrollable = ox === 'auto' || ox === 'scroll';
    const over = el.scrollWidth - el.clientWidth;

    // 1 + 3: content wider than the box, with no scrollbar of its own.
    if (!scrollable && over > SLOP && el.clientWidth > 0) {
      const clipped = ox === 'hidden' || ox === 'clip';
      if (clipped || !reachableByScroll(el)) {
        out.push({
          kind: clipped ? 'clipped' : 'spill',
          sel: cssPath(el),
          sig: sigOf(el),
          text: label(el),
          over: Math.round(over),
          boxW: Math.round(rect.width),
          overflowX: ox,
          /*
           * A one-line label cut off with an ellipsis is a deliberate design
           * decision — a name longer than its column — not a defect. Recorded
           * so the report can sort those below the hard cuts instead of
           * burying eleven real bugs under sixty intended ones.
           */
          ellipsis: cs.textOverflow === 'ellipsis' && cs.whiteSpace.startsWith('nowrap'),
        });
      }
      if (clipped && hasOwnText(el) && cs.textOverflow !== 'ellipsis') {
        out.push({
          kind: 'truncated',
          sel: cssPath(el),
          sig: sigOf(el),
          text: label(el),
          over: Math.round(over),
          boxW: Math.round(rect.width),
          overflowX: ox,
          whiteSpace: cs.whiteSpace,
        });
      }
    }

    // 2: the box itself crosses the right edge of the screen.
    const right = Math.round(rect.right);
    if (rect.right > vw + SLOP && rect.left < vw && !reachableByScroll(el)) {
      if (!ancestorAlreadyPastEdge(el, right)) {
        reportedRight.set(el, right);
        out.push({
          kind: 'viewport',
          sel: cssPath(el),
          sig: sigOf(el),
          text: label(el),
          over: Math.round(rect.right - vw),
          boxW: Math.round(rect.width),
          overflowX: ox,
        });
      }
    }

    // 4: advisory tap-target size.
    if (
      cs.pointerEvents !== 'none' &&
      el.matches(INTERACTIVE) &&
      (rect.width < MIN_TAP || rect.height < MIN_TAP)
    ) {
      out.push({
        kind: 'tap',
        sel: cssPath(el),
        sig: sigOf(el),
        text: label(el),
        boxW: Math.round(rect.width),
        boxH: Math.round(rect.height),
      });
    }
  }

  const de = document.documentElement;
  return {
    viewportWidth: vw,
    documentScrolls: de.scrollWidth > de.clientWidth + SLOP,
    findings: out,
  };
};

/* ---------------------------------------------------------------- driving -- */

async function settle(page, ms = SETTLE) {
  await page.waitForTimeout(ms);
}

/**
 * Run one step. A step that finds nothing is reported and skipped rather than
 * failing the run: a surface that does not exist at this viewport is
 * information, and the other hundred-odd probes are still worth having.
 */
async function runStep(page, step, notes) {
  if (step.key) {
    await page.keyboard.press(step.key);
    await settle(page, 200);
    return;
  }
  if (step.menu) {
    const opener = page.locator('[data-testid="topbar-overflow"]');
    if (!(await opener.count())) {
      notes.push('no overflow menu button');
      return;
    }
    await opener.first().click();
    await settle(page, 200);
    const item = page.locator(`.ctx-menu [role="menuitem"]:has-text("${step.menu}")`).first();
    if (!(await item.count())) {
      notes.push(`no menu item "${step.menu}"`);
      await page.keyboard.press('Escape');
      return;
    }
    await item.click();
    await settle(page);
    return;
  }
  const target = page.locator(step.click).first();
  if (!(await target.count())) {
    notes.push(`no element for ${step.click}`);
    return;
  }
  await target
    .click({ timeout: 4000 })
    .catch((e) => notes.push(`click ${step.click}: ${e.message.split('\n')[0]}`));
  await settle(page);
}

/**
 * Give the app something to inspect.
 *
 * With nothing selected the Inspector shows a project summary: the insert
 * rack, the send rack, the macro panel and the note-FX rack — the widest
 * content any side panel ever holds, and the panel the bug was reported
 * against — never render at all. Selecting a track is what a user does in the
 * first ten seconds, so an audit that skips it measures an empty app.
 *
 * The name, not the header box: a header's centre lands in `.th-controls`,
 * whose mute/solo/arm buttons stop the click from reaching the header's own
 * select handler. Tapping the track's name is what selects it for a user too,
 * so this is the honest gesture rather than a workaround.
 */
async function selectTrack(page, notes) {
  const header = page.locator('[data-testid^="track-header-"]').first();
  if (!(await header.count())) {
    notes.push('no track header to select');
    return;
  }
  const name = header.locator('.th-name').first();
  const target = (await name.count()) ? name : header;
  await target
    .click({ timeout: 4000 })
    .catch((e) => notes.push(`select track: ${e.message.split('\n')[0]}`));
  await settle(page, 250);
}

/**
 * Open a MIDI clip, which is what the piano roll, drum grid and score all
 * require before they render anything but their empty state — and which
 * switches the Inspector to its clip form. A MIDI clip specifically: double
 * clicking an audio clip does not open an editor.
 */
async function openClip(page, notes) {
  const clip = page.locator('.clip[aria-label*="midi clip"]').first();
  if (!(await clip.count())) {
    notes.push('no midi clip to open');
    return;
  }
  await clip
    .dblclick({ timeout: 4000 })
    .catch((e) => notes.push(`open clip: ${e.message.split('\n')[0]}`));
  await settle(page, 400);
}

/**
 * Reporting order, worst first: a control pushed off the screen, then content
 * cut with no ellipsis, then a spill, then the deliberate ellipsis cases, and
 * the advisory tap targets last.
 */
const rank = (f) =>
  ({ viewport: 0, clipped: 1, truncated: 2, spill: 3, tap: 5 })[f.kind] + (f.ellipsis ? 3.5 : 0);

/** Collapse repeats, keep the worst offender of each, and sort for diffing. */
function dedupe(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const key = `${f.kind}|${f.sig}`;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { ...f, count: 1 });
      continue;
    }
    seen.count += 1;
    if ((f.over ?? 0) > (seen.over ?? 0)) {
      seen.over = f.over;
      seen.sel = f.sel;
      seen.text = f.text;
      seen.boxW = f.boxW;
    }
  }
  return [...byKey.values()].sort(
    (a, b) => rank(a) - rank(b) || (b.over ?? 0) - (a.over ?? 0) || a.sig.localeCompare(b.sig),
  );
}

const KIND_LABEL = {
  viewport: 'OFF-SCREEN',
  clipped: 'CLIPPED   ',
  truncated: 'NO-ELLIPS ',
  spill: 'SPILL     ',
  tap: 'TAP-TARGET',
};

const labelFor = (f) => (f.kind === 'clipped' && f.ellipsis ? 'ELLIPSIS  ' : KIND_LABEL[f.kind]);

function printSurface(surfaceId, result) {
  const real = result.findings.filter((f) => f.kind !== 'tap');
  const taps = result.findings.filter((f) => f.kind === 'tap');
  if (!real.length && !taps.length && !result.notes.length && !result.error) return;
  console.log(`  - ${surfaceId}`);
  if (result.error) console.log(`      ! ${result.error}`);
  for (const n of result.notes) console.log(`      . ${n}`);
  if (result.documentScrolls) console.log('      ! the document itself scrolls horizontally');
  for (const f of real) {
    const many = f.count > 1 ? ` x${f.count}` : '';
    const px = f.over !== undefined ? `${String(f.over).padStart(4)}px` : '     ';
    console.log(`      ${labelFor(f)} ${px}${many}  ${f.sel}`);
    if (f.text) console.log(`                          "${f.text}"`);
  }
  if (taps.length) {
    console.log(`      TAP-TARGET (advisory), ${taps.length} distinct:`);
    for (const f of taps.slice(0, 8)) {
      console.log(
        `        ${String(f.boxW).padStart(3)}x${String(f.boxH).padEnd(3)}${f.count > 1 ? ` x${f.count}` : ''}  ${f.sel}`,
      );
    }
    if (taps.length > 8) console.log(`        ... and ${taps.length - 8} more`);
  }
}

/* -------------------------------------------------------------------- run -- */

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const report = { base: BASE, theme: THEME, generated: new Date().toISOString(), viewports: [] };

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  /*
   * The theme is a stored preference, and the welcome card is a stored
   * first-run flag. Both are seeded before the first script runs so the audit
   * measures the workstation rather than a modal on top of it.
   */
  await context.addInitScript((t) => {
    try {
      localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: t, uiScale: 1 }));
      localStorage.setItem('txpps-motionlab-welcome-v1', '1');
    } catch {
      /* storage disabled in this context — defaults are close enough */
    }
  }, THEME);

  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(`${BASE}/#/song`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="app-root"]');
  await settle(page, 1200);

  const layout = await page.getAttribute('[data-testid="app-root"]', 'data-layout');
  const primeNotes = [];
  await selectTrack(page, primeNotes);
  let primed = 'track';

  const vpReport = { name: vp.name, width: vp.w, height: vp.h, layout, surfaces: [] };
  console.log(`\n=== ${vp.name}  (layout: ${layout}) ===`);
  if (primeNotes.length) for (const n of primeNotes) console.log(`  . ${n}`);

  for (const surface of surfacesFor(layout)) {
    if (ONLY && !`${vp.name}/${surface.id}`.includes(ONLY)) continue;
    const notes = [];
    let measured = { findings: [], documentScrolls: false };
    let error = null;
    try {
      if (surface.prime === 'clip' && primed !== 'clip') {
        await runStep(page, TO_SONG, notes);
        if (layout === 'phone')
          await runStep(page, { click: '[data-testid="nav-arrange"]' }, notes);
        await openClip(page, notes);
        primed = 'clip';
      }
      for (const step of surface.steps) await runStep(page, step, notes);
      if (surface.expect) {
        await page
          .waitForSelector(surface.expect, { timeout: 3000 })
          .catch(() => notes.push(`surface marker ${surface.expect} never appeared`));
      }
      measured = await page.evaluate(probe);
      for (const step of surface.close ?? []) await runStep(page, step, notes);
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    const entry = {
      id: surface.id,
      notes,
      error,
      documentScrolls: measured.documentScrolls,
      findings: dedupe(measured.findings),
    };
    vpReport.surfaces.push(entry);
    printSurface(surface.id, entry);
  }

  report.viewports.push(vpReport);
  await context.close();
}

await browser.close();

/* --------------------------------------------------------------- summary -- */

const counts = { viewport: 0, clipped: 0, truncated: 0, spill: 0, tap: 0 };
const uniqueBySig = new Map();
for (const vp of report.viewports) {
  for (const s of vp.surfaces) {
    for (const f of s.findings) {
      counts[f.kind] += 1;
      const key = `${f.kind}|${f.sig}`;
      const seen = uniqueBySig.get(key);
      if (!seen) {
        uniqueBySig.set(key, { ...f, viewports: new Set([vp.name]), surfaces: new Set([s.id]) });
      } else {
        seen.viewports.add(vp.name);
        seen.surfaces.add(s.id);
        if ((f.over ?? 0) > (seen.over ?? 0)) {
          seen.over = f.over;
          seen.sel = f.sel;
          seen.text = f.text;
        }
      }
    }
  }
}

report.summary = {
  occurrences: counts,
  distinct: [...uniqueBySig.values()]
    .map((f) => ({
      kind: f.kind,
      ellipsis: f.ellipsis ?? false,
      sig: f.sig,
      sel: f.sel,
      text: f.text,
      worstOverPx: f.over ?? null,
      viewports: [...f.viewports].sort(),
      surfaces: [...f.surfaces].sort(),
    }))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.worstOverPx ?? 0) - (a.worstOverPx ?? 0) ||
        a.sig.localeCompare(b.sig),
    ),
};

console.log('\n=== DISTINCT DEFECTS (across all viewports) ===');
for (const f of report.summary.distinct) {
  if (f.kind === 'tap') continue;
  console.log(
    `${labelFor(f)} ${String(f.worstOverPx ?? '').padStart(4)}px  ${f.sig}\n` +
      `             at ${f.sel}\n` +
      `             ${f.viewports.join(', ')}\n` +
      `             ${f.surfaces.slice(0, 6).join(', ')}${f.surfaces.length > 6 ? ` (+${f.surfaces.length - 6})` : ''}`,
  );
}
const tapCount = report.summary.distinct.filter((f) => f.kind === 'tap').length;
const byDesign = report.summary.distinct.filter((f) => f.kind === 'clipped' && f.ellipsis).length;
console.log(
  `\noccurrences: off-screen ${counts.viewport}, clipped ${counts.clipped}, ` +
    `no-ellipsis ${counts.truncated}, spill ${counts.spill}, tap-target ${counts.tap}`,
);
console.log(
  `distinct: ${report.summary.distinct.length - tapCount - byDesign} layout defects, ` +
    `${byDesign} ellipsised truncations (by design), ${tapCount} tap-target advisories`,
);

mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
console.log(`json -> ${JSON_OUT}`);
