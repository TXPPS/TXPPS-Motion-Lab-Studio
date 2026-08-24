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

/**
 * How many channels a track takes from its input.
 *
 * A track format, not a device property: the same interface feeds a mono
 * vocal track and a stereo keyboard pair, and each has to be able to say which
 * it is. One channel is recorded as one channel and centred by the track's pan
 * law — not as a stereo file with silence down one side, which is what an
 * unconstrained capture produces on a two-input interface and what makes a
 * mono take pan half-way to the left when you touch the knob.
 */
export type InputFormat = 1 | 2;

interface Lease {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  refs: Set<string>;
  /** What was asked for. */
  wanted: InputFormat;
  /** What the device actually gave, which is not always what was asked. */
  granted: number;
}

export const DEFAULT_INPUT = 'default';

/** Recording/monitoring want raw signal, not voice-call processing. */
const CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * A lease is per device *and* per format.
 *
 * Keyed on the device alone, a mono vocal track and a stereo keyboard track on
 * the same interface would share whichever stream happened to open first, and
 * the second track would silently record in the other one's format.
 */
function leaseKey(deviceId: string, format: InputFormat): string {
  return `${deviceId || DEFAULT_INPUT}|${format}`;
}

/**
 * Open a stream at an exact channel count, falling back if the device refuses.
 *
 * `exact` first, because that is the only way to be sure what was captured: a
 * hint is free to be ignored, and the old code hinted at one channel and then
 * recorded whatever a two-input interface felt like giving — a "mono" take
 * that was a stereo file with a dead side. A device that genuinely cannot
 * satisfy the count throws `OverconstrainedError`, and the fallback takes what
 * it can get so the take still happens; `grantedChannels` then says what it
 * really was, and the caller reports the disagreement.
 */
async function openStream(deviceId: string, format: InputFormat): Promise<MediaStream> {
  const base: MediaTrackConstraints = { ...CONSTRAINTS };
  if (deviceId && deviceId !== DEFAULT_INPUT) base.deviceId = { exact: deviceId };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { ...base, channelCount: { exact: format } },
    });
  } catch (e) {
    if ((e as DOMException)?.name !== 'OverconstrainedError') throw e;
    diagLog(
      'warn',
      `Input "${deviceId || DEFAULT_INPUT}" cannot supply exactly ${format} channel(s) — asking for a best effort`,
    );
    return navigator.mediaDevices.getUserMedia({
      audio: { ...base, channelCount: { ideal: format } },
    });
  }
}

/**
 * What the stream actually carries.
 *
 * `getSettings().channelCount` is the authority, but it is optional in the spec
 * and some engines omit it; where it is missing the request is the best guess
 * available, and saying so is better than reporting a confident zero.
 */
function grantedChannels(stream: MediaStream, requested: InputFormat): number {
  const track = stream.getAudioTracks()[0];
  const n = track?.getSettings?.().channelCount;
  return typeof n === 'number' && n > 0 ? n : requested;
}

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
          // Lease keys carry the format, so the device is the part before the
          // separator — comparing the whole key would match nothing and no
          // unplugged device would ever be released.
          const device = key.slice(0, key.lastIndexOf('|'));
          if (device !== DEFAULT_INPUT && !ids.has(device)) {
            diagLog('warn', `Input device "${device}" disappeared — releasing its stream`);
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
    format: InputFormat = 1,
  ): Promise<MediaStreamAudioSourceNode | null> {
    if (!this.supported) return null;
    const key = leaseKey(deviceId, format);

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
        const stream = await openStream(deviceId, format);
        const source = ctx.createMediaStreamSource(stream);
        const granted = grantedChannels(stream, format);
        if (granted !== format) {
          // Reported rather than silently accepted. A device that cannot give
          // two channels is a fact about the hardware, and a user who chose
          // Stereo and got mono must be told rather than left to discover it in
          // the waveform.
          diagLog(
            'warn',
            `Input "${deviceId || DEFAULT_INPUT}" was asked for ${format} channel(s) and gave ${granted}`,
          );
        }
        const lease: Lease = { stream, source, refs: new Set(), wanted: format, granted };
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
        diagLog('info', `Audio input opened (${deviceId || DEFAULT_INPUT}, ${granted} ch)`);
        return lease;
      } catch (e) {
        const err = e as DOMException;
        useInputStore.getState().set({
          permission:
            err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'prompt',
          lastError: describeGumError(err),
        });
        diagLog(
          'error',
          `Could not open audio input "${deviceId || DEFAULT_INPUT}": ${describeGumError(err)}`,
        );
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
  release(deviceId: string, owner: string, format: InputFormat = 1): void {
    const key = leaseKey(deviceId, format);
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
  streamFor(deviceId: string, format: InputFormat = 1): MediaStream | null {
    return this.leases.get(leaseKey(deviceId, format))?.stream ?? null;
  }

  /**
   * How many channels the device actually delivered, or 0 if it is not open.
   *
   * Asked separately from what was requested because the two disagree on real
   * hardware: `exact: 2` on a single-input interface is refused, and the
   * fallback below takes what it can get.
   */
  grantedFormat(deviceId: string, format: InputFormat): number {
    return this.leases.get(leaseKey(deviceId, format))?.granted ?? 0;
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
