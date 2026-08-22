/**
 * Hash routing.
 *
 * The app grew from one workspace to four top-level pages, and until now
 * "navigation" was `window.location.hash.includes('qa')` evaluated
 * independently in three modules — order-dependent, unaddressable, and with
 * nowhere for a second page to live. This is the single place a URL is read or
 * written.
 *
 * Grammar
 * -------
 *   #/<page>[/<fixture>][?flag&flag]
 *
 * Pages: `start`, `song` (default), `mastering`, `show`.
 * Legacy one-word hashes shipped in earlier builds — `#/qa`, `#/qa-huge`,
 * `#/phone`, `#/diagnostics`, `#/demo`, `#/debug` — keep working exactly as
 * they did; they are parsed as flags on the song page. Every QA fixture route
 * in the README still resolves.
 */

export type PageId = 'start' | 'song' | 'mastering' | 'show';

/** QA fixtures, longest id first so prefix matching cannot mis-resolve. */
export const QA_FIXTURES = [
  'qa-audio-edit',
  'qa-automation',
  'qa-multisample',
  'qa-sampler',
  'qa-drums',
  'qa-audio',
  'qa-midi',
  'qa-huge',
  'qa-max',
  'qa',
] as const;

export type QaFixture = (typeof QA_FIXTURES)[number];

export interface Route {
  page: PageId;
  /** QA fixture to load instead of a saved project; never autosaved. */
  fixture: QaFixture | null;
  /** `#/demo` — reseed the demo project. */
  reseedDemo: boolean;
  /** `#/phone` — force the phone layout on any screen, for QA. */
  forcePhone: boolean;
  /** `#/diagnostics` — open the diagnostics sheet on load. */
  openDiagnostics: boolean;
  /** QA layout overlay. */
  debugOverlay: boolean;
  /** The hash this route was parsed from, for diagnostics. */
  raw: string;
}

const PAGES: Record<string, PageId> = {
  start: 'start',
  home: 'start',
  song: 'song',
  arrange: 'song',
  mastering: 'mastering',
  master: 'mastering',
  project: 'mastering',
  show: 'show',
  live: 'show',
};

export const DEFAULT_ROUTE: Route = {
  page: 'song',
  fixture: null,
  reseedDemo: false,
  forcePhone: false,
  openDiagnostics: false,
  debugOverlay: false,
  raw: '',
};

function matchFixture(token: string): QaFixture | null {
  for (const f of QA_FIXTURES) if (token === f) return f;
  return null;
}

export function parseHash(hash: string): Route {
  const raw = hash || '';
  const [pathPart, queryPart] = raw.replace(/^#\/?/, '').split('?');
  const tokens = pathPart.split('/').filter(Boolean);
  const flags = new Set((queryPart ?? '').split('&').filter(Boolean));

  const route: Route = { ...DEFAULT_ROUTE, raw };
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (PAGES[lower]) {
      route.page = PAGES[lower];
      continue;
    }
    const fixture = matchFixture(lower);
    if (fixture) {
      route.fixture = fixture;
      continue;
    }
    // Legacy single-word hashes.
    if (lower === 'phone') route.forcePhone = true;
    else if (lower === 'diagnostics') route.openDiagnostics = true;
    else if (lower === 'demo') route.reseedDemo = true;
    else if (lower === 'debug') route.debugOverlay = true;
  }
  if (flags.has('phone')) route.forcePhone = true;
  if (flags.has('diagnostics')) route.openDiagnostics = true;
  if (flags.has('debug')) route.debugOverlay = true;
  // A fixture route always wants the layout overlay, as `#/qa` always did.
  if (route.fixture) route.debugOverlay = true;
  return route;
}

export function buildHash(route: Partial<Route>): string {
  const parts: string[] = [route.page && route.page !== 'song' ? route.page : 'song'];
  if (route.fixture) parts.push(route.fixture);
  const flags: string[] = [];
  if (route.forcePhone) flags.push('phone');
  if (route.openDiagnostics) flags.push('diagnostics');
  if (route.debugOverlay && !route.fixture) flags.push('debug');
  return `#/${parts.join('/')}${flags.length ? `?${flags.join('&')}` : ''}`;
}

export function currentRoute(): Route {
  return parseHash(typeof window === 'undefined' ? '' : window.location.hash);
}

/** Navigate without reloading. A no-op when the hash would not change. */
export function navigate(page: PageId): void {
  const next = buildHash({ ...currentRoute(), page });
  if (window.location.hash !== next) window.location.hash = next;
}
