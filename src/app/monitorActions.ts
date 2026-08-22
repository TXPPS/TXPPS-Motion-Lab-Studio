/**
 * Input monitoring, in one place.
 *
 * Monitoring is reachable from three surfaces now — the record workspace, the
 * channel strip and the track header — and each of them has to do the same four
 * things in the same order: tear down cleanly, ask for the microphone if it has
 * not been granted, open the device, and record on the track whether it
 * actually opened. Written out three times, the third copy is the one that
 * forgets to write `monitoring: false` when the device refuses, and the track
 * then shows a lit monitor button that is monitoring nothing.
 */
import { audioInput } from '../audio/inputManager';
import { engine } from '../audio/engine';
import { useInputStore } from '../state/inputStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

/** The device id a track monitors through, falling back to the system default. */
export const DEFAULT_INPUT = 'default';

export function isMonitoring(trackId: string): boolean {
  return engine.isMonitoring(trackId);
}

/**
 * Turn monitoring on or off for one track. Returns the state it ended in, so a
 * caller can report the outcome rather than assuming the click worked.
 *
 * The stored `monitoring` flag is written from what the engine actually did,
 * never from what was asked for: a track whose input could not be opened must
 * not show a lit button.
 */
export async function toggleMonitoring(trackId: string): Promise<boolean> {
  const store = useProjectStore.getState();
  const track = store.project.tracks.find((t) => t.id === trackId);
  if (!track || track.type !== 'audio') return false;

  if (engine.isMonitoring(trackId)) {
    engine.stopMonitoring(trackId);
    store.setTrack(trackId, { monitoring: false });
    return false;
  }

  if (useInputStore.getState().permission !== 'granted') {
    if (!(await audioInput.requestPermission())) {
      useUiStore.getState().toast('error', 'Microphone access is required to monitor input.');
      return false;
    }
  }

  const ok = await engine.startMonitoring(trackId, track.inputDeviceId || DEFAULT_INPUT);
  useProjectStore.getState().setTrack(trackId, { monitoring: ok });
  if (!ok) {
    useUiStore
      .getState()
      .toast('error', useInputStore.getState().lastError ?? 'Could not open the input.');
  }
  return ok;
}
