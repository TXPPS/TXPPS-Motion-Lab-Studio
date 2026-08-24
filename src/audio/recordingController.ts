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
import { projectBeatRangeSec, projectBeatsForSeconds } from '../model/music';
import { midiRecorder } from './midiRecorder';
import type { Track } from '../model/types';
import { diagLog } from '../state/diagnostics';
import { useInputStore } from '../state/inputStore';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { engine } from './engine';
import { livePeakTap } from './peakTap';
import { audioInput, DEFAULT_INPUT, type InputFormat } from './inputManager';
import type { FinishedTake } from './recorder';
import { recorderSupported, stashRecovery, TakeRecorder } from './recorder';
import { commitOrRecover, type TakeMeta } from './takeCommit';
import { onTransportStop, type TransportStopReason } from './transportStop';
import { CountIn } from './countIn';
import {
  captureWindow,
  getCountInBars,
  midiRecordTargetTrack,
  recordLatencySec,
  recordTargetTrack,
} from './takePlan';
import { usePrefsStore } from '../state/prefsStore';

class RecordingController {
  private recorder = new TakeRecorder();
  private countIn = new CountIn();
  /**
   * Which `start()` is the live one.
   *
   * `start()` awaits the audio engine, a microphone permission and a count-in,
   * and a stop can land across any of those. A boolean flag was not enough:
   * the next `start()` cleared it, so an older start resuming afterwards read
   * itself as live and trampled the take that had replaced it. A start that
   * finds the counter moved on releases what it holds and returns.
   */
  private startGeneration = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private captureStartBeat = 0;
  private trackId: string | null = null;
  private trackName = '';
  private deviceId = DEFAULT_INPUT;
  /** The format the current take's lease was taken at, so the release matches. */
  private deviceFormat: InputFormat = 1;
  /** True while this take is MIDI rather than audio. */
  private midi = false;
  /** The window the clip should cover, when punch is on. */
  private window: { startBeat: number; endBeat: number } | null = null;
  /** Fires the drop-out at the punch point. */
  private punchTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private unloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  /**
   * The commit a transport stop kicked off, so `stop()` has something to wait
   * for. It is null whenever nothing is in flight.
   */
  private finalising: Promise<void> | null = null;

  constructor() {
    // Registered for the life of the module. The controller is a singleton and
    // there is no point in the app's life at which a transport stop should be
    // allowed to leave a take running.
    onTransportStop((reason) => this.handleTransportStop(reason));
  }

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

    // MIDI first: an armed instrument track records what is played, and does
    // not need a microphone permission to do it.
    const midiTrack = midiRecordTargetTrack();
    if (midiTrack?.armed) return this.startMidi(midiTrack);

    if (!recorderSupported()) {
      store.set({ phase: 'error', lastRecordError: 'Recording is not supported in this browser.' });
      diagLog('error', 'MediaRecorder unavailable — cannot record');
      return false;
    }
    const track = recordTargetTrack();
    if (!track) {
      store.set({
        phase: 'error',
        lastRecordError: 'Arm an audio or instrument track before recording.',
      });
      return false;
    }

    // Captured as locals, not read back off `this`. A stop that lands mid-start
    // clears those fields immediately so the UI can go idle at once, and the
    // acquire it interrupted may not resolve until afterwards — reading `this`
    // in the unwind would then release nothing and leave the microphone open.
    const gen = ++this.startGeneration;
    const deviceId = track.inputDeviceId || DEFAULT_INPUT;
    // The take is captured in the track's own format, so a mono track produces
    // one channel rather than a stereo file with a dead side.
    const format: InputFormat = track.inputChannels === 2 ? 2 : 1;
    const owner = `record:${track.id}`;

    this.cancelled = false;
    this.trackId = track.id;
    this.trackName = track.name;
    this.deviceId = deviceId;
    this.deviceFormat = format;
    store.set({
      phase: 'arming',
      lastRecordError: null,
      recordTrackId: track.id,
      recordSeconds: 0,
    });

    const audioOk = await engine.start();
    if (this.startGeneration !== gen) return this.abandonStart(deviceId, owner, format);
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
    const source = await audioInput.acquire(deviceId, owner, ctx, format);
    if (this.startGeneration !== gen) return this.abandonStart(deviceId, owner, format);
    if (!source) {
      store.set({
        phase: 'error',
        lastRecordError: useInputStore.getState().lastError ?? 'Could not open the audio input.',
      });
      return false;
    }
    const stream = audioInput.streamFor(deviceId, format);
    if (!stream) {
      store.set({ phase: 'error', lastRecordError: 'Input stream unavailable.' });
      audioInput.release(deviceId, owner, format);
      return false;
    }

    this.installUnloadGuard();

    // The plan is settled before the count-in, not after it, because the
    // count-in has to click at the tempo of the beat the take rolls in from —
    // which is the punch point when there is one, not the playhead.
    //
    // Capture begins where the roll begins — earlier than the clip when there
    // is a pre-roll or a punch point — and the transport starts in the same
    // tick, so audio and timeline share an origin.
    const plan = captureWindow(useProjectStore.getState().project, engine.getPositionBeats());
    this.captureStartBeat = plan.rollBeat;
    this.window = plan.window;

    if (getCountInBars() > 0) {
      const ok = await this.runCountIn(plan.rollBeat);
      if (this.startGeneration !== gen) return this.abandonStart(deviceId, owner, format);
      if (!ok) return this.abandonStart(deviceId, owner, format);
    }

    if (!engine.isPlaying()) await engine.play(plan.rollBeat);
    // `engine.play` is async, and a stop pressed across that await retires this
    // start. Without the check the encoder would begin a moment after the
    // transport stopped — the reported bug arriving by a different door.
    if (this.startGeneration !== gen) return this.abandonStart(deviceId, owner, format);
    this.armPunchOut();

    // The live waveform taps the same source the take is captured from, so the
    // picture and the file are one performance rather than two measurements of
    // it. It is attached without awaiting: the take must not wait on a
    // decoration, and a tap that arrives a few milliseconds late simply starts
    // its envelope a few milliseconds in.
    void livePeakTap.attach(ctx, source);

    const started = this.recorder.start(stream);
    if (!started) {
      store.set({ phase: 'error', lastRecordError: 'The recorder failed to start.' });
      return this.abandonStart(deviceId, owner, format);
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

  /**
   * Unwind a start that was retired before it could begin capturing.
   *
   * Takes the device and owner as arguments for the reason given where they are
   * captured. It deliberately does not touch the phase: a newer take may
   * already own it, and the stop that retired this one has set it already.
   */
  private abandonStart(deviceId: string, owner: string, format: InputFormat): false {
    audioInput.release(deviceId, owner, format);
    livePeakTap.detach();
    this.removeUnloadGuard();
    return false;
  }

  /**
   * Count in, at the tempo of the beat the take will roll in from.
   *
   * Returns false when a transport stop landed during it, in which case
   * `start()` unwinds without capturing anything.
   */
  private runCountIn(atBeat: number): Promise<boolean> {
    useInputStore.getState().set({ phase: 'countIn' });
    return this.countIn.run(useProjectStore.getState().project, getCountInBars(), atBeat, {
      click: (accent) => engine.playMetronomeClick(accent),
      onBeat: (left) => useInputStore.getState().set({ countInBeatsLeft: left }),
    });
  }

  /**
   * Record MIDI rather than audio. There is no input device, no permission and
   * no encoder — only a count-in, the transport, and what is played.
   */
  private async startMidi(track: Track): Promise<boolean> {
    const store = useInputStore.getState();
    this.cancelled = false;
    this.trackId = track.id;
    this.trackName = track.name;
    this.midi = true;
    store.set({
      phase: 'arming',
      lastRecordError: null,
      recordTrackId: track.id,
      recordSeconds: 0,
    });

    const ok = await engine.start();
    if (!ok) {
      store.set({ phase: 'error', lastRecordError: 'Audio engine could not start.' });
      this.midi = false;
      return false;
    }

    this.installUnloadGuard();

    // Settled before the count-in, for the reason given in `start()`.
    const plan = captureWindow(useProjectStore.getState().project, engine.getPositionBeats());
    const startBeat = plan.rollBeat;
    this.captureStartBeat = startBeat;
    this.window = plan.window;

    if (getCountInBars() > 0) {
      const counted = await this.runCountIn(startBeat);
      if (!counted || this.cancelled) {
        this.midi = false;
        this.reset();
        return false;
      }
    }

    // Capture begins where the roll begins, and the transport starts in the
    // same tick, so notes and timeline share an origin.
    midiRecorder.start(track.id, startBeat, 0, plan.window ?? undefined);
    if (!engine.isPlaying()) await engine.play(startBeat);
    this.armPunchOut();

    store.set({
      phase: 'recording',
      recordingActive: true,
      recordSeconds: 0,
      countInBeatsLeft: 0,
    });
    const startedAt = performance.now();
    this.tickTimer = setInterval(() => {
      useInputStore.getState().set({ recordSeconds: (performance.now() - startedAt) / 1000 });
    }, 200);
    diagLog('info', `MIDI recording started on "${track.name}"`);
    return true;
  }

  /**
   * Ask for the current take to end, and wait for it to become a clip.
   *
   * The controller no longer stops the transport and then finalises. The
   * transport stop *is* the signal: this asks the engine to stop and awaits the
   * commit that its announcement started. That is what gives the Stop button,
   * the spacebar, the Show page, Control Link and a punch-out one order of
   * events — before, only this method had it, and the other five stopped the
   * clock while MediaRecorder went on capturing.
   */
  async stop(): Promise<void> {
    engine.stop('user');
    await this.finalising;
  }

  /**
   * A transport stop arrived. This is the ONLY place a take ends, which is what
   * makes every route to a stopped transport behave the same way.
   *
   * Everything here is synchronous. `MediaRecorder.stop()` is issued inside
   * this call, so the last chunk boundary is the stop instant and no audio
   * exists after it; a version that deferred the call to a microtask would let
   * one more chunk through. The decode and commit that follow cannot be
   * synchronous, so they run detached and `stop()` awaits them.
   *
   * Returns true when there was something to end, which is how the engine tells
   * a first stop press from a second one.
   */
  private handleTransportStop(reason: TransportStopReason): boolean {
    const phase = useInputStore.getState().phase;

    if (phase === 'arming') {
      // The stream is still opening. `start()` re-checks `cancelled` after
      // every await, so setting it here is what makes a stop pressed during the
      // permission prompt actually stop. Before, that stop was swallowed — the
      // guard read `phase !== 'recording'` — and the take began anyway a moment
      // later, which reads to the user as the record button ignoring them.
      this.cancelled = true;
      // Retire the start that is in flight. It re-checks the counter after
      // every await and releases the input it may by then have acquired.
      this.startGeneration += 1;
      this.cleanupInput();
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        countInBeatsLeft: 0,
        recordSeconds: 0,
      });
      this.reset();
      return true;
    }

    if (phase === 'countIn') {
      // Nothing has been captured yet, so there is nothing to keep. The machine
      // is put back to idle here rather than left for `start()` to unwind,
      // because `start()` unwinds one await later and until then the count-in
      // is still on screen and `isBusy` still refuses a new take.
      this.cancelled = true;
      this.startGeneration += 1;
      this.countIn.abort();
      this.cleanupInput();
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        countInBeatsLeft: 0,
        recordSeconds: 0,
      });
      this.reset();
      return true;
    }

    if (phase !== 'recording') return false;

    this.clearTick();
    this.clearPunchOut();

    // Read while the scheduler is still running. `engine.stop()` announces
    // before it parks the clock for exactly this reason: asked afterwards the
    // position would be the paused one, and the clip would end in the wrong
    // place.
    const endBeat = engine.getPositionBeats();

    if (this.midi) return this.endMidiTake(reason, endBeat);
    if (reason === 'user') return this.endAudioTake();
    return this.dropAudioTake(reason);
  }

  /** End a MIDI take: commit it on a plain stop, drop it otherwise. */
  private endMidiTake(reason: TransportStopReason, endBeat: number): boolean {
    this.midi = false;
    if (reason === 'user') {
      const clipId = midiRecorder.stop(Math.min(endBeat, this.window?.endBeat ?? endBeat));
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        ...(clipId ? {} : { lastRecordError: 'Nothing was played.' }),
      });
    } else {
      midiRecorder.cancel();
      useInputStore.getState().set({
        phase: 'idle',
        recordingActive: false,
        countInBeatsLeft: 0,
        recordSeconds: 0,
      });
      diagLog('info', `MIDI recording ended without a clip (${reason})`);
    }
    this.reset();
    return true;
  }

  /**
   * End an audio take and commit it. The encoder is stopped synchronously here;
   * only the blob it produces is awaited.
   */
  private endAudioTake(): boolean {
    useInputStore.getState().set({ phase: 'finalizing' });
    const pending = this.recorder.stop();
    const trackId = this.trackId;
    const trackName = this.trackName;
    const startBeat = this.captureStartBeat;
    const window = this.window ?? undefined;
    this.finalising = this.commitPendingTake(pending, {
      trackId,
      trackName,
      startBeat,
      window,
    }).finally(() => {
      this.finalising = null;
    });
    return true;
  }

  /**
   * End an audio take without making a clip of it — Escape, a panic, or the
   * project going away under it. The bytes are stashed rather than dropped: a
   * performance is worth more than the tidiness of discarding it.
   */
  private dropAudioTake(reason: TransportStopReason): boolean {
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
    useInputStore.getState().set({
      phase: 'idle',
      recordingActive: false,
      countInBeatsLeft: 0,
      recordSeconds: 0,
    });
    diagLog('info', `Recording ended without a clip (${reason})`);
    this.reset();
    return true;
  }

  /** Turn the finished blob into a clip, or keep it recoverable if it cannot be. */
  private async commitPendingTake(
    pending: Promise<FinishedTake | null>,
    meta: TakeMeta,
  ): Promise<void> {
    // Measured here, at the moment the take ends, rather than carried from when
    // it started: the engine may have been restarted mid-session and the figure
    // that matters is the one the audio actually came through.
    const latencySec = recordLatencySec(engine.latency(), usePrefsStore.getState().recordOffsetMs);
    const outcome = await commitOrRecover(
      pending,
      meta,
      engine.context,
      () => this.cleanupInput(),
      latencySec,
    );
    const store = useInputStore.getState();
    switch (outcome.kind) {
      case 'empty':
        store.set({
          phase: 'idle',
          recordingActive: false,
          lastRecordError: 'The recording produced no audio.',
        });
        break;
      case 'recovered':
        store.set({ phase: 'idle', recordingActive: false, lastRecordError: outcome.message });
        break;
      case 'committed':
        store.set({
          phase: 'idle',
          recordingActive: false,
          lastRecordError: outcome.silent
            ? 'Recorded, but the take is silent — check the input level.'
            : null,
          lastTake: {
            mediaId: outcome.mediaId,
            clipId: outcome.clipId,
            trackId: outcome.trackId,
            name: outcome.name,
            durationSec: outcome.durationSec,
            bytes: outcome.bytes,
            mimeType: outcome.mimeType,
            silent: outcome.silent,
          },
        });
        useUiStore.getState().selectClip(outcome.clipId, outcome.trackId);
        break;
    }
    this.reset();
  }

  /**
   * Abandon the current take without creating a clip.
   *
   * Routed through the engine rather than torn down here, so abandoning and
   * stopping share one path and cannot drift apart. That drift is what the
   * transport bug was.
   */
  cancel(): void {
    const phase = useInputStore.getState().phase;
    if (phase === 'idle') return;
    if (phase === 'error') {
      // Nothing is running; Escape is dismissing the message.
      useInputStore.getState().set({ phase: 'idle', lastRecordError: null });
      return;
    }
    engine.stop('abandon');
  }

  private cleanupInput(): void {
    // The tap comes down with the input it was reading. Left attached it would
    // keep appending to an envelope nothing is drawing, which is a leak whose
    // symptom is memory rather than sound.
    livePeakTap.detach();
    if (this.trackId)
      audioInput.release(this.deviceId, `record:${this.trackId}`, this.deviceFormat);
  }

  /**
   * Drop out of record at the punch point.
   *
   * The timer only has to be roughly right: what the clip covers is decided
   * from beats when the take is committed, so a few milliseconds of slop here
   * costs nothing but a few milliseconds of extra captured audio.
   */
  private armPunchOut(): void {
    this.clearPunchOut();
    const w = this.window;
    if (!w || !Number.isFinite(w.endBeat)) return;
    const project = useProjectStore.getState().project;
    const seconds = projectBeatRangeSec(
      project,
      this.captureStartBeat,
      Math.max(0, w.endBeat - this.captureStartBeat),
    );
    if (!(seconds > 0)) return;
    this.punchTimer = setTimeout(() => {
      this.punchTimer = null;
      if (useInputStore.getState().phase === 'recording') void this.stop();
    }, seconds * 1000);
  }

  private clearPunchOut(): void {
    if (this.punchTimer !== null) {
      clearTimeout(this.punchTimer);
      this.punchTimer = null;
    }
  }

  private clearTick(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private reset(): void {
    this.countIn.abort();
    this.clearTick();
    this.clearPunchOut();
    this.window = null;
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
