/**
 * Component-test environment.
 *
 * `tests/setup.ts` still owns the environment every test needs (fake-indexeddb,
 * structuredClone); this file adds only what mounting React into jsdom needs.
 * Both are listed in `setupFiles`, so this is additive rather than a second
 * copy of the first.
 *
 * It also owns the audio-engine double. The engine is the one dependency a
 * component cannot have in jsdom — there is no AudioContext — and every test
 * that mounts a control which reads a meter or moves the playhead needs the
 * same stand-in, so it lives here instead of being re-declared eight times.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, vi, type Mock } from 'vitest';
import { useProjectStore } from '../src/state/projectStore';
import { useUiStore } from '../src/state/uiStore';
import { useTransportStore } from '../src/state/transportStore';
import { useInputStore } from '../src/state/inputStore';
import { useWorkspaceStore } from '../src/state/workspaceStore';
import { useRouteStore } from '../src/state/routeStore';
import { useDiagnosticsStore } from '../src/state/diagnostics';
import { usePrefsStore } from '../src/state/prefsStore';
import { useKeymapStore } from '../src/state/keymapStore';

declare global {
  // React only allows state updates outside act() when this is set.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------- jsdom gaps

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

/**
 * A frame loop that actually fires, built on setTimeout so `vi.useFakeTimers`
 * drives it: a test advances time and the frame runs, instead of waiting on the
 * wall clock and hoping.
 */
const rafTimers = new Map<number, ReturnType<typeof setTimeout>>();
let rafSeq = 0;
globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
  const id = ++rafSeq;
  rafTimers.set(
    id,
    setTimeout(() => {
      rafTimers.delete(id);
      cb(performance.now());
    }, 16),
  );
  return id;
};
globalThis.cancelAnimationFrame = (id: number): void => {
  const timer = rafTimers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  rafTimers.delete(id);
};

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/**
 * jsdom performs no layout, so `offsetParent` is null for every element — and
 * the modal focus trap uses it to skip hidden controls, which would leave it
 * with nothing to focus. Reporting the parent element makes "in the document"
 * mean "visible", which is as close as a layout-free DOM gets.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement): Element | null {
    return this.parentElement;
  },
});

// ------------------------------------------------------------- engine double

interface MeterWatch {
  id: string;
  release: Mock<() => void>;
}

function createEngineStub() {
  const frameCallbacks = new Set<(dt: number) => void>();
  const meterWatches: MeterWatch[] = [];
  const stub = {
    /** No AudioContext in jsdom; the settings sheet reads this and says so. */
    context: null as AudioContext | null,
    /** What `getPositionBeats()` reports. Tests set it to place the playhead. */
    positionBeats: 0,
    /** Every `watchMeter` call, in order, with the release it handed back. */
    meterWatches,
    /** Run one engine frame, as the real rAF loop would. */
    frame: (dt = 0.016): void => {
      for (const cb of [...frameCallbacks]) cb(dt);
    },
    onFrame: vi.fn((cb: (dt: number) => void) => {
      frameCallbacks.add(cb);
      return () => frameCallbacks.delete(cb);
    }),
    watchMeter: vi.fn((id: string) => {
      const release: Mock<() => void> = vi.fn();
      meterWatches.push({ id, release });
      return release;
    }),
    getMeter: vi.fn(() => undefined),
    getPositionBeats: vi.fn(() => stub.positionBeats),
    seek: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    togglePlay: vi.fn(),
    returnToStart: vi.fn(),
    panic: vi.fn(),
    start: vi.fn(() => Promise.resolve(true)),
    isPlaying: vi.fn(() => false),
    audition: vi.fn(() => Promise.resolve(true)),
    auditioningId: vi.fn((): string | null => null),
    stopAudition: vi.fn(),
    inputLevel: vi.fn(() => 0),
    isMonitoring: vi.fn(() => false),
    startMonitoring: vi.fn(() => Promise.resolve(true)),
    stopMonitoring: vi.fn(),
    liveNoteOn: vi.fn(),
    liveNoteOff: vi.fn(),
    allNotesOff: vi.fn(),
    gainReductionOf: vi.fn(() => 0),
    effectTap: vi.fn(() => undefined),
    resetClipIndicators: vi.fn(),
    reset: (): void => {
      frameCallbacks.clear();
      meterWatches.length = 0;
      stub.context = null;
      stub.positionBeats = 0;
    },
  };
  return stub;
}

/**
 * The engine every component test sees. Mock the module with it:
 *
 *   vi.mock('../../src/audio/engine', async () => ({
 *     engine: (await import('../setup.tsx')).engineStub,
 *   }));
 */
export const engineStub = createEngineStub();

/**
 * `userEvent` with no delay between the events of one interaction: the whole
 * gesture is dispatched in one go, so a test never waits on the clock.
 *
 * Interactions must run on real timers. Testing Library drains its microtask
 * queue through a `setTimeout(0)` that it only advances when it detects JEST's
 * fake timers — under `vi.useFakeTimers()` that timeout never fires and every
 * `await user.click()` hangs. Tests that need a fake clock (a toast expiring,
 * a poll) drive the DOM with `fireEvent` instead, which is synchronous.
 */
export function setupUser(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ delay: null });
}

// ------------------------------------------------------- per-test isolation

const pristine = {
  project: useProjectStore.getState(),
  ui: useUiStore.getState(),
  transport: useTransportStore.getState(),
  input: useInputStore.getState(),
  workspace: useWorkspaceStore.getState(),
  route: useRouteStore.getState(),
  diagnostics: useDiagnosticsStore.getState(),
};

/**
 * Stores are module singletons, so without this the tenth test in a file runs
 * against whatever the first nine left behind.
 */
function resetStores(): void {
  useProjectStore.setState(pristine.project, true);
  useUiStore.setState(pristine.ui, true);
  useTransportStore.setState(pristine.transport, true);
  useInputStore.setState(pristine.input, true);
  useWorkspaceStore.setState(pristine.workspace, true);
  useRouteStore.setState(pristine.route, true);
  useDiagnosticsStore.setState(pristine.diagnostics, true);
  // These two own state outside their store — the document's theme attributes
  // and the keymap's translation table — so their own resets do the work.
  usePrefsStore.getState().reset();
  useKeymapStore.getState().resetAll();
  localStorage.clear();
}

beforeEach(() => {
  resetStores();
  engineStub.reset();
});

afterEach(() => {
  cleanup();
});
