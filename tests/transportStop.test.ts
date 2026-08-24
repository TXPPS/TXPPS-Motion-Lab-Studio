/**
 * Directive 09 §2.1 — "transport stop does not stop".
 *
 * The reported symptom was that recording continued after Stop was pressed.
 * The cause was not the Stop button: it was that MotionLab had two transport
 * owners with a one-way dependency. `recording.stop()` called `engine.stop()`,
 * and nothing called back, so the six routes that reached `engine.stop()`
 * directly — the Stop button, the spacebar, the Show page's toggle, Control
 * Link's MMC stop, loading a project, the diagnostics self-test — halted the
 * clock and left MediaRecorder capturing.
 *
 * These cases are written to fail against that code. The load-bearing ones are
 * `ends a take that the Stop button stopped` and `no chunk is captured after
 * the stop instant`: revert `announceTransportStop` out of `engine.stop()` and
 * both fail by name.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  announceTransportStop,
  onTransportStop,
  transportStopListenerCount,
  type TransportStopReason,
} from '../src/audio/transportStop';
import { TakeRecorder } from '../src/audio/recorder';
import { engine } from '../src/audio/engine';
import { recording } from '../src/audio/recordingController';
import { useInputStore } from '../src/state/inputStore';
import { useTransportStore } from '../src/state/transportStore';

/**
 * Let the detached commit chain run to completion.
 *
 * Microtask turns alone are not enough: the recovery stash goes through
 * IndexedDB, whose callbacks arrive on macrotasks, so this alternates the two.
 */
async function settle(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Poll until the recorder is idle, or fail loudly rather than hang. */
async function untilIdle(ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (recording.isBusy && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(recording.isBusy).toBe(false);
}

function phase() {
  return useInputStore.getState().phase;
}

beforeEach(() => {
  useInputStore.getState().set({
    phase: 'idle',
    recordingActive: false,
    recordSeconds: 0,
    countInBeatsLeft: 0,
    recordTrackId: null,
    lastRecordError: null,
  });
  useTransportStore.getState().set({ positionBeats: 0, playState: 'stopped' });
});

describe('the transport stop announcement', () => {
  const added: Array<() => void> = [];
  afterEach(() => {
    for (const off of added.splice(0)) off();
  });

  it('reaches every listener and reports that one of them had work', () => {
    const seen: TransportStopReason[] = [];
    added.push(onTransportStop((r) => (seen.push(r), false)));
    added.push(onTransportStop((r) => (seen.push(r), true)));
    expect(announceTransportStop('user')).toBe(true);
    expect(seen).toEqual(['user', 'user']);
  });

  it('reports no work when nothing was in flight', () => {
    added.push(onTransportStop(() => false));
    expect(announceTransportStop('user')).toBe(false);
  });

  it('runs listeners synchronously, before the announce call returns', () => {
    let ran = false;
    added.push(
      onTransportStop(() => {
        ran = true;
        return true;
      }),
    );
    announceTransportStop('user');
    // Not `await`ed: a listener that deferred its MediaRecorder.stop() to a
    // microtask would let one more chunk boundary through, which is the
    // reported bug in a smaller size.
    expect(ran).toBe(true);
  });

  it('carries on past a listener that throws, so a recorder fault cannot strand the clock', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let reached = false;
    added.push(
      onTransportStop(() => {
        throw new Error('recorder exploded');
      }),
    );
    added.push(
      onTransportStop(() => {
        reached = true;
        return true;
      }),
    );
    expect(announceTransportStop('user')).toBe(true);
    expect(reached).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('unsubscribes', () => {
    const before = transportStopListenerCount();
    const off = onTransportStop(() => false);
    expect(transportStopListenerCount()).toBe(before + 1);
    off();
    expect(transportStopListenerCount()).toBe(before);
  });

  it('has the recording controller attached to it', () => {
    // The controller registers in its constructor, so importing it is enough.
    // If this ever reads zero, every case below is testing nothing.
    expect(transportStopListenerCount()).toBeGreaterThan(0);
  });
});

describe('a take ends when the transport stops, whichever route stopped it', () => {
  it('ends a take that the Stop button stopped', async () => {
    useInputStore.getState().set({ phase: 'recording', recordingActive: true });
    // Exactly what `TransportBar`'s stop button does.
    engine.stop();
    // Within one block: the encoder has already been told, and the controller
    // has left the recording state. Against the old code this reads
    // 'recording' and the take runs on for ever.
    expect(phase()).toBe('finalizing');
    await settle();
    expect(phase()).toBe('idle');
    expect(useInputStore.getState().recordingActive).toBe(false);
  });

  it('ends a take that the spacebar stopped', async () => {
    useInputStore.getState().set({ phase: 'recording', recordingActive: true });
    // `useKeyboard` binds space to togglePlay, which reaches stop() when playing
    // and the return-to-start branch when not. Both must end the take.
    engine.togglePlay();
    expect(phase()).toBe('finalizing');
    await settle();
    expect(phase()).toBe('idle');
  });

  it('ends a take on panic, keeping the bytes rather than committing them', async () => {
    useInputStore.getState().set({ phase: 'recording', recordingActive: true });
    engine.panic();
    // Panic pulls the input stream out from under the encoder, so the take is
    // stashed rather than turned into a clip — and it is over either way.
    await settle();
    expect(phase()).toBe('idle');
    expect(useInputStore.getState().recordingActive).toBe(false);
  });

  it('ends a take when Escape abandons it', async () => {
    useInputStore.getState().set({ phase: 'recording', recordingActive: true });
    recording.cancel();
    await settle();
    expect(phase()).toBe('idle');
  });

  it('ends a take when `recording.stop()` is awaited, and the take is done when it resolves', async () => {
    useInputStore.getState().set({ phase: 'recording', recordingActive: true });
    await recording.stop();
    // `stop()` awaits the commit its own announcement started; if it returned
    // before the commit, this would still read 'finalizing'.
    expect(phase()).toBe('idle');
  });

  it('leaves an idle transport alone', async () => {
    engine.stop();
    await settle();
    expect(phase()).toBe('idle');
  });
});

describe('a stop that lands before capture has begun', () => {
  it('abandons a count-in instead of letting it run on into a take', () => {
    useInputStore.getState().set({ phase: 'countIn', countInBeatsLeft: 4 });
    engine.stop();
    expect(phase()).not.toBe('countIn');
    expect(useInputStore.getState().countInBeatsLeft).toBe(0);
  });

  it('does not treat the count-in stop as a second press and jump to the start', () => {
    // The transport is not yet rolling during a count-in, so the old
    // `if (!this.playing)` branch read the press as the second of two and
    // zeroed the playhead — moving the take the user had lined up.
    useTransportStore.getState().set({ positionBeats: 12 });
    engine.seek(12);
    useInputStore.getState().set({ phase: 'countIn', countInBeatsLeft: 4 });
    engine.stop();
    expect(engine.getPositionBeats()).toBe(12);
  });

  it('still returns to start on a genuine second stop press', () => {
    engine.seek(12);
    expect(engine.getPositionBeats()).toBe(12);
    engine.stop(); // nothing recording, nothing playing — the second-press branch
    expect(engine.getPositionBeats()).toBe(0);
  });

  it('is not swallowed while the input is still being opened', () => {
    // `arming` is the permission prompt. The old guard was
    // `if (phase !== 'recording') return`, so a stop pressed here did nothing
    // at all and the take began a moment later anyway.
    useInputStore.getState().set({ phase: 'arming' });
    expect(announceTransportStop('user')).toBe(true);
  });
});

describe('the encoder stops at the stop instant', () => {
  class FakeRecorder {
    static isTypeSupported(): boolean {
      return true;
    }
    state: 'inactive' | 'recording' = 'recording';
    mimeType = 'audio/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(
      public stream: unknown,
      public opts?: unknown,
    ) {}
    /** Push a chunk, as a real encoder does on its timeslice. */
    emit(bytes: number): void {
      if (this.state !== 'recording') throw new Error('emitted after stop');
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
    }
    start(): void {
      this.state = 'recording';
    }
    /**
     * Chromium defers `onstop`; Firefox and Safari can fire it inside the call
     * when there is nothing left to flush. Both are legal, and the recorder has
     * to be right under either, so cases pick the one they are about.
     */
    asyncStop = false;
    stop(): void {
      this.state = 'inactive';
      if (this.asyncStop) queueMicrotask(() => this.onstop?.());
      else this.onstop?.();
    }
  }

  let made: FakeRecorder[] = [];
  const realMR = globalThis.MediaRecorder;

  beforeEach(() => {
    made = [];
    globalThis.MediaRecorder = new Proxy(FakeRecorder, {
      construct(target, args) {
        const r = new (target as unknown as new (...a: unknown[]) => FakeRecorder)(...args);
        made.push(r);
        return r as unknown as object;
      },
    }) as unknown as typeof MediaRecorder;
  });
  afterEach(() => {
    globalThis.MediaRecorder = realMR;
  });

  it('calls MediaRecorder.stop() in the same synchronous turn', () => {
    const r = new TakeRecorder();
    expect(r.start({} as MediaStream)).toBe(true);
    void r.stop();
    // No await between `stop()` and this assertion. A deferred stop would still
    // read 'recording' here, and everything the encoder captured in the
    // meantime would be inside the take.
    expect(made[0].state).toBe('inactive');
  });

  it('captures no chunk after the stop instant', async () => {
    const r = new TakeRecorder();
    r.start({} as MediaStream);
    made[0].emit(100);
    made[0].emit(100);
    const done = r.stop();
    // The encoder is already inactive, so a chunk arriving now is not merely
    // excluded from the blob — it cannot be produced at all.
    expect(() => made[0].emit(100)).toThrow('emitted after stop');
    const take = await done;
    expect(take).not.toBeNull();
    expect(take?.blob.size).toBe(200);
  });

  it('stops the next take too, when onstop fires synchronously', async () => {
    // Nothing in the MediaRecorder spec makes `onstop` asynchronous, and with
    // no data left to flush Firefox and Safari fire it inside `stop()`. The
    // recorder used to assign `stopPromise` with the *result* of
    // `new Promise(...)`, so on those engines the handler nulled the field and
    // the assignment immediately put a settled promise back. Every later stop
    // then returned that stale promise and never reached `rec.stop()` — the
    // encoder ran on behind a stopped transport, which is the reported bug
    // arriving from the browser rather than from the call site.
    const r = new TakeRecorder();
    r.start({} as MediaStream);
    made[0].emit(8);
    expect(await r.stop()).not.toBeNull();

    // The second take is the one that used to be stranded.
    expect(r.start({} as MediaStream)).toBe(true);
    made[1].emit(8);
    void r.stop();
    expect(made[1].state).toBe('inactive');

    // And a third, so this is a property rather than an off-by-one.
    expect(r.start({} as MediaStream)).toBe(true);
    void r.stop();
    expect(made[2].state).toBe('inactive');
  });

  it('shares one in-flight stop between two presses in the same frame', async () => {
    const r = new TakeRecorder();
    r.start({} as MediaStream);
    made[0].asyncStop = true; // the encoder has not finished flushing yet
    made[0].emit(10);
    const a = r.stop();
    const b = r.stop();
    // Two Stop presses in the same frame must produce one take, not two.
    expect(await a).toBe(await b);
    expect((await a)?.blob.size).toBe(10);
    expect(made).toHaveLength(1);
  });

  it('has nothing left to give a second press once the take is already finished', async () => {
    const r = new TakeRecorder();
    r.start({} as MediaStream);
    made[0].emit(10);
    expect((await r.stop())?.blob.size).toBe(10);
    // The take is committed; a later press must report nothing rather than a
    // second copy of it, and must not open another encoder to find out.
    expect(await r.stop()).toBeNull();
    expect(made).toHaveLength(1);
  });
});

describe('transport fuzz — start, stop, record, abandon at high rate', () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('never leaves the recorder in a state it cannot get out of', async () => {
    const rng = mulberry32(0x5eed);
    const ops = ['stop', 'panic', 'abandon', 'toggle', 'seek', 'rts', 'project'] as const;
    const phases = ['idle', 'arming', 'countIn', 'recording', 'finalizing', 'error'] as const;

    for (let i = 0; i < 2000; i += 1) {
      // Drop the machine into an arbitrary state, then hit it. Every reachable
      // phase must survive every transport command; the failure this is looking
      // for is a phase that no command can leave.
      const start = phases[Math.floor(rng() * phases.length)];
      useInputStore.getState().set({ phase: start, recordingActive: start === 'recording' });
      const op = ops[Math.floor(rng() * ops.length)];
      switch (op) {
        case 'stop':
          engine.stop();
          break;
        case 'panic':
          engine.panic();
          break;
        case 'abandon':
          recording.cancel();
          break;
        case 'toggle':
          engine.togglePlay();
          break;
        case 'seek':
          engine.seek(rng() * 64);
          break;
        case 'rts':
          engine.returnToStart();
          break;
        case 'project':
          engine.stop('project');
          break;
      }
      expect(phases).toContain(phase());
    }

    // Everything that was started has to be able to finish.
    engine.stop();
    await settle(40);
    expect(['idle', 'error']).toContain(phase());
    expect(useInputStore.getState().recordingActive).toBe(false);
    expect(recording.isRecording).toBe(false);
    expect(recording.isBusy).toBe(false);
  });
});

/**
 * The whole path, driven the way the app drives it: arm a track, press record,
 * let the encoder run, press Stop.
 *
 * The stubs are the four things jsdom has no version of — an AudioContext, a
 * microphone, an AudioWorklet and an encoder. Nothing about the transport or
 * the controller is stubbed, which is the point: this is the case that would
 * have caught the reported bug on its own.
 */
describe('record, then press Stop', () => {
  class FakeMediaRecorder {
    static isTypeSupported(): boolean {
      return true;
    }
    state: 'inactive' | 'recording' = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    /** Chunks the encoder was asked to produce after it had been stopped. */
    lateChunks = 0;
    start(): void {
      this.state = 'recording';
    }
    emit(bytes: number): void {
      if (this.state !== 'recording') {
        this.lateChunks += 1;
        return;
      }
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
    }
    stop(): void {
      this.state = 'inactive';
      this.onstop?.();
    }
  }

  let encoder: FakeMediaRecorder | null = null;
  const realMR = globalThis.MediaRecorder;
  let trackId = '';

  beforeEach(async () => {
    const { useProjectStore } = await import('../src/state/projectStore');
    const { createEmptyProject } = await import('../src/model/demoProject');
    const { audioInput } = await import('../src/audio/inputManager');
    const { livePeakTap } = await import('../src/audio/peakTap');

    encoder = null;
    // A Proxy rather than a subclass with a constructor: the class form aliases
    // `this` before the base constructor has finished, which the lint rule
    // rejects, and this keeps the fake a plain class.
    globalThis.MediaRecorder = new Proxy(FakeMediaRecorder, {
      construct(target) {
        encoder = new target();
        return encoder as unknown as object;
      },
    }) as unknown as typeof MediaRecorder;

    useProjectStore.getState().setProject(createEmptyProject('Stop'), { markClean: true });
    trackId = useProjectStore.getState().addTrack('audio');
    useProjectStore.getState().update((d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (t) t.armed = true;
      // Count-in has its own cases; this one is about the stop.
      d.countIn = 0;
      // An instrument track is armed by default and would take the take.
      for (const other of d.tracks) if (other.id !== trackId) other.armed = false;
    });

    vi.spyOn(engine, 'start').mockResolvedValue(true);
    vi.spyOn(engine, 'play').mockResolvedValue(undefined);
    vi.spyOn(engine, 'context', 'get').mockReturnValue({
      decodeAudioData: () => Promise.reject(new Error('no decoder in jsdom')),
    } as unknown as AudioContext);
    vi.spyOn(audioInput, 'acquire').mockResolvedValue({} as MediaStreamAudioSourceNode);
    vi.spyOn(audioInput, 'streamFor').mockReturnValue({} as MediaStream);
    vi.spyOn(audioInput, 'release').mockImplementation(() => {});
    vi.spyOn(livePeakTap, 'attach').mockResolvedValue(true);
    vi.spyOn(livePeakTap, 'detach').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.MediaRecorder = realMR;
  });

  it('stops the encoder, clears the take timer and finalises, all from `engine.stop()`', async () => {
    expect(await recording.start()).toBe(true);
    expect(phase()).toBe('recording');
    encoder!.emit(512);
    encoder!.emit(512);
    expect(encoder!.state).toBe('recording');

    // The Stop button. Not `recording.stop()` — that route always worked.
    engine.stop();

    // Within the same synchronous turn.
    expect(encoder!.state).toBe('inactive');
    expect(phase()).toBe('finalizing');

    // Anything the encoder would have produced after this instant is refused
    // rather than appended, which is the acceptance: no audio after the stop.
    encoder!.emit(512);
    expect(encoder!.lateChunks).toBe(1);

    await untilIdle();
    expect(phase()).toBe('idle');
    expect(useInputStore.getState().recordingActive).toBe(false);
  });

  it('leaves no interval behind to keep the take timer climbing', async () => {
    expect(await recording.start()).toBe(true);
    encoder!.emit(64);
    engine.stop();
    await untilIdle();
    const at = useInputStore.getState().recordSeconds;
    // The tick timer is a 200 ms setInterval owned by the controller. When the
    // ending lived only on the record button, a transport stop never cleared
    // it, so the counter climbed behind a stopped playhead — which is what
    // "it is still recording" looked like on screen.
    await new Promise((r) => setTimeout(r, 450));
    expect(useInputStore.getState().recordSeconds).toBe(at);
  });

  it('releases the input, and only after the encoder has flushed', async () => {
    const { audioInput } = await import('../src/audio/inputManager');
    expect(await recording.start()).toBe(true);
    encoder!.emit(64);
    engine.stop();
    // Stopping a MediaStreamTrack while the encoder is still flushing truncates
    // the tail of the take, so the release is one await behind the stop rather
    // than beside it.
    expect(audioInput.release).not.toHaveBeenCalled();
    await untilIdle();
    expect(audioInput.release).toHaveBeenCalledWith(expect.any(String), `record:${trackId}`, 1);
  });

  it('does not start a take that a stop overtook during arming', async () => {
    const { audioInput } = await import('../src/audio/inputManager');
    let releaseInput = (_v: MediaStreamAudioSourceNode | null) => {};
    vi.spyOn(audioInput, 'acquire').mockReturnValue(
      new Promise((r) => {
        releaseInput = r;
      }),
    );
    const started = recording.start();
    await settle(2);
    expect(phase()).toBe('arming');

    engine.stop(); // Stop pressed while the permission prompt is up.
    releaseInput({} as MediaStreamAudioSourceNode);

    expect(await started).toBe(false);
    await untilIdle();
    // The old guard read `phase !== 'recording'`, so this stop was swallowed and
    // the take began a moment later — the record button appearing to ignore the
    // user.
    expect(encoder).toBeNull();
    expect(phase()).toBe('idle');
    expect(recording.isBusy).toBe(false);
  });
});

/**
 * A static guard, in the manner of `tests/schemaWired.test.ts`.
 *
 * The behavioural cases above prove that today's stop paths announce. This one
 * exists so a seventh path cannot be added without announcing — which is how
 * the first six came to exist.
 */
describe('the transport has one owner', () => {
  const ROOT = join(__dirname, '..');
  const engineSrc = readFileSync(join(ROOT, 'src/audio/engine.ts'), 'utf8').split(/\r?\n/);

  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sourceFiles(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('announces on every path that clears the playing flag', () => {
    const clears = engineSrc
      .map((line, i) => ({ line, n: i + 1 }))
      .filter((l) => /this\.playing\s*=\s*false/.test(l.line));
    // If this ever reads zero the guard has stopped guarding — the field was
    // renamed and the check now passes over a file it no longer matches.
    expect(clears.length).toBeGreaterThan(0);
    for (const { n } of clears) {
      const preceding = engineSrc.slice(Math.max(0, n - 26), n).join('\n');
      expect(
        preceding,
        `engine.ts:${n} parks the transport without announcing it — a take stopped there would keep capturing`,
      ).toMatch(/announceTransportStop\(/);
    }
  });

  it('keeps the clock behind the engine, where the announcement is', () => {
    // `scheduler.stop()` is the clock. Reached from anywhere else it would be a
    // stop with no announcement, which is this bug with a different spelling.
    const callers = sourceFiles(join(ROOT, 'src'))
      .filter((f) => /\bscheduler\.stop\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f).split('\\').join('/'));
    expect(callers).toEqual(['src/audio/engine.ts']);
  });
});
