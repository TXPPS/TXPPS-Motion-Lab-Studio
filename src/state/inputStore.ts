/**
 * Audio-input and recording UI state.
 *
 * Deliberately separate from the project store: these values change at device
 * and transport speed, and none of them belong in a saved project. The
 * AudioInputManager and Recorder are the only writers of the device fields.
 */
import { create } from 'zustand';
import type { InputDevice, PermissionState } from '../audio/inputManager';

export type RecordPhase =
  | 'idle'
  | 'arming' // opening the stream
  | 'countIn' // metronome running, not yet capturing
  | 'recording'
  | 'finalizing' // encoder flushing / decoding
  | 'error';

export interface TakeSummary {
  mediaId: string;
  clipId: string;
  trackId: string;
  name: string;
  durationSec: number;
  bytes: number;
  mimeType: string;
}

interface InputState {
  permission: PermissionState;
  devices: InputDevice[];
  lastError: string | null;

  activeStreams: number;
  activeTracks: number;

  /** true while a take is being captured — suppresses hide-time stream release */
  recordingActive: boolean;
  phase: RecordPhase;
  /** beats remaining in the count-in, 0 when not counting in */
  countInBeatsLeft: number;
  /** seconds captured so far in the current take */
  recordSeconds: number;
  recordTrackId: string | null;
  recorderMimeType: string | null;
  lastTake: TakeSummary | null;
  lastRecordError: string | null;
  /** monitoring input level 0..1, written by the engine frame loop */
  inputLevel: number;
  /** number of pending recovery records found at startup */
  pendingRecoveries: number;

  set: (patch: Partial<InputState>) => void;
}

export const useInputStore = create<InputState>((set) => ({
  permission: 'unknown',
  devices: [],
  lastError: null,

  activeStreams: 0,
  activeTracks: 0,

  recordingActive: false,
  phase: 'idle',
  countInBeatsLeft: 0,
  recordSeconds: 0,
  recordTrackId: null,
  recorderMimeType: null,
  lastTake: null,
  lastRecordError: null,
  inputLevel: 0,
  pendingRecoveries: 0,

  set: (patch) => set(patch),
}));

/** Human-readable permission label used by the UI and diagnostics. */
export function permissionLabel(p: PermissionState): string {
  switch (p) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
      return 'not yet requested';
    case 'unavailable':
      return 'unavailable in this browser';
    default:
      return 'unknown';
  }
}
