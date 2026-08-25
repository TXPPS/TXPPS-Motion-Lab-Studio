/**
 * What the reachability sweep looks for, and where it looks from.
 *
 * Split out of `scripts/reachability.mjs`, which had reached 880 lines against
 * a house rule of about 400 — and which is the file every reachability claim in
 * this project rests on, so the debt was the wrong one to carry further. The
 * split is a move: `npm run probe:mutations` ran before it and after it and
 * every verdict is the same, which is the only evidence worth having that a
 * refactor of a measuring instrument changed nothing.
 *
 * The target table is data and belongs on its own. It is also the part most
 * likely to be edited by somebody adding a surface, and it is much easier to
 * add one to a file that is only a list.
 */
const BASE = process.env.REACH_BASE ?? 'http://localhost:4173';
const JSON_ONLY = process.argv.includes('--json');
/** Where the remote environment keeps its browser, when it has one. */
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';

/** The form factors the product claims to serve. */
const ALL_FORMS = [
  { id: 'phone-portrait', width: 390, height: 844, kind: 'phone' },
  { id: 'phone-landscape', width: 844, height: 390, kind: 'phone' },
  { id: 'tablet-portrait', width: 768, height: 1024, kind: 'tablet' },
  { id: 'tablet-landscape', width: 1024, height: 768, kind: 'tablet' },
  { id: 'desktop', width: 1440, height: 900, kind: 'desktop' },
];

/**
 * A reduced sweep, for the probe mutation driver.
 *
 * One form factor and a handful of targets runs in well under a minute, which
 * is what makes it affordable to run this sweep once per recorded probe
 * correction. The scope is applied identically to the baseline and the mutant,
 * so it can flatter neither — and the full sweep is what still writes the
 * matrix, so nothing about the report is narrowed by this existing.
 */
const only = (name) => (process.env[name] ?? '').split(',').filter(Boolean);
const FORM_SCOPE = only('REACH_FORMS');
const TARGET_SCOPE = only('REACH_TARGETS');
const FORMS =
  FORM_SCOPE.length > 0 ? ALL_FORMS.filter((f) => FORM_SCOPE.includes(f.id)) : ALL_FORMS;

/**
 * The surfaces Directive 11 §5 names, plus the ones around them.
 *
 * `selector` is what the surface renders as. `reach` is a list of things to try
 * to get there, each a phone-nav id, an editor tab, or a store call named after
 * the user action it stands for.
 */
const TARGETS = [
  { id: 'notefx-rack', label: 'MIDI/note FX rack', selector: '[data-testid^="notefx-rack-"]' },
  {
    id: 'notefx-add',
    label: 'add a note FX (arpeggiator)',
    selector: '[data-testid^="notefx-add-"]',
  },
  /*
   * The lane, not the button that shows it.
   *
   * `auto-toggle-*` was a target and it is a desktop widget: the header's mini
   * buttons are `display: none` below the desktop breakpoint, so it read as a
   * phone and tablet defect forever. The function is not missing there — the
   * track's long-press menu carries "Show automation lanes" and "Add automation
   * lane…" on every form factor. Targeting the button measured which widget a
   * layout uses; targeting the lane measures whether a user can get automation
   * on screen, which is the thing §5 says must not differ.
   */
  { id: 'automation-lane', label: 'automation lane', selector: '[data-testid^="auto-lane-"]' },
  {
    id: 'sends',
    label: 'sends rack',
    selector: '[data-testid^="send-rack-"], [data-testid^="send-"]',
  },
  {
    id: 'cue-mix',
    label: 'cue mixes',
    selector: '[data-testid="cue-main"], [data-testid="cue-add"]',
  },
  { id: 'zone-editor', label: 'sampler zone editor', selector: '[data-testid="zone-map"]' },
  { id: 'score-view', label: 'score view', selector: '[data-testid="score-view"]' },
  {
    id: 'freeze',
    label: 'freeze a track',
    selector: '[data-testid="freeze-state"], [data-testid^="frozen-"]',
  },
  {
    id: 'insert-rack',
    label: 'insert rack',
    selector: '[data-testid^="fx-rack-"], [data-testid^="device-add-"]',
  },
  { id: 'device-window', label: 'a device editor', selector: '[data-testid="plugin-window"]' },
  { id: 'drum-editor', label: 'drum editor', selector: '[data-testid="drum-editor"]' },
  {
    id: 'sampler',
    label: 'sampler',
    selector: '[data-testid="smp-rack"], [data-testid="pad-grid"]',
  },
  { id: 'piano-roll', label: 'piano roll', selector: '[data-testid="piano-roll"]' },
  { id: 'mixer', label: 'mixer', selector: '[data-testid="mixer"]' },
  { id: 'arrangement', label: 'arrangement', selector: '[data-testid="arrangement"]' },
  { id: 'browser', label: 'browser', selector: '[data-testid="browser-panel"]' },
  { id: 'inspector', label: 'inspector', selector: '[data-testid="inspector"]' },
  {
    id: 'settings',
    label: 'settings',
    selector: '[data-testid="settings-sheet"], [data-testid="open-settings"]',
  },
  {
    id: 'diagnostics',
    label: 'diagnostics',
    selector: '[data-testid="diagnostics-panel"], [data-testid="open-diagnostics"]',
  },
  {
    id: 'export',
    label: 'export / bounce',
    selector: '[data-testid="export-sheet"], [data-testid="export-run"]',
  },
  { id: 'groove', label: 'groove panel', selector: '[data-testid="groove-panel"]' },
  { id: 'chords', label: 'chord assistant', selector: '[data-testid="chord-assistant"]' },
  { id: 'audio-editor', label: 'audio editor', selector: '[data-testid="audio-editor"]' },
  { id: 'take-review', label: 'take review', selector: '[data-testid="take-review"]' },
  {
    id: 'shortcuts',
    label: 'keyboard shortcuts',
    selector: '[data-testid="shortcuts-sheet"], [data-testid="key-commands"]',
  },
];

if (TARGET_SCOPE.length > 0) {
  for (let i = TARGETS.length - 1; i >= 0; i -= 1) {
    if (!TARGET_SCOPE.includes(TARGETS[i].id)) TARGETS.splice(i, 1);
  }
}

export {
  BASE,
  JSON_ONLY,
  PREINSTALLED_CHROMIUM,
  ALL_FORMS,
  FORMS,
  FORM_SCOPE,
  TARGET_SCOPE,
  TARGETS,
};
