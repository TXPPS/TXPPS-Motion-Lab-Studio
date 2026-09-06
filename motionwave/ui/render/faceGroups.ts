/**
 * Motion Wave — a face's groups, as a tab strip and one control grid per tab.
 *
 * A face declares which control ids belong to which group; this builds the
 * strip and the grids and knows nothing else — not what a tap is, not which
 * unit it is drawing. Each grid is a `.mw-panel-controls` like the fascia's
 * own, so the breakpoint rules and the touch floor apply to every tab exactly
 * as they apply to the fascia, and the responsive cell brings each tab
 * forward before it measures. The strip is a WAI-ARIA tablist: the arrow
 * keys move between tabs, and each button is at least the touch minimum on
 * both axes (`panelCss.ts`).
 *
 * Split out of `facePanel.ts` when the two together crossed the four-hundred
 * line rule, which is the rule's intent: a renderer that draws a panel and a
 * renderer that draws a tab strip are two things.
 */
import type { FaceGroup } from '../harness/types';

export interface GroupStrip {
  /** The grid a control belongs in, or undefined for one that stays on the fascia. */
  homeOf(elementId: string): HTMLElement | undefined;
  /** Append the strip and its grids to the panel body, first tab forward. */
  mount(body: HTMLElement): void;
  ids(): readonly string[];
  show(groupId: string): void;
}

export function buildGroupStrip(
  doc: Document,
  groups: readonly FaceGroup[],
  panelId: string,
  title: string,
): GroupStrip {
  const groupOf = new Map<string, string>();
  for (const group of groups) {
    for (const elementId of group.elementIds) groupOf.set(elementId, group.id);
  }
  const grids = new Map<string, HTMLElement>();
  const tabs = new Map<string, HTMLButtonElement>();
  let active = groups[0]?.id ?? null;

  const show = (groupId: string): void => {
    if (!grids.has(groupId)) return;
    active = groupId;
    for (const [gid, grid] of grids) grid.hidden = gid !== groupId;
    for (const [gid, tab] of tabs) {
      tab.setAttribute('aria-selected', gid === groupId ? 'true' : 'false');
      tab.tabIndex = gid === groupId ? 0 : -1;
    }
  };

  let strip: HTMLElement | null = null;
  if (groups.length > 0) {
    strip = doc.createElement('div');
    strip.className = 'mw-panel-groups';
    strip.setAttribute('role', 'tablist');
    strip.setAttribute('aria-label', `${title} sections`);
    strip.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const order = groups.map((group) => group.id);
      const at = active === null ? 0 : order.indexOf(active);
      const step = event.key === 'ArrowRight' ? 1 : order.length - 1;
      const next = order[(at + step) % order.length];
      if (next === undefined) return;
      show(next);
      tabs.get(next)?.focus();
      event.preventDefault();
    });
    for (const group of groups) {
      const tab = doc.createElement('button');
      tab.type = 'button';
      tab.className = 'mw-group-tab';
      tab.setAttribute('role', 'tab');
      tab.dataset.mwGroup = group.id;
      tab.id = `${panelId}-tab-${group.id}`;
      tab.setAttribute('aria-controls', `${panelId}-group-${group.id}`);
      tab.textContent = group.label;
      tab.addEventListener('click', () => show(group.id));
      tabs.set(group.id, tab);
      strip.appendChild(tab);

      const grid = doc.createElement('div');
      grid.className = 'mw-panel-controls';
      grid.dataset.mwGroup = group.id;
      grid.id = `${panelId}-group-${group.id}`;
      grid.setAttribute('role', 'tabpanel');
      grid.setAttribute('aria-labelledby', tab.id);
      grids.set(group.id, grid);
    }
  }

  return {
    homeOf: (elementId) => {
      const gid = groupOf.get(elementId);
      return gid === undefined ? undefined : grids.get(gid);
    },
    mount(body) {
      if (strip === null) return;
      body.appendChild(strip);
      for (const grid of grids.values()) body.appendChild(grid);
      if (active !== null) show(active);
    },
    ids: () => groups.map((group) => group.id),
    show,
  };
}
