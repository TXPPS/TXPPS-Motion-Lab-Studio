/**
 * Recording controller — the single orchestrator for a take.
 *
 * Owns the state machine (idle → countIn → recording → finalizing → idle),
 * coordinates the input manager, the transport and the recorder, and is the
 * only place that decides where a captured clip lands on the timeline.
 *
 * Multitrack simultaneous recording is deliberately NOT offered: one
 * MediaRecorder per stream is reliable, but aligning several independently
 * encoded streams to one timeline is not, so the app records one armed track at
 * a time and says so.
 */
import { beatsPerBar, projectBeatsForSeconds } from '../model/music';
import type { Track } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { useInputStore } from '../state/inputStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { engine } from './engine';
import { audioInput, DEFAULT_INPUT } from './inputManager';
import { commitTake, recorderSupported, stashRecovery, TakeRecorder } from './recorder';

export interface RecordSettings {
  countInBars: number;
}

const settings: RecordSettings = { countInBars: 1 };

export function setCountInBars(bars: number): void {
  settings.countInBars = Math.max(0, Math.min(4, Math.round(bars)));
}

export function getCountInBars(): number {
  return settings.countInBars;
}

/** The track a take will be captured on: armed audio track, else selected. */
export function recordTargetTrack(): Track | null {
  const p = useProjectStore.getState().project;
  const sel = useUiStore.getState().selectedTrackId;
  const audio = p.tracks.filter((t) => t.type === 'audio');
  return audio.find((t) => t.armed) ?? audio.find((t) => t.id === sel) ?? null;
}

class RecordingController {
  private recorder = new TakeRecorder();
  private countInTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private captureStartBeat = 0;
  private trackId: string | null = null;
  private trackName = '';
  private deviceId = DEFAULT_INPUT;
  private cancelled = false;
  private unloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;

  get isRecording(): boolean {
    return useInputStore.getState().phase === 'recording';
  }

  get isBusy(): boolean {
    const p = useInputStore.getState().phase;
    return p === 'arming' || p === 'countIn' || p === 'recording' || p === 'finalizing';
  }

  /** Capturing or counting in — the states Escape should abandon. */
  isActive(): boolean {
    const p = useInputStore.getState().phase;
    return p === 'countIn' || p === 'recording';
  }

  /** Keyboard-friendly single entry point: start if idle, stop if capturing. */
  async toggle(): Promise<void> {
    if (this.isActive()) await this.stop();
    else if (!this.isBusy) await this.start();
  }

  /**
   * Begin a take. Opens the input, runs the count-in (if any) with the
   * metronome, starts the transport, then starts capturing.
   */
  async start(): Promise<boolean> {
    const store = useInputStore.getState();
    if (this.isBusy) return false;

    if (!recorderSupported()) {
      store.set({ phase: 'error', lastRecordError: 'Recording is not supported in this browser.' });
      diagLog('error', 'MediaRecorder unavailable — cannot record');
      return false;
    }
    const track = recordTargetTrack();
    if (!track) {
      store.set({
        phase: 'error',
        lastRecordError: 'Arm an audio track before recording.',
      });
      return false;
    }

    this.cancelled = false;
    this.trackId = track.id;
    this.trackName = track.name;
    this.deviceId = track.inputDeviceId || DEFAULT_INPUT;
    store.set({
      phase: 'arming',
      lastRecordError: null,
      recordTrackId: track.id,
      recordSeconds: 0,
    });

    const audioOk = await engine.start();
    if (!audioOk) {
      store.set({ phase: 'error', lastRecordError: 'Audio engine could not start.' });
      return false;
    }
    const ctx = engine.context;
    if (!ctx) {
      store.set({ phase: 'error', lastRecordError: 'No audio context.' });
      return false;
    }

    // Acquire the stream up front so permission problems surface before the
    // count-in rather than after it.
    const source = await audioInput.acquire(this.deviceId, `record:${track.id}`, ctx);
    if (!source || this.cancelled) {
      if (!this.cancelled) {
        store.set({
          phase: 'error',
          lastRecordError: useInputStore.getState().lastError ?? 'Could not open the audio input.',
        });
      } else {
        this.reset();
      }
      return false;
    }
    const stream = audioInput.streamFor(this.deviceId);
    if (!stream) {
      store.set({ phase: 'error', lastRecordError: 'Input stream unavailable.' });
      audioInput.release(this.deviceId, `record:${track.id}`);
      return false;
    }

    this.installUnloadGuard();

    if (settings.countInBars > 0) {
      const ok = await this.runCountIn();
      if (!ok || this.cancelled) {
        this.cleanupInput();
        this.reset();
        return false;
      }
    }

    // Capture begins at the transport's current position; the transport starts
    // in the same tick so audio and timeline share an origin.
    this.captureStartBeat = engine.getPositionBeats();
    if (!engine.isPlaying()) await engine.play(this.captureStartBeat);

    const started = this.recorder.start(stream);
    if (!started) {
      store.set({ phase: 'error', lastRecordError: 'The recorder failed to start.' });
      this.cleanupInput();
      this.reset();
      return false;
    }

    useInputStore.getState().set({
      phase: 'recording',
      recordingActive: true,
      recorderMimeType: this.recorder.mimeType,
      recordSeconds: 0,
      countInBeatsLeft: 0,
    });
    this.tickTimer = setInterval(() => {
      useInputStore.getState().set({ recordSeconds: this.recorder.elapsedSec });
    }, 200);
    return true;
  }

  /** Count-in: metronome for N bars at the current tempo, before capture. */
  private runCountIn(): Promise<boolean> {
    const p = useProjectStore.getState().project;
    const bpb = beatsPerBar(p.timeSig);
    const totalBeats = Math.round(bpb * settings.countInBars);
    const beatMs = (60 / p.bpm) * 1000;
    let left = totalBeats;
    useInputStore.getState().set({ phase: 'countIn', countInBeatsLeft: left });

    return new Promise<boolean>((resolve) => {
      const tick = () => {
        if (this.cancelled) {
          this.clearCountIn();
          resolve(false);
          return;
        }
        engine.playMetronomeClick(left % bpb === 0);
        left -= 1;
        useInputStore.getState().set({ countInBeatsLeft: Math.max(0, left) });
        if (left <= 0) {
          this.clearCountIn();
          resolve(true);
        }
      };
      tick(); // first click immediately
      this.countInTimer = setInterval(tick, beatMs);
    });
  }

  private clearCountIn(): void {
    if (this.countInTimer !== null) {
      clearInterval(this.countInTimer);
      this.countInTimer = null;
    }
    useInputStore.getState().set({ countInBeatsLeft: 0 });
  }

  /** Stop capturing and turn the take into a clip. */
  async stop(): Promise<void> {
    const store = useInputStore.getState();
    if (store.phase === 'countIn') {
      this.cancel();
      return;
    }
    if (store.phase !== 'recording') return;

    this.clearTick();
    store.set({ phase: 'finalizing' });
    const take = await this.recorder.stop();
    const trackId = this.trackId;
    const trackName = this.trackName;
    const startBeat = this.captureStartBeat;
    this.cleanupInput();
    engine.stop();

    if (!take || !trackId) {
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        lastRecordError: 'The recording produced no audio.',
      });
      diagLog('warn', 'Recording stopped but no audio was captured');
      this.reset();
      return;
    }

    const ctx = engine.context;
    if (!ctx) {
      // Keep the bytes rather than losing the performance.
      await stashRecovery(take.blob, take.mimeType, {
        trackId,
        trackName,
        startBeat,
        durationSec: take.durationSec,
      });
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        lastRecordError: 'Audio context lost — the take was saved for recovery.',
      });
      this.reset();
      return;
    }

    try {
      const result = await commitTake({ take, trackId, trackName, startBeat, ctx });
      if (!result) {
        await stashRecovery(take.blob, take.mimeType, {
          trackId,
          trackName,
          startBeat,
          durationSec: take.durationSec,
        });
        useInputStore.getState().set({
          phase: 'idle',
          recordingActive: false,
          lastRecordError:
            'The take could not be decoded and was saved for recovery instead of being discarded.',
        });
      } else {
        useInputStore.getState().set({
          phase: 'idle',
          recordingActive: false,
          lastRecordError: result.silent
            ? 'Recorded, but the take is silent — check the input level.'
            : null,
          lastTake: {
            mediaId: result.mediaRef.id,
            clipId: result.clipId,
            trackId,
            name: result.mediaRef.name,
            durationSec: result.durationSec,
            bytes: result.mediaRef.byteSize,
            mimeType: result.mediaRef.mimeType ?? 'unknown',
            silent: result.silent,
          },
        });
        useUiStore.getState().selectClip(result.clipId, trackId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await stashRecovery(take.blob, take.mimeType, {
        trackId,
        trackName,
        startBeat,
        durationSec: take.durationSec,
      }).catch(() => null);
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        lastRecordError: `Could not save the take (${msg}). It was kept for recovery.`,
      });
    }
    this.reset();
  }

  /** Abandon the current take without creating a clip. */
  cancel(): void {
    const phase = useInputStore.getState().phase;
    if (phase === 'idle') return;
    this.cancelled = true;
    this.clearCountIn();
    this.clearTick();

    // If audio was already captured, keep it recoverable rather than dropping it.
    const snapshot = this.recorder.snapshot();
    if (snapshot && snapshot.size > 0 && this.trackId) {
      void stashRecovery(snapshot, this.recorder.mimeType ?? 'audio/webm', {
        trackId: this.trackId,
        trackName: this.trackName,
        startBeat: this.captureStartBeat,
        durationSec: this.recorder.elapsedSec,
      });
    }
    this.recorder.abort();
    this.cleanupInput();
    engine.stop();
    useInputStore.getState().set({
      phase: 'idle',
      recordingActive: false,
      countInBeatsLeft: 0,
      recordSeconds: 0,
    });
    diagLog('info', 'Recording cancelled');
    this.reset();
  }

  private cleanupInput(): void {
    if (this.trackId) audioInput.release(this.deviceId, `record:${this.trackId}`);
  }

  private clearTick(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private reset(): void {
    this.clearCountIn();
    this.clearTick();
    this.trackId = null;
    this.trackName = '';
    this.cancelled = false;
    this.removeUnloadGuard();
    useInputStore.getState().set({ recordingActive: false, recordTrackId: null });
  }

  /** Warn before a reload discards an in-progress take. */
  private installUnloadGuard(): void {
    if (typeof window === 'undefined' || this.unloadHandler) return;
    this.unloadHandler = (e: BeforeUnloadEvent) => {
      if (!this.isBusy) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', this.unloadHandler);
  }

  private removeUnloadGuard(): void {
    if (this.unloadHandler && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.unloadHandler);
    }
    this.unloadHandler = null;
  }

  /** Elapsed capture time in beats, for the recording overlay. */
  elapsedBeats(): number {
    return projectBeatsForSeconds(
      useProjectStore.getState().project,
      this.captureStartBeat,
      this.recorder.elapsedSec,
    );
  }

  captureStart(): number {
    return this.captureStartBeat;
  }
}

export const recording = new RecordingController();
