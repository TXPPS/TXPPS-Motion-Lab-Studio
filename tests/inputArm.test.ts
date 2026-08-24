/**
 * Directive 09 §2.2 and §2.5 — arming a track has to do something.
 *
 * The report was "no input from a mic". Arming wrote one field and nothing
 * else: no device was opened, `engine.inputLevel` returned 0 for any track that
 * was not monitoring, so the meter sat dead and the only way to hear or see
 * anything was to find a second button. An armed track with a dead meter is
 * indistinguishable from a broken microphone, and the user drew the reasonable
 * conclusion.
 *
 * Arming now opens the input — metered always, audible by preference. These
 * cases are written to fail against the old behaviour.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../src/model/types';
import { createEmptyProject } from '../src/model/demoProject';
import { useProjectStore } from '../src/state/projectStore';
import { useInputStore } from '../src/state/inputStore';
import { usePrefsStore, DEFAULT_PREFS } from '../src/state/prefsStore';

const openInput = vi.fn(async () => true);
const closeInput = vi.fn();
const monitoringOf = new Map<string, boolean>();
const openOf = new Map<string, boolean>();

vi.mock('../src/audio/engine', () => ({
  engine: {
    openInput: async (id: string, _dev: string, audible: boolean) => {
      // A refused open leaves nothing open, which is what the real engine does
      // and is the whole point of the caller reading the result back rather
      // than assuming it worked.
      const ok = await openInput();
      if (ok) {
        openOf.set(id, true);
        monitoringOf.set(id, audible);
      }
      return ok;
    },
    closeInput: (id: string) => {
      closeInput(id);
      openOf.set(id, false);
      monitoringOf.set(id, false);
    },
    isInputOpen: (id: string) => openOf.get(id) === true,
    isMonitoring: (id: string) => monitoringOf.get(id) === true,
    setInputAudible: (id: string, a: boolean) => monitoringOf.set(id, a),
  },
}));

const requestPermission = vi.fn(async () => true);
vi.mock('../src/audio/inputManager', () => ({
  DEFAULT_INPUT: 'default',
  audioInput: {
    requestPermission: () => requestPermission(),
  },
}));

const {
  setArmed,
  syncTrackInput,
  toggleMonitoring,
  setTrackInputDevice,
  wantedInput,
  // A dynamic import so the two `vi.mock` factories above are installed before
  // the module under test resolves them.
} = await import('../src/app/monitorActions');

function track(patch: Partial<Track> = {}): Track {
  return {
    id: 'a1',
    type: 'audio',
    name: 'Audio 1',
    color: '#888',
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    collapsed: false,
    output: 'master',
    ...patch,
  } as Track;
}

/** Put one audio track in the project store and return its id. */
function seed(patch: Partial<Track> = {}): string {
  const p = createEmptyProject('Arm');
  p.tracks = [track(patch)];
  useProjectStore.getState().setProject(p, { markClean: true });
  return 'a1';
}

const stored = () => useProjectStore.getState().project.tracks[0];

beforeEach(() => {
  openInput.mockClear();
  closeInput.mockClear();
  requestPermission.mockClear();
  requestPermission.mockImplementation(async () => true);
  openInput.mockImplementation(async () => true);
  monitoringOf.clear();
  openOf.clear();
  usePrefsStore.getState().set({ ...DEFAULT_PREFS });
  useInputStore.getState().set({ permission: 'granted', lastError: null });
});

describe('what the stored state asks of the input', () => {
  it('wants nothing when the track is neither armed nor monitored', () => {
    expect(wantedInput(track(), DEFAULT_PREFS)).toEqual({ open: false, audible: false });
  });

  it('wants the input open, and silent, on an armed track', () => {
    // This is the case that was missing. Open, because the meter must read;
    // silent, because whether it is heard is a separate question.
    expect(wantedInput(track({ armed: true }), DEFAULT_PREFS)).toEqual({
      open: true,
      audible: false,
    });
  });

  it('wants it audible when the track monitors', () => {
    expect(wantedInput(track({ armed: true, monitoring: true }), DEFAULT_PREFS)).toEqual({
      open: true,
      audible: true,
    });
  });

  it('monitors an unarmed track — monitoring is not a consequence of arming', () => {
    expect(wantedInput(track({ monitoring: true }), DEFAULT_PREFS)).toEqual({
      open: true,
      audible: true,
    });
  });

  it('leaves an armed track closed when the preference says so', () => {
    expect(wantedInput(track({ armed: true }), { openInputOnArm: false })).toEqual({
      open: false,
      audible: false,
    });
  });

  it('wants nothing from an instrument track, which has no device', () => {
    expect(wantedInput(track({ type: 'instrument', armed: true }), DEFAULT_PREFS)).toEqual({
      open: false,
      audible: false,
    });
  });
});

describe('arming a track', () => {
  it('opens its input', async () => {
    const id = seed();
    await setArmed(id, true);
    // Against the old code this is 0: arming wrote `{ armed: true }` and
    // nothing opened a device at all.
    expect(openInput).toHaveBeenCalledTimes(1);
  });

  it('monitors it too, by default', async () => {
    const id = seed();
    await setArmed(id, true);
    expect(stored().monitoring).toBe(true);
    expect(monitoringOf.get(id)).toBe(true);
  });

  it('opens the input silently when monitoring does not follow the arm', async () => {
    usePrefsStore.getState().set({ monitorFollowsArm: false });
    const id = seed();
    await setArmed(id, true);
    // Still open — otherwise the meter is dead and the microphone looks broken.
    expect(openInput).toHaveBeenCalledTimes(1);
    expect(monitoringOf.get(id)).toBe(false);
    expect(stored().monitoring).toBeUndefined();
  });

  it('opens nothing when the preference says arming should not', async () => {
    usePrefsStore.getState().set({ openInputOnArm: false, monitorFollowsArm: false });
    const id = seed();
    await setArmed(id, true);
    expect(openInput).not.toHaveBeenCalled();
  });

  it('closes the input again when the track is disarmed', async () => {
    const id = seed();
    await setArmed(id, true);
    await setArmed(id, false);
    expect(stored().armed).toBe(false);
    expect(stored().monitoring).toBe(false);
    expect(closeInput).toHaveBeenCalledWith(id);
  });

  it('does not touch monitoring on an instrument track', async () => {
    const id = seed({ type: 'instrument' });
    await setArmed(id, true);
    expect(stored().monitoring).toBeUndefined();
    expect(openInput).not.toHaveBeenCalled();
  });
});

describe('when the device will not open', () => {
  it('does not leave a lit monitor button monitoring nothing', async () => {
    openInput.mockImplementation(async () => false);
    const id = seed();
    await setArmed(id, true);
    // The stored flag is written from what the engine did, never from what was
    // asked for.
    expect(stored().monitoring).toBe(false);
  });

  it('does not leave one lit when permission is refused either', async () => {
    requestPermission.mockImplementation(async () => false);
    useInputStore.getState().set({ permission: 'prompt' });
    const id = seed();
    await setArmed(id, true);
    expect(stored().monitoring).toBe(false);
    expect(openInput).not.toHaveBeenCalled();
  });
});

describe('the microphone prompt', () => {
  it('is raised by an arm the user just pressed', async () => {
    useInputStore.getState().set({ permission: 'prompt' });
    const id = seed();
    await setArmed(id, true);
    expect(requestPermission).toHaveBeenCalled();
  });

  it('is not raised by a reconcile the user did not ask for', async () => {
    // A project saved with an armed track must not put a permission prompt on
    // screen before its first frame. That rule is the reason `audioInput` is
    // the only caller of getUserMedia, and it is not weakened by this feature.
    useInputStore.getState().set({ permission: 'prompt' });
    const id = seed({ armed: true });
    await syncTrackInput(id);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(openInput).not.toHaveBeenCalled();
  });

  it('is not raised by disarming', async () => {
    useInputStore.getState().set({ permission: 'prompt' });
    const id = seed({ armed: true });
    await setArmed(id, false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('the monitor button', () => {
  it('turns monitoring on independently of the arm', async () => {
    const id = seed();
    expect(await toggleMonitoring(id)).toBe(true);
    expect(stored().monitoring).toBe(true);
    expect(stored().armed).toBe(false);
  });

  it('turns it off again while leaving an armed track metered', async () => {
    const id = seed();
    await setArmed(id, true);
    expect(await toggleMonitoring(id)).toBe(false);
    // Silenced, not closed: the track is still armed, so the meter must still
    // read.
    expect(openOf.get(id)).toBe(true);
    expect(monitoringOf.get(id)).toBe(false);
  });

  it('reports the state the engine ended in, not the one that was asked for', async () => {
    openInput.mockImplementation(async () => false);
    const id = seed();
    expect(await toggleMonitoring(id)).toBe(false);
  });
});

describe('changing a track input device', () => {
  it('reopens the device even when the track is only armed', async () => {
    usePrefsStore.getState().set({ monitorFollowsArm: false });
    const id = seed();
    await setArmed(id, true);
    openInput.mockClear();
    await setTrackInputDevice(id, 'usb-2');
    // A device change that moved the monitor but not the meter would be its own
    // small version of the same lie.
    expect(stored().inputDeviceId).toBe('usb-2');
    expect(openInput).toHaveBeenCalledTimes(1);
  });
});
