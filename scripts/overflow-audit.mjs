/**
 * Responsive, orientation, text-scale and touch audit.
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
 * Directive 02 §4 widened the instrument from six portrait viewports to the
 * whole matrix a shipping product is used on. What was added, and why:
 *
 *   - **Landscape.** Every phone and tablet is now run rotated as well as
 *     upright. A rotated phone is not a wide phone: it is 360px *tall*, and
 *     the failure mode moves from the right edge to the bottom one. The audit
 *     therefore asks the vertical form of every horizontal question
 *     (`vbottom`, `vclipped`) — without them a landscape run measures nothing
 *     that landscape actually breaks.
 *   - **The big and small ends.** 1440x900, 1920x1080, 2560x1440 and an
 *     ultrawide 3440x1440, because a layout that only ever grows has its own
 *     defects; and tablet split-screen at 1/2 and 1/3 width, which is the
 *     narrowest real window the product gets and is not the same thing as a
 *     phone.
 *   - **Touch.** Contexts for phone, tablet and split cells are created with
 *     `hasTouch`, which is what turns on the product's own `@media (pointer:
 *     coarse)` rules. The previous run measured those cells with a mouse, so
 *     its 4541 undersized controls counted the desktop geometry of controls
 *     that grow under a finger. The minimum is 44 CSS px on those cells (the
 *     directive's touch target), 32 elsewhere and advisory.
 *   - **Text scaling.** `AUDIT_TEXT_SCALE` sets the root font size and
 *     `AUDIT_UI_SCALE` sets the product's own `--ui-scale`, so a run can ask
 *     what a user who enlarges type actually gets. Both are measured, because
 *     they are not the same mechanism and only one of them is wired.
 *   - **Safe-area insets.** `AUDIT_SAFE_AREA=device` injects non-zero values
 *     for `--sat/--sab/--sal/--sar` and then reports any interactive control
 *     that lands inside the band. Headless Chromium reports every inset as
 *     0px, so without the injection the tokens are exercised by nothing.
 *   - **Plugin editors.** Every device in the picker is added from the mixer's
 *     device rack and its window measured, because a plugin editor is a
 *     surface the surface walk never reaches: it only exists once something
 *     has been inserted.
 *   - **Overlap and scroll traps.** Two controls painting over each other, and
 *     a scroller whose content can only be reached on an axis it does not
 *     scroll, are both invisible to a width-only check.
 *
 * The questions asked of every element on every surface:
 *
 *   1. Does its content overflow horizontally (or vertically) while its own
 *      `overflow` on that axis is `visible`, `hidden` or `clip`? Those are the
 *      two ways content goes missing: cut at the box edge, or painted over
 *      whatever sits beside it.
 *   2. Does its border box cross the right or bottom edge of the viewport?
 *      That is the reported bug — a control the screen has no room for.
 *   3. Is it a clipping box with truncated text but no `text-overflow:
 *      ellipsis`? Text that stops mid-word reads as a rendering fault; an
 *      ellipsis reads as a name that is longer than the column.
 *   4. Is it an interactive control smaller than the cell's touch minimum?
 *   5. Do two statically-placed, content-bearing siblings intersect?
 *   6. Is it a scroll container that clips content on the axis it does not
 *      scroll, or an inner scroller that fills its outer one (a nested trap)?
 *   7. With device insets injected, does an interactive control sit inside the
 *      safe area?
 *
 * Anything reachable by scrolling is deliberately NOT a finding, on either
 * axis. An element whose own `overflow` is `auto`/`scroll` is a scroller doing
 * its job, and content that spills inside such a scroller can still be brought
 * into view, so the ancestor chain is checked before a spill is reported.
 * Without that filter the arrangement timeline alone would bury every real
 * defect. Truncation that carries `text-overflow: ellipsis` is labelled
 * ELLIPSIS and sorted last rather than reported as a fault, for the same
 * reason: it is a name longer than its column, which is a decision.
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
 * for re-checking one fix without a full run), AUDIT_VIEWPORTS (substring
 * filter on the viewport name), AUDIT_TEXT_SCALE (root font size percent,
 * default 100), AUDIT_UI_SCALE (the product's --ui-scale, default 1),
 * AUDIT_SAFE_AREA (off|device), AUDIT_PLUGINS (all|none|<substring of the
 * device label>), AUDIT_SHOTS (directory for failure screenshots),
 * AUDIT_SHOT_BUDGET (default 48).
 *
 * The JSON is sorted and free of coordinates that jitter between runs, so two
 * runs can be diffed to prove a fix removed findings and added none.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const BASE = process.env.AUDIT_BASE ?? 'http://localhost:4173';
const JSON_OUT = process.env.AUDIT_JSON ?? 'audit-out/overflow-audit.json';
const THEME = process.env.AUDIT_THEME ?? 'light';
const SETTLE = Number(process.env.AUDIT_SETTLE ?? 350);
const ONLY = (process.env.AUDIT_ONLY ?? '').trim();
const VP_ONLY = (process.env.AUDIT_VIEWPORTS ?? '').trim();
const TEXT_SCALE = Number(process.env.AUDIT_TEXT_SCALE ?? 100);
const UI_SCALE = Number(process.env.AUDIT_UI_SCALE ?? 1);
const SAFE_AREA = (process.env.AUDIT_SAFE_AREA ?? 'off').trim();
const PLUGINS = (process.env.AUDIT_PLUGINS ?? 'all').trim();
const SHOTS = (process.env.AUDIT_SHOTS ?? '').trim();
const SHOT_BUDGET = Number(process.env.AUDIT_SHOT_BUDGET ?? 48);

/**
 * The viewports worth defending, as the directive's matrix.
 *
 * `touch` is what decides both the browser context (`hasTouch`, which is what
 * turns on the product's `@media (pointer: coarse)` rules) and the tap-target
 * minimum, so a phone is measured with the geometry a finger actually gets.
 *
 * The landscape entries are the portrait ones with the axes swapped, on
 * purpose: that is the transform a rotation applies, and comparing the two
 * runs of the same device is how the report answers whether landscape is a
 * genuine second arrangement or the portrait one squashed.
 *
 * The split-screen cells are fractions of a tablet's landscape width at its
 * full landscape height, which is what a side-by-side window on iPadOS or
 * Android is. They are not phones: a phone is short, a split window is a tall
 * narrow column, and the two break differently.
 */
const VIEWPORTS = [
  { name: 'phone-sm-portrait', w: 360, h: 740, cls: 'phone', orient: 'portrait', touch: true },
  { name: 'phone-sm-landscape', w: 740, h: 360, cls: 'phone', orient: 'landscape', touch: true },
  { name: 'phone-md-portrait', w: 390, h: 844, cls: 'phone', orient: 'portrait', touch: true },
  { name: 'phone-md-landscape', w: 844, h: 390, cls: 'phone', orient: 'landscape', touch: true },
  { name: 'phone-lg-portrait', w: 430, h: 932, cls: 'phone', orient: 'portrait', touch: true },
  { name: 'phone-lg-landscape', w: 932, h: 430, cls: 'phone', orient: 'landscape', touch: true },
  { name: 'tablet-sm-portrait', w: 768, h: 1024, cls: 'tablet', orient: 'portrait', touch: true },
  { name: 'tablet-sm-landscape', w: 1024, h: 768, cls: 'tablet', orient: 'landscape', touch: true },
  { name: 'tablet-lg-portrait', w: 1024, h: 1366, cls: 'tablet', orient: 'portrait', touch: true },
  { name: 'tablet-lg-landscape', w: 1366, h: 1024, cls: 'tablet', orient: 'landscape', touch: true },
  { name: 'split-sm-half', w: 512, h: 768, cls: 'split', orient: 'landscape', touch: true },
  { name: 'split-sm-third', w: 341, h: 768, cls: 'split', orient: 'landscape', touch: true },
  { name: 'split-lg-half', w: 683, h: 1024, cls: 'split', orient: 'landscape', touch: true },
  { name: 'split-lg-third', w: 455, h: 1024, cls: 'split', orient: 'landscape', touch: true },
  { name: 'laptop-1280x800', w: 1280, h: 800, cls: 'laptop', orient: 'landscape', touch: false },
  { name: 'laptop-1440x900', w: 1440, h: 900, cls: 'laptop', orient: 'landscape', touch: false },
  { name: 'desktop-1920x1080', w: 1920, h: 1080, cls: 'desktop', orient: 'landscape', touch: false },
  { name: 'desktop-2560x1440', w: 2560, h: 1440, cls: 'desktop', orient: 'landscape', touch: false },
  { name: 'ultrawide-3440x1440', w: 3440, h: 1440, cls: 'ultra', orient: 'landscape', touch: false },
];

/**
 * Device safe-area insets, in CSS px.
 *
 * Headless Chromium has no notch, so `env(safe-area-inset-*)` resolves to 0px
 * everywhere and the four tokens in `src/styles/tokens.css` are exercised by
 * nothing. These are the iPhone 14 Pro's values — 59px of status bar and
 * dynamic island at the top, a 34px home indicator at the bottom, and, rotated,
 * 59px down each side with a 21px indicator — injected as `!important`
 * overrides on the tokens so the layout has to answer them.
 */
const SAFE_PRESET = {
  portrait: { t: 59, r: 0, b: 34, l: 0 },
  landscape: { t: 0, r: 59, b: 21, l: 59 },
};

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
 *
 * `modal` names the dialog box on the surfaces that are one, so the driver can
 * ask the questions that only apply to a modal: does it fit the viewport on
 * both axes, and can it be dismissed.
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
      modal: '.drawer',
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
        modal: '.drawer',
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
        modal: '.drawer',
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
      modal: '[data-testid="settings-sheet"]',
      dismiss: 'Escape',
      close: [{ key: 'Escape' }],
    },
    {
      id: 'sheet-export',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Export…' }],
      expect: '[data-testid="export-sheet"]',
      modal: '[data-testid="export-sheet"]',
      dismiss: 'Escape',
      close: [{ key: 'Escape' }],
    },
    {
      id: 'sheet-shortcuts',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Keyboard shortcuts' }],
      expect: '[data-testid="shortcuts-sheet"]',
      modal: '[data-testid="shortcuts-sheet"]',
      dismiss: 'Escape',
      close: [{ key: 'Escape' }],
    },
    {
      id: 'sheet-diagnostics',
      prime: 'track',
      steps: [TO_SONG, { menu: 'Diagnostics' }],
      expect: '[data-testid="diagnostics-sheet"]',
      modal: '[data-testid="diagnostics-sheet"]',
      dismiss: 'Escape',
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
const probe = (opts) => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const vh = de.clientHeight;
  const MIN_TAP = opts.minTap;
  const SLOP = 1; // sub-pixel rounding is not a defect
  const safe = opts.safe;

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
   * ancestor is actually scrolled-able on that axis. `overflow: auto` on a box
   * with nothing to scroll is not an escape hatch, hence the scrollWidth test
   * rather than just reading the property.
   */
  const reachableByScroll = (el) => {
    for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
    }
    return false;
  };
  const reachableByScrollY = (el) => {
    for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return true;
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
    '[role="slider"],[tabindex]:not([tabindex="-1"])';

  const out = [];
  /*
   * When a whole subtree hangs off an edge, only the outermost box is the bug —
   * its children are just along for the ride. This remembers the edge of each
   * reported ancestor so a child with the same edge is suppressed, which turns
   * a fifteen-line cascade into one actionable line.
   */
  const reportedRight = new WeakMap();
  const reportedBottom = new WeakMap();
  const reportedVClip = new WeakMap();
  const ancestorAlreadyPast = (map, el, edge) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const r = map.get(p);
      if (r !== undefined && Math.abs(r - edge) <= 2) return true;
    }
    return false;
  };

  const all = document.querySelectorAll('body *');
  /* Overlap is a question about siblings, so the candidates are collected per
     parent on the way past and answered in one pass at the end. */
  const overlapCandidates = new Map();

  for (const el of all) {
    // SVG children legitimately paint on top of one another — a curve over its
    // grid is the drawing, not a defect — so only the HTML tree is measured.
    if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
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
    const oy = cs.overflowY;
    const scrollableX = ox === 'auto' || ox === 'scroll';
    const scrollableY = oy === 'auto' || oy === 'scroll';
    const over = el.scrollWidth - el.clientWidth;
    const overY = el.scrollHeight - el.clientHeight;

    // 1 + 3: content wider than the box, with no scrollbar of its own.
    if (!scrollableX && over > SLOP && el.clientWidth > 0) {
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

    /*
     * 1, vertically. This is the whole reason landscape needs its own run: a
     * rotated phone is 360px tall, so what falls off is the bottom of a panel
     * rather than the right of a row, and a width-only audit reports nothing.
     *
     * Two calibrations the horizontal check does not need. The floor is 2px
     * rather than 1: the previous audit already documented `::after { inset:
     * -3px }` hit areas as a benign pattern that enlarges scrollHeight without
     * affecting layout, and vertically they are everywhere. And a clip
     * cascades — a strip cut by 39px reports its meter, its bars and its scale
     * cut by the same 39px — so a descendant losing the same amount as an
     * ancestor already reported is the ancestor's bug, not a second one.
     */
    if (!scrollableY && overY > 2 && el.clientHeight > 0) {
      const vclipped = oy === 'hidden' || oy === 'clip';
      const cascade = ancestorAlreadyPast(reportedVClip, el, Math.round(overY));
      if ((vclipped || !reachableByScrollY(el)) && !cascade) {
        reportedVClip.set(el, Math.round(overY));
        out.push({
          kind: 'vclipped',
          sel: cssPath(el),
          sig: sigOf(el),
          text: label(el),
          over: Math.round(overY),
          boxH: Math.round(rect.height),
          overflowY: oy,
        });
      }
    }

    // 2: the box itself crosses the right edge of the screen.
    const right = Math.round(rect.right);
    if (rect.right > vw + SLOP && rect.left < vw && !reachableByScroll(el)) {
      if (!ancestorAlreadyPast(reportedRight, el, right)) {
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

    // 2, vertically: the box crosses the bottom edge with nothing to scroll.
    const bottom = Math.round(rect.bottom);
    if (rect.bottom > vh + SLOP && rect.top < vh && !reachableByScrollY(el)) {
      if (!ancestorAlreadyPast(reportedBottom, el, bottom)) {
        reportedBottom.set(el, bottom);
        out.push({
          kind: 'vbottom',
          sel: cssPath(el),
          sig: sigOf(el),
          text: label(el),
          over: Math.round(rect.bottom - vh),
          boxH: Math.round(rect.height),
          overflowY: oy,
        });
      }
    }

    // 4: tap-target size, against this cell's minimum.
    const interactive = cs.pointerEvents !== 'none' && el.matches(INTERACTIVE);
    if (interactive && (rect.width < MIN_TAP || rect.height < MIN_TAP)) {
      out.push({
        kind: 'tap',
        sel: cssPath(el),
        sig: sigOf(el),
        text: label(el),
        boxW: Math.round(rect.width),
        boxH: Math.round(rect.height),
      });
    }

    /*
     * 6: a scroll container that clips on the axis it does not scroll. The
     * content is there, the box knows it is there, and no gesture reaches it.
     */
    if (scrollableX && !scrollableY && (oy === 'hidden' || oy === 'clip') && overY > 2) {
      out.push({
        kind: 'scroll',
        reason: 'scrolls x, clips y',
        sel: cssPath(el),
        sig: sigOf(el),
        text: label(el),
        over: Math.round(overY),
        boxH: Math.round(rect.height),
      });
    }
    /*
     * A nested trap: an inner scroller that fills its outer one. Every wheel,
     * drag and flick that starts inside the inner box is consumed by it, so the
     * outer box's own overflow can never be scrolled to by touch.
     */
    if (scrollableY && el.scrollHeight > el.clientHeight + 2) {
      for (let p = el.parentElement; p && p !== de; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (ps.overflowY !== 'auto' && ps.overflowY !== 'scroll') continue;
        if (p.scrollHeight <= p.clientHeight + 2) break;
        if (rect.height >= p.clientHeight * 0.9) {
          out.push({
            kind: 'scroll',
            reason: 'inner scroller fills its outer one',
            sel: cssPath(el),
            sig: sigOf(el),
            text: label(el),
            over: Math.round(p.scrollHeight - p.clientHeight),
            boxH: Math.round(rect.height),
          });
        }
        break;
      }
    }

    // 7: an interactive control inside a device safe area.
    if (safe && interactive) {
      const bands = [];
      if (safe.t > 0 && rect.top < safe.t) bands.push(`top ${Math.round(safe.t - rect.top)}px`);
      if (safe.b > 0 && rect.bottom > vh - safe.b) {
        bands.push(`bottom ${Math.round(rect.bottom - (vh - safe.b))}px`);
      }
      if (safe.l > 0 && rect.left < safe.l) bands.push(`left ${Math.round(safe.l - rect.left)}px`);
      if (safe.r > 0 && rect.right > vw - safe.r) {
        bands.push(`right ${Math.round(rect.right - (vw - safe.r))}px`);
      }
      if (bands.length) {
        out.push({
          kind: 'safe',
          reason: bands.join(', '),
          sel: cssPath(el),
          sig: sigOf(el),
          text: label(el),
          boxW: Math.round(rect.width),
          boxH: Math.round(rect.height),
        });
      }
    }

    /*
     * 5: collect for the overlap pass. Only content-bearing, statically placed,
     * untransformed boxes are candidates — an absolutely positioned fill or a
     * hit area nudged out by a transform is meant to sit on top of something.
     */
    if (
      (interactive || hasOwnText(el)) &&
      (cs.position === 'static' || cs.position === 'relative') &&
      cs.transform === 'none' &&
      cs.float === 'none' &&
      el.parentElement
    ) {
      const list = overlapCandidates.get(el.parentElement);
      if (list) list.push({ el, rect });
      else overlapCandidates.set(el.parentElement, [{ el, rect }]);
    }
  }

  // 5: two content-bearing siblings painting over each other.
  for (const [parent, kids] of overlapCandidates) {
    if (kids.length < 2) continue;
    // A long list of siblings is a list; comparing all pairs of a 200-row
    // arrangement costs more than it finds, and rows in a list are ordered, so
    // neighbours are the only pairs that can collide.
    for (let i = 0; i + 1 < kids.length; i++) {
      for (let j = i + 1; j < Math.min(kids.length, i + 4); j++) {
        const a = kids[i].rect;
        const b = kids[j].rect;
        const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (dx <= 2 || dy <= 2) continue;
        out.push({
          kind: 'overlap',
          sel: cssPath(parent),
          sig: sigOf(kids[i].el) + ' // ' + sigOf(kids[j].el),
          text: `${label(kids[i].el)} / ${label(kids[j].el)}`,
          over: Math.round(Math.min(dx, dy)),
          boxW: Math.round(dx),
          boxH: Math.round(dy),
        });
      }
    }
  }

  return {
    viewportWidth: vw,
    viewportHeight: vh,
    documentScrolls: de.scrollWidth > de.clientWidth + SLOP,
    documentScrollsY: de.scrollHeight > de.clientHeight + SLOP,
    findings: out,
  };
};

/**
 * The track header control strip, asked the questions `e2e/trackheader.spec.ts`
 * asks — but at every cell of the matrix rather than at three portrait phones,
 * because a strip that survives 390x844 says nothing about the same strip in a
 * 341px split-screen column.
 */
const probeTrackHeader = (minTouch) => {
  const problems = [];
  let checked = 0;
  const rect = (el) => el.getBoundingClientRect();
  for (const header of document.querySelectorAll('[data-testid^="track-header-"]')) {
    const strip = header.querySelector('.th-controls');
    if (!strip) continue;
    const controls = [...strip.children]
      .map((el) => ({ el, box: rect(el) }))
      .filter((c) => c.box.width > 0 && c.box.height > 0);
    const id = header.getAttribute('data-testid') ?? 'header';
    for (const c of controls) {
      checked++;
      if (c.box.width < minTouch || c.box.height < minTouch) {
        problems.push(
          `${c.el.className}: ${Math.round(c.box.width)}x${Math.round(c.box.height)} < ${minTouch}`,
        );
      }
    }
    for (let i = 0; i + 1 < controls.length; i++) {
      const gap = controls[i + 1].box.left - controls[i].box.right;
      if (gap < -0.5) problems.push(`${id}: controls overlap by ${Math.round(-gap)}px`);
      else if (gap < 3.5) problems.push(`${id}: gap is ${Math.round(gap)}px`);
    }
    const headerBox = rect(header);
    const stripBox = rect(strip);
    if (stripBox.right > headerBox.right + 0.5) {
      problems.push(`${id}: strip overflows its header by ${Math.round(stripBox.right - headerBox.right)}px`);
    }
    const name = header.querySelector('.th-name');
    if (name && name.scrollWidth > name.clientWidth + 1) {
      problems.push(`${id}: name needs ${name.scrollWidth}px, has ${name.clientWidth}px`);
    }
  }
  // One line per distinct problem: five identical headers are one defect.
  return { checked, problems: [...new Set(problems)] };
};

/**
 * The chrome budget: how much of the screen the app spends on itself before
 * any music is on it.
 *
 * No per-element check can see this. Every box can be inside its parent, every
 * row can fit, and the arrangement can still be left with six pixels to draw
 * eight tracks in — which is what a rotated phone gets, because nothing in the
 * layout treats a 360px-tall window differently from a 360px-wide one. This is
 * the number that says whether landscape is a second arrangement or the
 * portrait one with a smaller viewport, so it is measured on every cell.
 */
const probeChrome = () => {
  const h = (sel) => {
    const el = document.querySelector(sel);
    return el ? Math.round(el.getBoundingClientRect().height) : 0;
  };
  const scroller = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return {
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      clientW: el.clientWidth,
      scrollW: el.scrollWidth,
    };
  };
  const lanes = document.querySelector('.arr-lanes');
  const scroll = document.querySelector('[data-testid="arr-scroll"]');
  /* The lanes start below whatever sits inside the scroller (ruler, markers),
     so the height actually available to tracks is what is left under it. */
  const laneViewport =
    lanes && scroll
      ? Math.max(
          0,
          scroll.getBoundingClientRect().bottom - lanes.getBoundingClientRect().top,
        )
      : null;
  return {
    viewportH: document.documentElement.clientHeight,
    topbar: h('header.topbar'),
    transport: h('[data-testid="transport"]'),
    bottomnav: h('.bottomnav'),
    statusbar: h('.statusbar'),
    arrToolbar: h('.arr-toolbar'),
    arrOverview: h('[data-testid="arrangement-overview"]'),
    arrScroll: scroller('[data-testid="arr-scroll"]'),
    laneViewportH: laneViewport === null ? null : Math.round(laneViewport),
    trackRowH: (() => {
      const th = document.querySelector('[data-testid^="track-header-"]');
      return th ? Math.round(th.getBoundingClientRect().height) : null;
    })(),
    trackHeaderNeedsH: (() => {
      const th = document.querySelector('[data-testid^="track-header-"]');
      return th ? th.scrollHeight : null;
    })(),
  };
};

/** Does this dialog fit the screen, and can it be got rid of? */
const probeModal = (sel) => {
  const box = document.querySelector(sel);
  if (!box) return null;
  const r = box.getBoundingClientRect();
  const de = document.documentElement;
  const dismiss = box.querySelector(
    '[aria-label^="Close"],[aria-label^="Dismiss"],[data-testid$="-close"],.sheet-foot button',
  );
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    vw: de.clientWidth,
    vh: de.clientHeight,
    overRight: Math.round(Math.max(0, r.right - de.clientWidth)),
    overBottom: Math.round(Math.max(0, r.bottom - de.clientHeight)),
    overLeft: Math.round(Math.max(0, -r.left)),
    overTop: Math.round(Math.max(0, -r.top)),
    hasDismissButton: !!dismiss,
    dismissBox: dismiss
      ? {
          w: Math.round(dismiss.getBoundingClientRect().width),
          h: Math.round(dismiss.getBoundingClientRect().height),
        }
      : null,
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
 * Get to a mixer that shows device racks, whatever layout this is. The plugin
 * sweep needs the rack's Insert button, and the rack is only on the console.
 */
async function toMixer(page, layout, notes) {
  await runStep(page, TO_SONG, notes);
  const step =
    layout === 'phone'
      ? { click: '[data-testid="nav-mix"]' }
      : layout === 'tablet'
        ? { click: '[data-testid="combo-mixer"]' }
        : { click: '[data-testid="editor-tab-mixer"]' };
  await runStep(page, step, notes);
}

/**
 * Every plugin editor, measured in its window.
 *
 * A plugin editor is the one surface the surface walk cannot reach: it exists
 * only once a device has been inserted, and which editor you get depends on
 * which device. So the picker is read out of the DOM rather than hard-coded —
 * that way a device added to `src/model/effects.ts` is audited the day it
 * lands instead of the day somebody remembers this list — and each entry is
 * inserted, measured and removed in turn.
 *
 * `addAndOpen` in `DeviceRack.tsx` opens the window for a device you just
 * added, so inserting is also the gesture that opens the editor.
 */
async function sweepPlugins(page, vpName, layout, minTap, safe, onSurface) {
  const notes = [];
  await toMixer(page, layout, notes);
  const adders = page.locator('[data-testid^="device-add-"]');
  if (!(await adders.count())) {
    return { notes: [...notes, 'no device rack on this layout — plugin sweep skipped'] };
  }

  /* Read the picker once: every label between the first group heading and the
     "Chains" heading is a device, and the shelf's third-party plugins are in
     there too under "Plugins". */
  await adders.first().click({ timeout: 4000 }).catch(() => {});
  await settle(page, 250);
  const labels = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.ctx-menu [role="menuitem"]')];
    const out = [];
    let stop = false;
    for (const it of items) {
      const t = (it.textContent || '').trim();
      if (/^—\s*Chains/.test(t) || /^—\s*Your chains/.test(t)) stop = true;
      if (stop) continue;
      if (/^—/.test(t)) continue;
      if (it.getAttribute('aria-disabled') === 'true' || it.hasAttribute('disabled')) continue;
      out.push(t);
    }
    return out;
  });
  await page.keyboard.press('Escape');
  await settle(page, 150);

  const wanted =
    PLUGINS === 'all' ? labels : labels.filter((l) => l.toLowerCase().includes(PLUGINS.toLowerCase()));
  notes.push(`${labels.length} devices in the picker, ${wanted.length} swept`);

  for (const label of wanted) {
    const surfaceId = `plugin-${label.replace(/\s+/g, '-').toLowerCase()}`;
    if (ONLY && !`${vpName}/${surfaceId}`.includes(ONLY)) continue;
    const one = [];
    let measured = { findings: [], documentScrolls: false, documentScrollsY: false };
    let modal = null;
    let error = null;
    try {
      /* A rack fills up at MAX_INSERTS, and its Insert button then disables.
         Walking to the first enabled adder is how the sweep keeps going past
         the twelfth device without needing to know what the limit is. */
      const n = await adders.count();
      let opened = false;
      for (let i = 0; i < n; i++) {
        const add = adders.nth(i);
        if (await add.isDisabled().catch(() => true)) continue;
        await add.scrollIntoViewIfNeeded().catch(() => {});
        await add.click({ timeout: 4000 });
        await settle(page, 200);
        const item = page.locator(`.ctx-menu [role="menuitem"]`).filter({ hasText: label }).first();
        if (!(await item.count())) {
          await page.keyboard.press('Escape');
          one.push(`"${label}" is not in this rack's picker`);
          break;
        }
        await item.click({ timeout: 4000 });
        await settle(page, 450);
        opened = true;
        break;
      }
      if (!opened) {
        one.push('every rack is full — no free insert slot');
      } else {
        const win = page.locator('[data-testid="plugin-window"]');
        if (!(await win.count())) one.push('device added but no window opened');
        measured = await page.evaluate(probe, { minTap, safe });
        modal = await page.evaluate(probeModal, '[data-testid="plugin-window"]');
      }
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    await page.keyboard.press('Escape').catch(() => {});
    await settle(page, 150);
    await onSurface(surfaceId, {
      notes: one,
      error,
      modal,
      measured,
    });
  }
  return { notes };
}

/**
 * Reporting order, worst first: a control pushed off the screen, then content
 * cut with no ellipsis, then a spill, then the deliberate ellipsis cases, and
 * the advisory tap targets last.
 */
const RANK = {
  viewport: 0,
  vbottom: 0.5,
  clipped: 1,
  vclipped: 1.2,
  truncated: 2,
  overlap: 2.4,
  spill: 3,
  scroll: 3.1,
  safe: 3.2,
  tap: 5,
};
const rank = (f) => RANK[f.kind] + (f.ellipsis ? 3.5 : 0);

/** Collapse repeats, keep the worst offender of each, and sort for diffing. */
function dedupe(findings) {
  const byKey = new Map();
  for (const f of findings) {
    const key = `${f.kind}|${f.sig}|${f.reason ?? ''}`;
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
  viewport: 'OFF-RIGHT ',
  vbottom: 'OFF-BOTTOM',
  clipped: 'CLIPPED   ',
  vclipped: 'CLIPPED-Y ',
  truncated: 'NO-ELLIPS ',
  overlap: 'OVERLAP   ',
  spill: 'SPILL     ',
  scroll: 'SCROLL    ',
  safe: 'SAFE-AREA ',
  tap: 'TAP-TARGET',
};

const labelFor = (f) => (f.kind === 'clipped' && f.ellipsis ? 'ELLIPSIS  ' : KIND_LABEL[f.kind]);

function printSurface(surfaceId, result) {
  const real = result.findings.filter((f) => f.kind !== 'tap');
  const taps = result.findings.filter((f) => f.kind === 'tap');
  const modalBad =
    result.modal &&
    (result.modal.overRight > 0 ||
      result.modal.overBottom > 0 ||
      result.modal.overLeft > 0 ||
      result.modal.overTop > 0);
  if (!real.length && !taps.length && !result.notes.length && !result.error && !modalBad) return;
  console.log(`  - ${surfaceId}`);
  if (result.error) console.log(`      ! ${result.error}`);
  for (const n of result.notes) console.log(`      . ${n}`);
  if (result.documentScrolls) console.log('      ! the document itself scrolls horizontally');
  if (result.documentScrollsY) console.log('      ! the document itself scrolls vertically');
  if (modalBad) {
    const m = result.modal;
    console.log(
      `      MODAL      ${m.w}x${m.h} in ${m.vw}x${m.vh} — over ` +
        `r${m.overRight} b${m.overBottom} l${m.overLeft} t${m.overTop}`,
    );
  }
  if (result.modal && !result.modal.hasDismissButton) {
    console.log('      MODAL      no close control found inside the dialog');
  }
  for (const f of real) {
    const many = f.count > 1 ? ` x${f.count}` : '';
    const px = f.over !== undefined ? `${String(f.over).padStart(4)}px` : '     ';
    console.log(`      ${labelFor(f)} ${px}${many}  ${f.sel}${f.reason ? `  (${f.reason})` : ''}`);
    if (f.text) console.log(`                          "${f.text}"`);
  }
  if (taps.length) {
    console.log(`      TAP-TARGET, ${taps.length} distinct:`);
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
const report = {
  base: BASE,
  theme: THEME,
  textScalePct: TEXT_SCALE,
  uiScale: UI_SCALE,
  safeArea: SAFE_AREA,
  generated: new Date().toISOString(),
  viewports: [],
};
let shotsTaken = 0;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Is this surface worth a picture? Advisory kinds are not. */
const HARD = new Set(['viewport', 'vbottom', 'clipped', 'vclipped', 'truncated', 'overlap']);
const worthAShot = (entry) =>
  entry.findings.some((f) => HARD.has(f.kind) && !f.ellipsis) ||
  entry.documentScrolls ||
  entry.documentScrollsY ||
  (entry.modal && (entry.modal.overRight > 0 || entry.modal.overBottom > 0));

for (const vp of VIEWPORTS) {
  if (VP_ONLY && !vp.name.includes(VP_ONLY)) continue;
  const touch = vp.touch;
  const context = await browser.newContext({
    viewport: { width: vp.w, height: vp.h },
    hasTouch: touch,
  });
  /*
   * The theme is a stored preference, and the welcome card is a stored
   * first-run flag. Both are seeded before the first script runs so the audit
   * measures the workstation rather than a modal on top of it.
   */
  await context.addInitScript(
    ({ t, s }) => {
      try {
        localStorage.setItem('motionlab.prefs.v1', JSON.stringify({ theme: t, uiScale: s }));
        localStorage.setItem('txpps-motionlab-welcome-v1', '1');
      } catch {
        /* storage disabled in this context — defaults are close enough */
      }
    },
    { t: THEME, s: UI_SCALE },
  );

  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(`${BASE}/#/song`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="app-root"]');

  /*
   * Text scaling, two ways, because they are two mechanisms.
   *
   * `font-size` on the root is what a browser's or an OS's text-size setting
   * moves. `--ui-scale` is the product's own control. A run sets one, the
   * other or neither, and the geometry fingerprint below records whether the
   * setting actually reached the layout — a scale that changes nothing is the
   * finding, not a clean pass.
   */
  const safe = SAFE_AREA === 'device' ? SAFE_PRESET[vp.orient] : null;
  const beforeScale = await page.evaluate(() => ({
    rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    bodyFontPx: parseFloat(getComputedStyle(document.body).fontSize),
    docH: document.documentElement.scrollHeight,
  }));
  if (TEXT_SCALE !== 100) {
    await page.addStyleTag({ content: `html { font-size: ${TEXT_SCALE}% !important; }` });
  }
  if (safe) {
    await page.addStyleTag({
      content:
        `:root { --sat: ${safe.t}px !important; --sar: ${safe.r}px !important;` +
        ` --sab: ${safe.b}px !important; --sal: ${safe.l}px !important; }`,
    });
  }
  await settle(page, 1200);
  const afterScale = await page.evaluate(() => ({
    rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
    bodyFontPx: parseFloat(getComputedStyle(document.body).fontSize),
    uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    sampleFontPx: (() => {
      const el = document.querySelector('.th-name') || document.querySelector('button');
      return el ? parseFloat(getComputedStyle(el).fontSize) : null;
    })(),
    docH: document.documentElement.scrollHeight,
  }));

  const layout = await page.getAttribute('[data-testid="app-root"]', 'data-layout');
  const primeNotes = [];
  await selectTrack(page, primeNotes);
  let primed = 'track';

  const minTap = touch ? 44 : 32;
  const vpReport = {
    name: vp.name,
    width: vp.w,
    height: vp.h,
    cls: vp.cls,
    orientation: vp.orient,
    touch,
    minTap,
    layout,
    scale: { before: beforeScale, after: afterScale },
    trackHeader: null,
    surfaces: [],
  };
  console.log(
    `\n=== ${vp.name}  ${vp.w}x${vp.h}  (layout: ${layout}, ${touch ? 'touch' : 'mouse'}, tap>=${minTap})`,
  );
  if (primeNotes.length) for (const n of primeNotes) console.log(`  . ${n}`);

  vpReport.chrome = await page.evaluate(probeChrome);
  {
    const c = vpReport.chrome;
    console.log(
      `  chrome: topbar ${c.topbar} + transport ${c.transport} + ` +
        `arr-toolbar ${c.arrToolbar} + overview ${c.arrOverview} + ` +
        `${c.bottomnav ? `bottomnav ${c.bottomnav}` : `statusbar ${c.statusbar}`} ` +
        `-> lanes get ${c.laneViewportH}px of ${c.viewportH} ` +
        `(${c.trackRowH ? (c.laneViewportH / c.trackRowH).toFixed(1) : '?'} track rows); ` +
        `header row ${c.trackRowH}px holds ${c.trackHeaderNeedsH}px of controls`,
    );
  }
  vpReport.trackHeader = await page.evaluate(probeTrackHeader, minTap);
  if (vpReport.trackHeader.problems.length) {
    console.log(`  - track-header (${vpReport.trackHeader.checked} controls measured)`);
    for (const p of vpReport.trackHeader.problems) console.log(`      TH  ${p}`);
    if (SHOTS && shotsTaken < SHOT_BUDGET) {
      shotsTaken++;
      await page
        .screenshot({ path: join(SHOTS, `${vp.name}__track-header.png`) })
        .catch(() => shotsTaken--);
    }
  }

  /** One place where a measured surface is filed, printed and photographed. */
  const record = async (id, { notes, error, modal, measured }) => {
    const entry = {
      id,
      notes,
      error,
      modal: modal ?? null,
      documentScrolls: measured.documentScrolls,
      documentScrollsY: measured.documentScrollsY,
      findings: dedupe(measured.findings),
    };
    vpReport.surfaces.push(entry);
    printSurface(id, entry);
    if (SHOTS && shotsTaken < SHOT_BUDGET && worthAShot(entry)) {
      shotsTaken++;
      const file = join(SHOTS, `${vp.name}__${id}.png`);
      await page.screenshot({ path: file }).catch(() => shotsTaken--);
      entry.shot = file;
    }
  };

  for (const surface of surfacesFor(layout)) {
    if (ONLY && !`${vp.name}/${surface.id}`.includes(ONLY)) continue;
    const notes = [];
    let measured = { findings: [], documentScrolls: false, documentScrollsY: false };
    let modal = null;
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
      measured = await page.evaluate(probe, { minTap, safe });
      if (surface.modal) modal = await page.evaluate(probeModal, surface.modal);
      for (const step of surface.close ?? []) await runStep(page, step, notes);
      /* A modal that will not close is a trap, and the only way to know is to
         try the gesture the product documents and look again. */
      if (surface.modal && modal) {
        const still = await page.locator(surface.modal).count();
        modal.dismissed = still === 0;
        if (!modal.dismissed) {
          await page.keyboard.press('Escape');
          await settle(page, 200);
          modal.dismissed = (await page.locator(surface.modal).count()) === 0;
          modal.neededExtraEscape = modal.dismissed;
        }
      }
    } catch (e) {
      error = e.message.split('\n')[0];
    }
    await record(surface.id, { notes, error, modal, measured });
  }

  if (PLUGINS !== 'none') {
    const swept = await sweepPlugins(page, vp.name, layout, minTap, safe, record);
    for (const n of swept.notes) console.log(`  . plugins: ${n}`);
    vpReport.pluginNotes = swept.notes;
  }

  report.viewports.push(vpReport);
  await context.close();
}

await browser.close();

/* --------------------------------------------------------------- summary -- */

const counts = Object.fromEntries(Object.keys(RANK).map((k) => [k, 0]));
const uniqueBySig = new Map();
for (const vp of report.viewports) {
  for (const s of vp.surfaces) {
    for (const f of s.findings) {
      counts[f.kind] += 1;
      const key = `${f.kind}|${f.sig}|${f.reason ?? ''}`;
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
      reason: f.reason ?? null,
      sig: f.sig,
      sel: f.sel,
      text: f.text,
      worstOverPx: f.over ?? null,
      boxW: f.boxW ?? null,
      boxH: f.boxH ?? null,
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
    `${labelFor(f)} ${String(f.worstOverPx ?? '').padStart(4)}px  ${f.sig}${f.reason ? `  (${f.reason})` : ''}\n` +
      `             at ${f.sel}\n` +
      `             ${f.viewports.join(', ')}\n` +
      `             ${f.surfaces.slice(0, 6).join(', ')}${f.surfaces.length > 6 ? ` (+${f.surfaces.length - 6})` : ''}`,
  );
}
const tapCount = report.summary.distinct.filter((f) => f.kind === 'tap').length;
const byDesign = report.summary.distinct.filter((f) => f.kind === 'clipped' && f.ellipsis).length;
console.log(
  '\noccurrences: ' +
    Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
);
console.log(
  `distinct: ${report.summary.distinct.length - tapCount - byDesign} layout defects, ` +
    `${byDesign} ellipsised truncations (by design), ${tapCount} tap-target advisories`,
);
if (SHOTS) console.log(`screenshots -> ${SHOTS} (${shotsTaken})`);

mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
console.log(`json -> ${JSON_OUT}`);
