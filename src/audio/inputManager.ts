/**
 * AudioInputManager — the ONLY caller of getUserMedia in the application.
 *
 * Rules enforced here:
 *  - permission is never requested at startup, only from an explicit user action
 *  - one MediaStream per device id, reference-counted, released when unused
 *  - one MediaStreamAudioSourceNode per stream (Web Audio requires this anyway)
 *  - device labels are only read after permission is granted
 *  - every stream is stopped on panic, page hide, or last release
 *
 * UI components never touch MediaStreams; they ask this manager for a source
 * node and release it when done.
 */
import { diagLog } from '../state/diagnostics';
import { useInputStore } from '../state/inputStore';

export type PermissionState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';

export interface InputDevice {
  deviceId: string;
  label: string;
  isDefault: boolean;
}

interface Lease {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  refs: Set<string>;
}

export const DEFAULT_INPUT = 'default';

/** Recording/monitoring want raw signal, not voice-call processing. */
const CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: { ideal: 1 },
};

class AudioInputManager {
  private leases = new Map<string, Lease>();
  private pending = new Map<string, Promise<Lease | null>>();
  private deviceListenerAttached = false;

  get supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function'
    );
  }

  /** Read permission state without prompting, where the browser supports it. */
  async probePermission(): Promise<PermissionState> {
    const store = useInputStore.getState();
    if (!this.supported) {
      store.set({ permission: 'unavailable' });
      return 'unavailable';
    }
    try {
      // Permissions API is not universal (notably older Safari) — absence is
      // not an error, it just means we stay at 'unknown' until asked.
      const q = (navigator.permissions as Permissions | undefined)?.query;
      if (!q) return store.permission;
      const status = await navigator.permissions.query({
        name: 'microphone' as PermissionName,
      });
      const mapped: PermissionState =
        status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt';
      store.set({ permission: mapped });
      status.onchange = () => {
        const next = status.state;
        useInputStore.getState().set({
          permission: next === 'granted' ? 'granted' : next === 'denied' ? 'denied' : 'prompt',
        });
        if (next === 'granted') void this.refreshDevices();
      };
      if (mapped === 'granted') void this.refreshDevices();
      return mapped;
    } catch {
      return store.permission;
    }
  }

  /**
   * Explicitly request microphone access. Must be called from a user gesture.
   * Returns true when access is granted.
   */
  async requestPermission(): Promise<boolean> {
    const store = useInputStore.getState();
    if (!this.supported) {
      store.set({ permission: 'unavailable', lastError: 'Audio input is not supported here' });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: CONSTRAINTS });
      // We only wanted the grant; release immediately so no capture indicator
      // stays on until the user actually arms a track.
      for (const t of stream.getTracks()) t.stop();
      store.set({ permission: 'granted', lastError: null });
      diagLog('info', 'Microphone permission granted');
      await this.refreshDevices();
      return true;
    } catch (e) {
      const err = e as DOMException;
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      const missing = err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError';
      store.set({
        permission: denied ? 'denied' : missing ? 'unavailable' : 'prompt',
        lastError: describeGumError(err),
      });
      diagLog('warn', `Microphone permission failed: ${describeGumError(err)}`);
      return false;
    }
  }

  /** Enumerate inputs. Labels are only meaningful once permission is granted. */
  async refreshDevices(): Promise<InputDevice[]> {
    if (!this.supported || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === 'audioinput');
      const devices: InputDevice[] = inputs.map((d, i) => ({
        deviceId: d.deviceId || DEFAULT_INPUT,
        // Empty labels mean permission has not been granted yet — never invent one.
        label: d.label || (d.deviceId === DEFAULT_INPUT ? 'Default input' : `Input ${i + 1}`),
        isDefault: d.deviceId === DEFAULT_INPUT || d.deviceId === '',
      }));
      useInputStore.getState().set({ devices });
      this.attachDeviceListener();
      return devices;
    } catch (e) {
      diagLog('warn', `Could not enumerate audio inputs: ${String(e)}`);
      return [];
    }
  }

  private attachDeviceListener(): void {
    if (this.deviceListenerAttached || !this.supported) return;
    if (!navigator.mediaDevices.addEventListener) return;
    this.deviceListenerAttached = true;
    navigator.mediaDevices.addEventListener('devicechange', () => {
      diagLog('info', 'Audio input devices changed');
      void this.refreshDevices().then((devices) => {
        // If a device that is currently held disappeared, release it cleanly.
        const ids = new Set(devices.map((d) => d.deviceId));
        for (const [key, lease] of this.leases) {
          if (key !== DEFAULT_INPUT && !ids.has(key)) {
            diagLog('warn', `Input device "${key}" disappeared — releasing its stream`);
            this.hardRelease(key, lease);
          }
        }
      });
    });
  }

  /**
   * Acquire a source node for a device, shared between monitoring and
   * recording. `owner` identifies the consumer so refcounting stays correct
   * when the same device is used for both at once.
   */
  async acquire(
    deviceId: string,
    owner: string,
    ctx: AudioContext,
  ): Promise<MediaStreamAudioSourceNode | null> {
    if (!this.supported) return null;
    const key = deviceId || DEFAULT_INPUT;

    const existing = this.leases.get(key);
    if (existing) {
      existing.refs.add(owner);
      this.publishActive();
      return existing.source;
    }
    const pending = this.pending.get(key);
    if (pending) {
      const lease = await pending;
      if (!lease) return null;
      lease.refs.add(owner);
      this.publishActive();
      return lease.source;
    }

    const task = (async (): Promise<Lease | null> => {
      try {
        const audio: MediaTrackConstraints = { ...CONSTRAINTS };
        if (key !== DEFAULT_INPUT) audio.deviceId = { exact: key };
        const stream = await navigator.mediaDevices.getUserMedia({ audio });
        const source = ctx.createMediaStreamSource(stream);
        const lease: Lease = { stream, source, refs: new Set() };
        this.leases.set(key, lease);
        useInputStore.getState().set({ permission: 'granted', lastError: null });
        // A track ending (unplugged, taken by another app) must not linger.
        for (const t of stream.getAudioTracks()) {
          t.addEventListener('ended', () => {
            diagLog('warn', `Input track ended unexpectedly (${t.label || key})`);
            this.hardRelease(key, lease);
          });
        }
        void this.refreshDevices();
        diagLog('info', `Audio input opened (${key})`);
        return lease;
      } catch (e) {
        const err = e as DOMException;
        useInputStore.getState().set({
          permission:
            err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'prompt',
          lastError: describeGumError(err),
        });
        diagLog('error', `Could not open audio input "${key}": ${describeGumError(err)}`);
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();

    this.pending.set(key, task);
    const lease = await task;
    if (!lease) return null;
    lease.refs.add(owner);
    this.publishActive();
    return lease.source;
  }

  /** Release one consumer's hold; the stream stops when the last one leaves. */
  release(deviceId: string, owner: string): void {
    const key = deviceId || DEFAULT_INPUT;
    const lease = this.leases.get(key);
    if (!lease) return;
    lease.refs.delete(owner);
    if (lease.refs.size === 0) this.hardRelease(key, lease);
    else this.publishActive();
  }

  private hardRelease(key: string, lease: Lease): void {
    try {
      lease.source.disconnect();
    } catch {
      /* already disconnected */
    }
    for (const t of lease.stream.getTracks()) t.stop();
    this.leases.delete(key);
    this.publishActive();
    diagLog('info', `Audio input released (${key})`);
  }

  /** Stop every stream — used by panic and by page-hide handling. */
  stopAll(): void {
    for (const [key, lease] of [...this.leases]) this.hardRelease(key, lease);
  }

  activeStreamCount(): number {
    return this.leases.size;
  }

  /** Live track states for diagnostics. */
  activeTrackStates(): { device: string; readyState: string; muted: boolean; label: string }[] {
    const out: { device: string; readyState: string; muted: boolean; label: string }[] = [];
    for (const [key, lease] of this.leases) {
      for (const t of lease.stream.getAudioTracks()) {
        out.push({ device: key, readyState: t.readyState, muted: t.muted, label: t.label });
      }
    }
    return out;
  }

  /** The raw stream for a held device (used by the recorder). */
  streamFor(deviceId: string): MediaStream | null {
    return this.leases.get(deviceId || DEFAULT_INPUT)?.stream ?? null;
  }

  private publishActive(): void {
    useInputStore.getState().set({
      activeStreams: this.leases.size,
      activeTracks: this.activeTrackStates().length,
    });
  }
}

export function describeGumError(err: DOMException | undefined): string {
  if (!err) return 'Unknown input error';
  switch (err.name) {
    case 'NotAllowedError':
      return 'Microphone access was blocked. Allow it in your browser site settings.';
    case 'SecurityError':
      return 'Microphone access requires a secure (https) connection.';
    case 'NotFoundError':
      return 'No audio input device was found.';
    case 'NotReadableError':
      return 'The audio input is in use by another application.';
    case 'OverconstrainedError':
      return 'The selected input device is no longer available.';
    case 'AbortError':
      return 'Opening the audio input was aborted.';
    default:
      return err.message || err.name;
  }
}

export const audioInput = new AudioInputManager();

if (typeof document !== 'undefined') {
  // Releasing on hide prevents a stuck recording indicator when a phone locks.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !useInputStore.getState().recordingActive) {
      audioInput.stopAll();
    }
  });
}
