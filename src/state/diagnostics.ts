import { create } from 'zustand';

export type DiagLevel = 'info' | 'warn' | 'error';

export interface DiagEntry {
  time: number;
  level: DiagLevel;
  message: string;
}

export interface SmokeResult {
  name: string;
  pass: boolean;
  detail: string;
}

interface DiagnosticsState {
  entries: DiagEntry[];
  smokeStatus: 'idle' | 'running' | 'pass' | 'fail';
  smokeResults: SmokeResult[];
  log: (level: DiagLevel, message: string) => void;
  clear: () => void;
  setSmoke: (status: DiagnosticsState['smokeStatus'], results: SmokeResult[]) => void;
}

const MAX_ENTRIES = 200;

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  entries: [],
  smokeStatus: 'idle',
  smokeResults: [],
  log: (level, message) =>
    set((s) => ({
      entries: [...s.entries.slice(-(MAX_ENTRIES - 1)), { time: Date.now(), level, message }],
    })),
  clear: () => set({ entries: [] }),
  setSmoke: (smokeStatus, smokeResults) => set({ smokeStatus, smokeResults }),
}));

export function diagLog(level: DiagLevel, message: string): void {
  useDiagnosticsStore.getState().log(level, message);
}

let consoleCaptured = false;

/** Mirror console warnings/errors and uncaught errors into the diagnostics log. */
export function installConsoleCapture(): void {
  if (consoleCaptured || typeof window === 'undefined') return;
  consoleCaptured = true;
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const stringify = (args: unknown[]) =>
    args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ')
      .slice(0, 500);
  console.warn = (...args: unknown[]) => {
    diagLog('warn', stringify(args));
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    diagLog('error', stringify(args));
    origError(...args);
  };
  window.addEventListener('error', (e) => {
    // "ResizeObserver loop completed with undelivered notifications" is a
    // browser notice, not an application fault: it means observations were
    // still pending when the frame ended, which is normal when many canvases
    // mount at once. Recording it as an error would make the error count —
    // the thing someone reads first in a bug report — cry wolf.
    if (/ResizeObserver loop/i.test(e.message)) {
      diagLog('warn', `Benign: ${e.message}`);
      return;
    }
    diagLog('error', `Uncaught: ${e.message} (${e.filename}:${e.lineno})`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    diagLog('error', `Unhandled rejection: ${reason.slice(0, 300)}`);
  });
}
