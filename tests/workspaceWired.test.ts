/**
 * One layout model, and nothing keeping a second copy of it.
 *
 * This is the guard for the class of defect that cost a directive: the tablet's
 * bottom pane chose what to draw from a `useState` local to `TabletLayout`, so a
 * control that set the editor tab and revealed the pane changed the tab,
 * revealed the pane, and watched the pane go on drawing the mixer. Six controls
 * were inert there. It survived because a phone and a desktop both honour the
 * request and only a tablet had a second opinion — which is exactly the shape a
 * unit test of any one shell cannot see.
 *
 * So the check is static and crude, in the manner of `schemaWired.test.ts` and
 * `laneWired.test.ts`: it reads the shells' own source and looks for the shapes
 * a duplicate takes. A file that passes is not proven correct; a file that fails
 * is proven to be holding layout state of its own.
 *
 * The three claims, and why each is one:
 *
 *   1. **No shell holds pane visibility, a pane size, the editor tab or the
 *      phone mode in a `useState`.** That is the literal defect above.
 *   2. **The pane limits are declared once.** They were written twice — a pixel
 *      minimum in `DesktopLayout`'s JSX and a percentage clamp in the store —
 *      and the two could disagree: a size the store clamped to 40 came back from
 *      the panel library as 34 and the store wrote 34 over the preference. A
 *      shell must read `PANE_LIMITS` rather than spell a number.
 *   3. **Every pane the model declares is drawn by a shell, and every pane a
 *      shell draws is in the model.** A pane in the model that nothing renders
 *      is a preference that does nothing; a pane rendered from a literal is the
 *      duplicate arriving from the other direction.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANE_IDS } from '../src/state/workspaceModel';

const ROOT = join(__dirname, '..');
const SHELL = join(ROOT, 'src/components/shell');

const shellFiles = readdirSync(SHELL).filter((f) => /\.tsx?$/.test(f));
const sourceOf = (f: string) => readFileSync(join(SHELL, f), 'utf8');

/**
 * The same file with its comments removed.
 *
 * A comment naming the field it replaced is the house style — "it was
 * `tabletBottomSize`, and here is why it is not any more" — so a check that
 * greps the whole file cannot tell a use from an explanation, and would push
 * every one of these comments out of the codebase to stay green. Block comments,
 * line comments and JSX comments, in that order.
 */
const codeOf = (f: string) =>
  sourceOf(f)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * A `useState` whose initialiser or type names a piece of layout.
 *
 * Matched on the *declaration line* rather than on the word appearing anywhere
 * in the file, because a shell is allowed to talk about the editor tab — it
 * reads one — and is not allowed to keep its own.
 */
const LAYOUT_WORDS =
  /(editorTab|phoneMode|paneSize|collapsed|maximiz|showBrowser|showEditor|showInspector)/i;

describe('no shell keeps its own copy of the layout', () => {
  it.each(shellFiles)('%s holds no layout state in a useState', (file) => {
    const offenders = sourceOf(file)
      .split(/\r?\n/)
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter(({ line }) => /\buseState[<(]/.test(line) && LAYOUT_WORDS.test(line));
    expect(
      offenders.map((o) => `${file}:${o.n} ${o.line}`),
      'a shell holding layout in local state is a shell that can disagree with the model — ' +
        'which is exactly how six controls came to be inert on a tablet and nowhere else',
    ).toEqual([]);
  });

  /**
   * The drawer's `useState` is the one local piece of shell state that is
   * legitimate, and it is worth saying why rather than leaving it to look like
   * an oversight: a tablet drawer is a modal that overlays the workspace for the
   * length of one interaction. It is not persisted, not recalled by a workspace,
   * and nothing outside the tablet has any business opening one — so there is no
   * second reader for it to disagree with.
   */
  it('and the tablet drawer, which is the one thing that is genuinely local', () => {
    const src = sourceOf('TabletLayout.tsx');
    expect(src).toMatch(/useState<null \| 'browser' \| 'inspector'>\(null\)/);
    // Which is not the same as it holding the pane. The pane it used to own is
    // the editor pane, and it comes from the store now.
    expect(src).toMatch(/useWorkspaceStore\(\(s\) => s\.panes\.editor\)/);
    // The field it used to keep instead, gone from the CODE — the prose above it
    // names it deliberately, because a comment that cannot say what it replaced
    // is a comment that restates the code. Comment lines are dropped first for
    // the same reason `docs-guard` skips fenced blocks: a file describing an
    // idiom is not a file using one.
    expect(codeOf('TabletLayout.tsx')).not.toMatch(/tabletBottomSize/);
  });
});

describe('the pane constraints are declared once', () => {
  /**
   * Which `<Panel>` is which, so a limit can be read against the pane it sizes.
   *
   * The first version of this check matched any `minSize="180px"` against every
   * pane's `minPx`, and the arrangement's own `minSize="180px"` collided with
   * the browser's 180 — a false positive on a panel that is not a workspace pane
   * at all and has nowhere else to keep its floor. Matching a number against a
   * table of numbers cannot tell two surfaces apart; matching the *element* can.
   *
   * `pane-browser`, `pane-inspector`, `pane-editor` and the tablet's
   * `pane-bottom` are the four that draw a pane from the model. `pane-center`
   * and `pane-arrangement` are structural and are correctly left alone.
   */
  const PANEL_OF: Record<string, (typeof PANE_IDS)[number]> = {
    'pane-browser': 'browser',
    'pane-inspector': 'inspector',
    'pane-editor': 'editor',
    'pane-bottom': 'editor',
  };

  /** Every `<Panel …>` opening tag, whole, with its attributes. */
  const PANELS = /<Panel\b([\s\S]*?)>/g;
  const SIZING_PROP = /\b(minSize|maxSize|defaultSize)=\{?["'`]?(\d+(?:\.\d+)?)(px|%)/g;

  it.each(shellFiles)('%s takes its panel limits from PANE_LIMITS', (file) => {
    const src = codeOf(file);
    const literals: string[] = [];
    for (const panel of src.matchAll(PANELS)) {
      const attrs = panel[1];
      const id = /id="([\w-]+)"/.exec(attrs)?.[1] ?? '';
      // Only a panel that draws a pane from the model can duplicate a pane
      // limit. A structural panel's floor is its own and belongs in its JSX.
      if (!PANEL_OF[id]) continue;
      for (const m of attrs.matchAll(SIZING_PROP)) {
        literals.push(`${id}: ${m[1]}=${m[2]}${m[3]}`);
      }
    }
    expect(
      literals,
      `${file} spells a pane limit as a literal. It was written twice before — a pixel ` +
        'minimum here and a percentage clamp in the store — and the two disagreed: a browser ' +
        'the store clamped to 40 was pushed back to 34 by the panel library, and the store ' +
        'wrote 34 over the preference on the next resize.',
    ).toEqual([]);
  });

  it('and every pane panel the shells draw is one this check knows about', () => {
    // Otherwise a pane rendered under an id not in `PANEL_OF` is skipped in
    // silence, and the rule above passes by not looking — which is the failure
    // this whole file is written against, one level up.
    const drawn = new Set<string>();
    for (const file of shellFiles) {
      for (const panel of codeOf(file).matchAll(PANELS)) {
        const id = /id="([\w-]+)"/.exec(panel[1])?.[1];
        if (id) drawn.add(id);
      }
    }
    const structural = new Set(['pane-center', 'pane-arrangement']);
    const unknown = [...drawn].filter((id) => !PANEL_OF[id] && !structural.has(id));
    expect(unknown, 'a Panel this check has never heard of, so it is not being checked').toEqual(
      [],
    );
    // And the four it does know about are all actually drawn.
    for (const id of Object.keys(PANEL_OF))
      expect(drawn, `${id} is drawn by no shell`).toContain(id);
  });

  it('and the shells that size panes read the table', () => {
    // Non-vacuity. The rule above passes on a file that sizes nothing at all, so
    // the two shells that DO size panes are required to be reading the table —
    // otherwise deleting every `minSize` would make this whole describe green.
    for (const file of ['DesktopLayout.tsx', 'TabletLayout.tsx']) {
      expect(sourceOf(file), `${file} sizes panes and does not read PANE_LIMITS`).toMatch(
        /PANE_LIMITS/,
      );
    }
  });
});

describe('every pane in the model is drawn, and every pane drawn is in the model', () => {
  const allShells = shellFiles.map(sourceOf).join('\n');

  it.each([...PANE_IDS])('%s is rendered by a shell', (id) => {
    // A pane in the model that no shell draws is a preference that does nothing
    // — the same defect class as a control that does nothing, arriving from the
    // state side rather than the UI side.
    expect(allShells, `nothing renders the ${id} pane`).toMatch(
      new RegExp(`panes\\.${id}|['"\`]${id}['"\`]`),
    );
  });

  it('and the rail every collapsed pane needs is drawn for all three', () => {
    // A pane that can be collapsed and has no rail is a pane a finger can fold
    // away and never re-open, which on a phone is the whole route gone.
    const rail = readFileSync(join(SHELL, 'PaneRail.tsx'), 'utf8');
    for (const id of PANE_IDS) {
      expect(rail, `PaneRail has no icon for ${id}`).toMatch(new RegExp(`\\b${id}:`));
    }
    expect(rail).toMatch(/rail-expand-\$\{id\}|rail-expand/);
  });

  it('draws a rail wherever it draws a collapsible pane', () => {
    for (const file of ['DesktopLayout.tsx', 'TabletLayout.tsx']) {
      const src = sourceOf(file);
      const collapsedBranches = [...src.matchAll(/\.collapsed \?/g)].length;
      const rails = [...src.matchAll(/<PaneRail\b/g)].length;
      expect(
        rails,
        `${file} branches on collapsed ${collapsedBranches} time(s) and draws ${rails} rail(s)`,
      ).toBe(collapsedBranches);
      expect(collapsedBranches).toBeGreaterThan(0);
    }
  });
});

describe('the editor tab and the phone mode have exactly one home', () => {
  const srcFiles = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${name.name}`;
      if (name.isDirectory()) srcFiles(rel, out);
      else if (/\.tsx?$/.test(name.name)) out.push(rel);
    }
    return out;
  };
  const all = srcFiles('src');

  it.each(['editorTab', 'phoneMode'])(
    '%s is only ever set through the workspace store',
    (field) => {
      // `uiStore.set({ editorTab })` is the shape that made the tablet's copy
      // possible: two stores that could each answer "which editor", and only one
      // of them being read by the pane that draws it.
      const offenders = all.filter((f) => {
        const src = readFileSync(join(ROOT, f), 'utf8');
        return new RegExp(`useUiStore[\\s\\S]{0,40}?\\.set\\(\\{[^}]*\\b${field}\\b`).test(src);
      });
      expect(
        offenders,
        `${field} is layout and belongs to the workspace store. Setting it on the ui store is ` +
          'how a control came to change the tab, reveal the pane, and watch the pane draw ' +
          'something else on exactly one form factor.',
      ).toEqual([]);
    },
  );

  it('and the workspace store is where they are declared', () => {
    const model = readFileSync(join(ROOT, 'src/state/workspaceModel.ts'), 'utf8');
    expect(model).toMatch(/editorTab: EditorTab;/);
    expect(model).toMatch(/phoneMode: PhoneMode;/);
    expect(readFileSync(join(ROOT, 'src/state/uiStore.ts'), 'utf8')).not.toMatch(
      /^\s+(editorTab|phoneMode):\s*(EditorTab|PhoneMode|')/m,
    );
  });
});
