import { create } from 'zustand';

export type PlayState = 'stopped' | 'playing';
export type AudioLifecycle =
  | 'uninitialized'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'interrupted'
  | 'error';

export interface MidiInputInfo {
  id: string;
  name: string;
}

interface TransportStoreState {
  playState: PlayState;
  /** Coarse position for text displays; the playhead reads the engine directly. */
  positionBeats: number;
  audioState: AudioLifecycle;
  audioError: string | null;
  sampleRate: number | null;
  activeSources: number;
  midiSupported: boolean;
  midiEnabled: boolean;
  midiInputs: MidiInputInfo[];
  midiSelectedId: string | null;
  midiActivity: number;
  midiLastEvent: string | null;

  set: (patch: Partial<TransportStoreState>) => void;
}

/** UI mirror of engine state. The AudioEngine is the only writer of audio fields. */
export const useTransportStore = create<TransportStoreState>((set) => ({
  playState: 'stopped',
  positionBeats: 0,
  audioState: 'uninitialized',
  audioError: null,
  sampleRate: null,
  activeSources: 0,
  midiSupported: false,
  midiEnabled: false,
  midiInputs: [],
  midiSelectedId: null,
  midiActivity: 0,
  midiLastEvent: null,
  set: (patch) => set(patch),
}));
