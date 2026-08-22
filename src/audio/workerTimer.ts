/**
 * A timer that keeps ticking when the tab is in the background.
 *
 * Browsers clamp `setInterval` in a hidden tab to once a second or less. The
 * transport scheduler runs on a 25 ms tick with a 150 ms lookahead, so a
 * backgrounded tab starves it and playback breaks up — which is exactly what
 * happens when a musician switches to a browser tab to read lyrics while a take
 * is running. Timers inside a dedicated worker are not clamped the same way, so
 * the tick is moved there.
 *
 * The worker is built from a Blob URL rather than a separate file so it needs no
 * build configuration and no network fetch, and it degrades to a plain interval
 * where Worker or createObjectURL is unavailable.
 */

const WORKER_SOURCE = `
let id = null;
self.onmessage = (e) => {
  if (e.data && e.data.kind === 'start') {
    if (id !== null) clearInterval(id);
    id = setInterval(() => self.postMessage('tick'), Math.max(1, e.data.ms | 0));
  } else if (e.data && e.data.kind === 'stop') {
    if (id !== null) clearInterval(id);
    id = null;
  }
};
`;

export interface SteadyTimer {
  stop(): void;
  /** true when the tick is coming from a worker rather than the main thread */
  readonly backgroundSafe: boolean;
}

let workerUrl: string | null = null;
let workerUnavailable = false;

function urlFor(): string | null {
  if (workerUnavailable) return null;
  if (workerUrl) return workerUrl;
  try {
    workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    return workerUrl;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

/** Start a repeating tick. Always returns a working timer. */
export function startSteadyTimer(ms: number, onTick: () => void): SteadyTimer {
  const url = typeof Worker === 'function' ? urlFor() : null;
  if (url) {
    try {
      const worker = new Worker(url);
      worker.onmessage = () => onTick();
      worker.postMessage({ kind: 'start', ms });
      return {
        backgroundSafe: true,
        stop() {
          try {
            worker.postMessage({ kind: 'stop' });
            worker.terminate();
          } catch {
            /* already gone */
          }
        },
      };
    } catch {
      // Some sandboxes forbid blob workers; fall through to the plain timer.
      workerUnavailable = true;
    }
  }
  const handle = setInterval(onTick, ms);
  return {
    backgroundSafe: false,
    stop() {
      clearInterval(handle);
    },
  };
}
