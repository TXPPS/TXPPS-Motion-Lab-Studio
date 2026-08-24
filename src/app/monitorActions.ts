/**
 * Arming and input monitoring, in one place.
 *
 * Both are reachable from several surfaces — the record workspace, the channel
 * strip, the track header and the inspector — and each of them has to do the
 * same things in the same order: work out whether the input should be open and
 * whether it should be heard, ask for the microphone if it has not been
 * granted, open the device, and record on the track whether it actually
 * opened. Written out four times, the fourth copy is the one that forgets to
 * write `monitoring: false` when the device refuses, and the track then shows a
 * lit monitor button that is monitoring nothing.
 *
 * So there is one reconciler. Arming, un-arming, the monitor button and a
 * device change all reduce to the same question, and it is answered here.
 */
import { audioInput, type InputFormat } from '../audio/inputManager';
import { engine } from '../audio/engine';
import type { Track } from '../model/types';
import { useInputStore } from '../state/inputStore';
import { usePrefsStore } from '../state/prefsStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

/** The device id a track monitors through, falling back to the system default. */
export const DEFAULT_INPUT = 'default';

export function inputDeviceOf(track: Track): string {
  return track.inputDeviceId || DEFAULT_INPUT;
}

/** Mono unless the track says otherwise — what every project recorded before. */
export function inputFormatOf(track: Track): InputFormat {
  return track.inputChannels === 2 ? 2 : 1;
}

/** Open and audible. This is what a lit monitor button means. */
export function isMonitoring(trackId: string): boolean {
  return engine.isMonitoring(trackId);
}

/** Open at all — enough for the meter to read, whether or not it is heard. */
export function isInputOpen(trackId: string): boolean {
  return engine.isInputOpen(trackId);
}

/**
 * What the stored state says the engine should be doing with this track's input.
 *
 * Pure, so the rule can be tested without a device. Arming opens the input even
 * when it is not to be heard, because an armed track with a dead meter is
 * indistinguishable from a broken microphone — which is exactly how it was
 * reported.
 */
export function wantedInput(
  track: Track | undefined,
  prefs: { openInputOnArm: boolean },
): { open: boolean; audible: boolean } {
  if (!track || track.type !== 'audio') return { open: false, audible: false };
  const audible = track.monitoring === true;
  return { open: audible || (track.armed && prefs.openInputOnArm), audible };
}

/**
 * Make the engine's input state match the track's stored state.
 *
 * `mayPrompt` is false for anything the user did not just do — loading a
 * project, syncing after a device change. A saved project with an armed track
 * must not put a microphone prompt on screen before its first frame; that is
 * the rule `audioInput` is built around and it is not weakened here.
 *
 * Returns whether the input ended up open.
 */
export async function syncTrackInput(
  trackId: string,
  opts: { mayPrompt?: boolean } = {},
): Promise<boolean> {
  const track = useProjectStore.getState().project.tracks.find((t) => t.id === trackId);
  const want = wantedInput(track, usePrefsStore.getState());
  if (!want.open || !track) {
    engine.closeInput(trackId);
    return false;
  }

  if (useInputStore.getState().permission !== 'granted') {
    if (!opts.mayPrompt) return false;
    if (!(await audioInput.requestPermission())) {
      // The stored flags are corrected rather than left lying: a monitor button
      // that is lit while permission is denied is the failure this file exists
      // to prevent.
      if (want.audible) useProjectStore.getState().setTrack(trackId, { monitoring: false });
      useUiStore.getState().toast('error', 'Microphone access is required to use an input.');
      return false;
    }
  }

  const ok = await engine.openInput(
    trackId,
    inputDeviceOf(track),
    want.audible,
    inputFormatOf(track),
  );
  if (!ok) {
    if (want.audible) useProjectStore.getState().setTrack(trackId, { monitoring: false });
    useUiStore
      .getState()
      .toast('error', useInputStore.getState().lastError ?? 'Could not open the input.');
  }
  return ok;
}

/**
 * Arm or disarm a track.
 *
 * With `monitorFollowsArm` on — the default, and what the reference recommends
 * — monitoring mirrors the arm. The user can still press the monitor button
 * afterwards to disagree with it; the two only re-synchronise at the next arm
 * change, which is what makes the preference an option rather than a lock.
 */
export async function setArmed(trackId: string, armed: boolean): Promise<void> {
  const store = useProjectStore.getState();
  const track = store.project.tracks.find((t) => t.id === trackId);
  if (!track) return;

  const prefs = usePrefsStore.getState();
  const patch: Partial<Track> = { armed };
  if (track.type === 'audio' && prefs.monitorFollowsArm) patch.monitoring = armed;
  store.setTrack(trackId, patch);
  if (track.type === 'audio') await syncTrackInput(trackId, { mayPrompt: armed });
}

/**
 * Turn monitoring on or off for one track. Returns the state it ended in, so a
 * caller can report the outcome rather than assuming the click worked.
 *
 * The stored `monitoring` flag is written from what the engine actually did,
 * never from what was asked for.
 */
export async function toggleMonitoring(trackId: string): Promise<boolean> {
  const store = useProjectStore.getState();
  const track = store.project.tracks.find((t) => t.id === trackId);
  if (!track || track.type !== 'audio') return false;

  const next = !engine.isMonitoring(trackId);
  store.setTrack(trackId, { monitoring: next });
  await syncTrackInput(trackId, { mayPrompt: next });
  return engine.isMonitoring(trackId);
}

/**
 * Follow a track to a different input device.
 *
 * Written here rather than at the picker so the engine is reopened on the new
 * device even when the track is only armed — a device change that moved the
 * monitor but not the meter would be its own small version of the same lie.
 */
export async function setTrackInputDevice(trackId: string, deviceId: string): Promise<void> {
  useProjectStore.getState().setTrack(trackId, { inputDeviceId: deviceId });
  await syncTrackInput(trackId, { mayPrompt: true });
}

/**
 * Switch a track between a mono input and a stereo pair.
 *
 * The stream has to be reopened, not reconfigured: the channel count is a
 * `getUserMedia` constraint, so the device is asked again with the new one and
 * the lease is keyed on both.
 */
export async function setTrackInputFormat(trackId: string, format: InputFormat): Promise<void> {
  useProjectStore.getState().setTrack(trackId, { inputChannels: format });
  await syncTrackInput(trackId, { mayPrompt: true });
}
