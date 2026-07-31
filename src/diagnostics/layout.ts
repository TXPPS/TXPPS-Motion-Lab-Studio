/**
 * Live layout measurements for the diagnostics panel and the QA debug overlay.
 * Everything here reads the DOM only — it never mutates layout.
 */

export interface OverflowEntry {
  label: string;
  overhangPx: number;
}

export interface LayoutSnapshot {
  viewportW: number;
  viewportH: number;
  visualW: number | null;
  visualH: number | null;
  dpr: number;
  breakpoint: string;
  workspace: string;
  docScrollW: number;
  docClientW: number;
  docScrollH: number;
  docClientH: number;
  docOverflowX: number;
  docOverflowY: number;
  arrScrollLeft: number | null;
  arrScrollTop: number | null;
  arrScrollW: number | null;
  arrScrollH: number | null;
  arrClientW: number | null;
  arrClientH: number | null;
  mixerScrollLeft: number | null;
  mixerScrollW: number | null;
  mixerClientW: number | null;
  panelSizes: string;
  safeArea: string;
  overflowing: OverflowEntry[];
}

function px(name: string): number {
  if (typeof getComputedStyle === 'undefined') return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function label(el: Element): string {
  const testid = el.getAttribute('data-testid');
  if (testid) return testid;
  // className is a string on HTML elements and an SVGAnimatedString on SVG ones
  const raw: unknown = el.className;
  const cls = typeof raw === 'string' ? raw : ((raw as { baseVal?: string })?.baseVal ?? '');
  const first = cls.split(/\s+/).filter(Boolean)[0];
  return first ? `.${first}` : el.tagName.toLowerCase();
}

/**
 * Elements painting outside the document's client width. Scroll *content* is
 * excluded by skipping anything inside an element that scrolls horizontally.
 */
export function findOverflowing(limit = 12): OverflowEntry[] {
  if (typeof document === 'undefined') return [];
  const clientW = document.documentElement.clientWidth;
  const out: OverflowEntry[] = [];
  const scrollers = new Set<Element>();
  for (const el of document.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') scrollers.add(el);
    }
  }
  const insideScroller = (el: Element) => {
    let p: Element | null = el.parentElement;
    while (p) {
      if (scrollers.has(p)) return true;
      p = p.parentElement;
    }
    return false;
  };
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const overhang = Math.max(r.right - clientW, -r.left);
    if (overhang > 1 && !insideScroller(el)) {
      out.push({ label: label(el), overhangPx: Math.round(overhang) });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function captureLayout(): LayoutSnapshot {
  const de = document.documentElement;
  const root = document.querySelector('[data-testid="app-root"]');
  const arr = document.querySelector<HTMLElement>('[data-testid="arr-scroll"]');
  const mixer = document.querySelector<HTMLElement>('[data-testid="mixer"]');
  const phoneMode = document.querySelector('[data-phone-mode]')?.getAttribute('data-phone-mode');
  const panels = [...document.querySelectorAll<HTMLElement>('[data-panel-id]')]
    .map(
      (p) =>
        `${p.getAttribute('data-panel-id')}:${Math.round(p.getBoundingClientRect().width)}x${Math.round(p.getBoundingClientRect().height)}`,
    )
    .join(' ');

  return {
    viewportW: window.innerWidth,
    viewportH: window.innerHeight,
    visualW: window.visualViewport ? Math.round(window.visualViewport.width) : null,
    visualH: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    dpr: Math.round((window.devicePixelRatio || 1) * 100) / 100,
    breakpoint: root?.getAttribute('data-layout') ?? 'unknown',
    workspace: phoneMode ?? (document.querySelector('[data-testid="mixer"]') ? 'mixer' : 'arrange'),
    docScrollW: de.scrollWidth,
    docClientW: de.clientWidth,
    docScrollH: de.scrollHeight,
    docClientH: de.clientHeight,
    docOverflowX: de.scrollWidth - de.clientWidth,
    docOverflowY: de.scrollHeight - de.clientHeight,
    arrScrollLeft: arr ? Math.round(arr.scrollLeft) : null,
    arrScrollTop: arr ? Math.round(arr.scrollTop) : null,
    arrScrollW: arr ? arr.scrollWidth : null,
    arrScrollH: arr ? arr.scrollHeight : null,
    arrClientW: arr ? arr.clientWidth : null,
    arrClientH: arr ? arr.clientHeight : null,
    mixerScrollLeft: mixer ? Math.round(mixer.scrollLeft) : null,
    mixerScrollW: mixer ? mixer.scrollWidth : null,
    mixerClientW: mixer ? mixer.clientWidth : null,
    panelSizes: panels || '(none)',
    safeArea: `t${px('--sat')} r${px('--sar')} b${px('--sab')} l${px('--sal')}`,
    overflowing: findOverflowing(),
  };
}

// Read-only probe used by the layout regression tests.
if (typeof window !== 'undefined') {
  (window as unknown as { __mlLayout?: unknown }).__mlLayout = {
    capture: captureLayout,
    findOverflowing,
  };
}

/** Plain-text block appended to the copyable diagnostic report. */
export function layoutReportLines(): string[] {
  const l = captureLayout();
  const range = (scroll: number | null, client: number | null) =>
    scroll === null || client === null ? 'n/a' : String(scroll - client);
  return [
    '--- Layout ---',
    `Viewport              : ${l.viewportW}x${l.viewportH} @${l.dpr}x`,
    `Visual viewport       : ${l.visualW ?? 'n/a'}x${l.visualH ?? 'n/a'}`,
    `Breakpoint / workspace: ${l.breakpoint} / ${l.workspace}`,
    `Document width        : scroll ${l.docScrollW} / client ${l.docClientW} (overflow ${l.docOverflowX})`,
    `Document height       : scroll ${l.docScrollH} / client ${l.docClientH} (overflow ${l.docOverflowY})`,
    `Arrangement scroll    : left ${l.arrScrollLeft ?? 'n/a'} top ${l.arrScrollTop ?? 'n/a'}`,
    `Arrangement range     : h ${range(l.arrScrollW, l.arrClientW)} v ${range(l.arrScrollH, l.arrClientH)}`,
    `Arrangement size      : scroll ${l.arrScrollW ?? 'n/a'}x${l.arrScrollH ?? 'n/a'} client ${l.arrClientW ?? 'n/a'}x${l.arrClientH ?? 'n/a'}`,
    `Mixer scroll          : left ${l.mixerScrollLeft ?? 'n/a'} range ${range(l.mixerScrollW, l.mixerClientW)}`,
    `Panel sizes           : ${l.panelSizes}`,
    `Safe area insets      : ${l.safeArea}`,
    `Overflowing elements  : ${
      l.overflowing.length === 0
        ? 'none'
        : l.overflowing.map((o) => `${o.label}(+${o.overhangPx}px)`).join(', ')
    }`,
  ];
}
