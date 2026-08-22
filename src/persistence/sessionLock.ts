/**
 * One writer per project.
 *
 * This is an installed PWA: two tabs, or a tab and a home-screen instance, will
 * happily restore the same project and then both autosave it every 1.5 seconds.
 * The loser's work is overwritten, and because a save also rewrites the single
 * backup, the copy that could have rescued it is overwritten too.
 *
 * So a tab takes an exclusive Web Lock on the project it opens. A tab that
 * cannot get the lock keeps working — locking someone out of their own session
 * is worse than the problem — but it does not autosave, and it says so. Saves
 * are announced on a BroadcastChannel so a read-only tab knows the document
 * underneath it has moved on.
 */
import { diagLog } from '../state/diagnostics';

export type LockState = 'unsupported' | 'held' | 'readonly';

interface Session {
  projectId: string;
  state: LockState;
  release: (() => void) | null;
}

const CHANNEL = 'motionlab.session';

let session: Session | null = null;
let channel: BroadcastChannel | null = null;
const listeners = new Set<(s: LockState) => void>();
const saveListeners = new Set<(msg: { projectId: string; modifiedAt: number }) => void>();

function notify(): void {
  const s = session?.state ?? 'unsupported';
  for (const fn of listeners) fn(s);
}

function ensureChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e) => {
    const data = e.data as { kind?: string; projectId?: string; modifiedAt?: number };
    if (data?.kind !== 'saved' || typeof data.projectId !== 'string') return;
    if (session && data.projectId === session.projectId && session.state === 'readonly') {
      for (const fn of saveListeners) {
        fn({ projectId: data.projectId, modifiedAt: data.modifiedAt ?? 0 });
      }
    }
  };
  return channel;
}

/** True when this tab owns the project and may autosave it. */
export function canWrite(): boolean {
  return session === null || session.state !== 'readonly';
}

export function lockState(): LockState {
  return session?.state ?? 'unsupported';
}

export function onLockChange(fn: (s: LockState) => void): () => void {
  listeners.add(fn);
  fn(lockState());
  return () => listeners.delete(fn);
}

export function onRemoteSave(
  fn: (msg: { projectId: string; modifiedAt: number }) => void,
): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}

/** Announce a successful save so other tabs know the document moved. */
export function announceSave(projectId: string, modifiedAt: number): void {
  ensureChannel()?.postMessage({ kind: 'saved', projectId, modifiedAt });
}

/**
 * Claim a project for this tab.
 *
 * The lock is held for as long as the tab lives, which is what makes it a
 * session lock: `navigator.locks.request` keeps it until its callback's promise
 * settles, so the callback holds a promise that only resolves on release.
 */
export async function claimProject(projectId: string): Promise<LockState> {
  releaseProject();
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) {
    session = { projectId, state: 'unsupported', release: null };
    notify();
    return 'unsupported';
  }

  return new Promise<LockState>((resolveState) => {
    let settled = false;
    void locks
      .request(
        `motionlab:project:${projectId}`,
        { mode: 'exclusive', ifAvailable: true },
        (lock) => {
          if (!lock) {
            session = { projectId, state: 'readonly', release: null };
            diagLog(
              'warn',
              `Another tab already has "${projectId}" open — this one will not autosave.`,
            );
            notify();
            settled = true;
            resolveState('readonly');
            return Promise.resolve();
          }
          return new Promise<void>((releaseLock) => {
            session = { projectId, state: 'held', release: () => releaseLock() };
            notify();
            if (!settled) {
              settled = true;
              resolveState('held');
            }
          });
        },
      )
      .catch(() => {
        // Some contexts (a sandboxed iframe) reject rather than reporting
        // unavailability. Treat that as "no locking", not as "read only".
        session = { projectId, state: 'unsupported', release: null };
        notify();
        if (!settled) {
          settled = true;
          resolveState('unsupported');
        }
      });
  });
}

/** Take over from the other tab. The other tab keeps working, read-only. */
export async function takeOver(): Promise<LockState> {
  const id = session?.projectId;
  if (!id) return lockState();
  releaseProject();
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks) return claimProject(id);
  // A steal is the only way to get a lock somebody else is holding; the holder
  // sees its lock released and drops to read-only through the same listener.
  return new Promise<LockState>((resolveState) => {
    void locks
      .request(`motionlab:project:${id}`, { mode: 'exclusive', steal: true }, () => {
        return new Promise<void>((releaseLock) => {
          session = { projectId: id, state: 'held', release: () => releaseLock() };
          notify();
          resolveState('held');
        });
      })
      .catch(() => resolveState(lockState()));
  });
}

export function releaseProject(): void {
  session?.release?.();
  session = null;
}
