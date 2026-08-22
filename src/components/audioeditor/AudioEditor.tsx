/**
 * Audio editor.
 *
 * The dedicated surface for one audio clip: its waveform at edit resolution,
 * the non-destructive edits that already existed (trim, fades, gain, polarity,
 * normalise), the warp lane that pins the recording to the song's beats, and
 * the three analysis tools that turn a recording into something else — Audio to
 * Notes, Vocal Tune and stem separation.
 *
 * All three analyses are offline: they read the decoded buffer, run pure DSP, and
 * produce new material (a MIDI clip, a corrected render, four new audio
 * clips). None of them alters the source, so every one of them is undoable and
 * the original take is always still there.
 */
import { useEffect, useMemo, useState } from 'react';
import { engine } from '../../audio/engine';
import { getBufferSync, loadBuffer } from '../../audio/mediaLibrary';
import { putMediaBlob } from '../../persistence/mediaStore';
import { audioBufferToWav } from '../../audio/exportMix';
import { audioToNotes, detectedNotesToNotes, type DetectedNote } from '../../model/audioToMidi';
import { TUNE_SCALE_IDS, tuneSettingsOf } from '../../model/effects';
import {
  analyzeVocal,
  correctedTrack,
  noteErrorsCents,
  type TuneOptions,
} from '../../model/vocalTune';
import { separateStems, STEM_NAMES, type StemName } from '../../model/stemSeparation';
import { pitchShiftChannel } from '../../audio/timestretch';
import { tempoMapOf } from '../../model/music';
import { beatToSec } from '../../model/tempo';
import { newId } from '../../model/ids';
import { PEAKS_VERSION } from '../../model/media';
import { KEY_NAMES, SCALES } from '../../model/scales';
import { midiToName } from '../../model/music';
import type { AudioClip } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { Waveform } from '../arrangement/Waveform';
import { WarpLane, WarpPanel } from './WarpTool';
import { normalizeWarpMap, type WarpMap } from '../../model/warp';
import { projectBpmAt } from '../../model/music';

type Tool = 'notes' | 'tune' | 'stems' | 'warp';

/** The clip the editor is working on, or null. */
function useAudioClip(): AudioClip | null {
  const clipId = useUiStore((s) => s.selectedClipId);
  return useProjectStore(
    (s) =>
      (s.project.clips.find((c) => c.id === clipId && c.type === 'audio') as AudioClip) ?? null,
  );
}

/** Decoded audio for a clip, loaded on demand. */
function useClipBuffer(clip: AudioClip | null): AudioBuffer | null {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  useEffect(() => {
    if (!clip) {
      setBuffer(null);
      return;
    }
    const have = getBufferSync(clip.mediaId);
    if (have) {
      setBuffer(have);
      return;
    }
    let cancelled = false;
    const ctx = engine.context;
    if (!ctx) return;
    void loadBuffer(clip.mediaId, ctx).then((b) => {
      if (!cancelled) setBuffer(b);
    });
    return () => {
      cancelled = true;
    };
  }, [clip]);
  return buffer;
}

export function AudioEditor() {
  const clip = useAudioClip();
  const project = useProjectStore((s) => s.project);
  const buffer = useClipBuffer(clip);
  const [tool, setTool] = useState<Tool>('notes');
  const [busy, setBusy] = useState<string | null>(null);

  // Audio → Notes
  const [mode, setMode] = useState<'mono' | 'poly'>('mono');
  const [sensitivity, setSensitivity] = useState(0.5);
  const [quantizeGrid, setQuantizeGrid] = useState(0);
  const [detected, setDetected] = useState<DetectedNote[] | null>(null);

  // Vocal tune. The settings live on the track's Vocal Tune device when it has
  // one, so what the console shows is what a take is actually retuned with —
  // the device used to carry four parameters nothing read.
  const [localTune, setLocalTune] = useState<TuneOptions>({
    scaleId: 'major',
    tonic: 0,
    strength: 0.8,
    retuneMs: 25,
    humanise: 0.6,
  });
  const [errors, setErrors] = useState<number[] | null>(null);

  // Bend / warp
  const [warpGrid, setWarpGrid] = useState(1);
  const [warpStrength, setWarpStrength] = useState(1);

  const tuneTrack = clip ? project.tracks.find((t) => t.id === clip.trackId) : undefined;
  const tuneDevice = tuneTrack?.effects?.find((e) => e.kind === 'vocaltune') ?? null;
  const deviceTune = tuneDevice ? tuneSettingsOf(tuneDevice) : null;
  const tune: TuneOptions = deviceTune ?? localTune;
  // Formant preservation is the device's, and on by default: shifting pitch by
  // resampling moves the body of the voice with it, which is the sound people
  // mean by "chipmunk". A track with no device gets the same default.
  const formantPreserve = deviceTune?.formantPreserve ?? true;

  /**
   * One gesture per change, whichever side holds the settings: moving a slider
   * on a track that has the device must be one step of undo, not six.
   */
  const setTune = (next: TuneOptions): void => {
    if (!tuneDevice || !tuneTrack) {
      setLocalTune(next);
      return;
    }
    const store = useProjectStore.getState();
    const write = (key: string, value: number) =>
      store.setEffectParam(tuneTrack.id, tuneDevice.id, key, value);
    store.beginGesture();
    write('strength', next.strength ?? 0.8);
    write('speed', next.retuneMs ?? 25);
    write('humanise', next.humanise ?? 0.6);
    write('key', (((next.tonic ?? 0) % 12) + 12) % 12);
    const scaleIndex = TUNE_SCALE_IDS.indexOf(next.scaleId ?? 'chromatic');
    write('scale', scaleIndex >= 0 ? scaleIndex : TUNE_SCALE_IDS.indexOf('chromatic'));
    store.endGesture();
  };

  const sourceSeconds = useMemo(() => {
    if (!clip) return 0;
    return clip.sourceDuration ?? (buffer ? buffer.duration : 0);
  }, [clip, buffer]);

  // The map is normalised on the way in, so the lane can never be handed a
  // marker order the playback path would refuse.
  const warpMap = useMemo(
    () =>
      normalizeWarpMap(
        clip?.warp,
        clip ? (clip.sourceBpm ?? projectBpmAt(project, clip.start)) : undefined,
      ),
    [clip, project],
  );

  if (!clip) {
    return (
      <div className="audio-editor empty" data-testid="audio-editor">
        <div className="empty-state">
          <Icon name="wave" size={30} className="es-icon" />
          <div className="es-title">No audio clip selected</div>
          <p className="es-body">
            Select an audio clip in the arrangement to trim it, tune it, convert it to notes or
            split it into stems.
          </p>
        </div>
      </div>
    );
  }

  /** The clip's own window of the source, which is what every tool works on. */
  const clipWindow = (): { data: Float32Array; channels: Float32Array[]; rate: number } | null => {
    if (!buffer) return null;
    const rate = buffer.sampleRate;
    const from = Math.max(0, Math.floor(clip.offset * rate));
    const to = Math.min(buffer.length, Math.ceil((clip.offset + sourceSeconds) * rate));
    if (to <= from) return null;
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channels.push(buffer.getChannelData(c).slice(from, to));
    }
    // Mono sum for the analysers that want one signal.
    const mono = new Float32Array(to - from);
    for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i];
    if (channels.length > 1) for (let i = 0; i < mono.length; i++) mono[i] /= channels.length;
    return { data: mono, channels, rate };
  };

  /** A map with nothing pinned is stored as no map at all, not as an empty one. */
  const setWarpMap = (map: WarpMap) => {
    useProjectStore.getState().setClip(clip.id, { warp: map.markers.length > 0 ? map : undefined });
  };

  const runToNotes = () => {
    const win = clipWindow();
    if (!win) {
      useUiStore.getState().toast('error', 'That clip’s audio is not decoded yet.');
      return;
    }
    setBusy('Listening…');
    // A task boundary so the button paints its busy state before the analysis
    // blocks the thread.
    window.setTimeout(() => {
      try {
        const map = tempoMapOf(project);
        const notes = audioToNotes(win.data, win.rate, {
          mode,
          sensitivity,
          ...(quantizeGrid > 0
            ? { quantizeGrid, tempoMap: map, clipStartSec: beatToSec(map, clip.start) }
            : {}),
        });
        setDetected(notes);
        if (notes.length === 0) {
          useUiStore.getState().toast('error', 'Nothing pitched enough to convert.');
        }
      } finally {
        setBusy(null);
      }
    }, 16);
  };

  const placeNotes = () => {
    if (!detected?.length) return;
    const map = tempoMapOf(project);
    const notes = detectedNotesToNotes(detected, {
      tempoMap: map,
      clipStartSec: beatToSec(map, clip.start),
      idPrefix: newId('a2n'),
    });
    const trackId = useProjectStore.getState().addTrack('instrument');
    useProjectStore.getState().setTrack(trackId, { name: `${clip.name} (notes)` });
    const clipId = useProjectStore.getState().addMidiClip(trackId, clip.start, clip.length);
    useProjectStore.getState().transformNotes(clipId, notes);
    useUiStore.getState().selectClip(clipId, trackId);
    useUiStore.getState().openEditorFor(clipId);
    useUiStore.getState().toast('info', `${notes.length} notes on a new instrument track.`);
  };

  const analyseTuning = () => {
    const win = clipWindow();
    if (!win) return;
    setBusy('Analysing pitch…');
    window.setTimeout(() => {
      try {
        const analysis = analyzeVocal(win.data, win.rate);
        setErrors(noteErrorsCents(analysis, tune));
        if (analysis.notes.length === 0) {
          useUiStore.getState().toast('error', 'No sustained pitch to tune.');
        }
      } finally {
        setBusy(null);
      }
    }, 16);
  };

  /**
   * Render the corrected take as a new clip on the same track.
   *
   * Correction is applied as a piecewise pitch shift over short blocks: the
   * tuning curve is a per-frame semitone offset, and a block that shares one
   * offset can be shifted with the existing stretcher, with the stretcher's
   * own formant preservation when the device asks for it. This is the honest
   * quality a local, dependency-free implementation reaches: block-wise, not
   * a continuous phase-locked retune.
   */
  const renderTuned = async () => {
    const win = clipWindow();
    const ctx = engine.context;
    if (!win || !ctx) {
      useUiStore.getState().toast('error', 'Start audio before rendering.');
      return;
    }
    setBusy('Rendering the corrected take…');
    try {
      const analysis = analyzeVocal(win.data, win.rate);
      const corrected = correctedTrack(analysis, tune);
      if (corrected.length === 0) throw new Error('Nothing to correct.');
      // The shift is a per-frame semitone offset; the analysis reports it in
      // cents, which is the same number a hundred times bigger.
      const curve = corrected.map((f) => ({
        timeSec: f.timeSec,
        shiftSemitones: f.shiftCents / 100,
      }));
      const out = win.channels.map((ch) => renderCorrected(ch, win.rate, curve, formantPreserve));
      const rendered = ctx.createBuffer(out.length, out[0].length, win.rate);
      out.forEach((ch, i) => rendered.copyToChannel(ch, i));
      const blob = new Blob([audioBufferToWav(rendered)], { type: 'audio/wav' });
      const mediaId = newId('tuned');
      await putMediaBlob(mediaId, blob, 'audio/wav');
      useProjectStore.getState().registerMedia({
        id: mediaId,
        name: `${clip.name} (tuned)`,
        kind: 'import',
        mimeType: 'audio/wav',
        byteSize: blob.size,
        duration: rendered.duration,
        sampleRate: rendered.sampleRate,
        channels: rendered.numberOfChannels,
        createdAt: Date.now(),
        source: 'vocal tune',
        peaksVersion: PEAKS_VERSION,
      });
      const newClipId = useProjectStore
        .getState()
        .addAudioClip(
          clip.trackId,
          mediaId,
          clip.start,
          clip.length,
          `${clip.name} (tuned)`,
          rendered.duration,
        );
      useProjectStore.getState().setClip(clip.id, { muted: true });
      useUiStore.getState().selectClip(newClipId, clip.trackId);
      useUiStore.getState().toast('info', 'Tuned take added; the original is muted, not replaced.');
    } catch (e) {
      useUiStore.getState().toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const runStems = async () => {
    const win = clipWindow();
    const ctx = engine.context;
    if (!win || !ctx) {
      useUiStore.getState().toast('error', 'Start audio before separating.');
      return;
    }
    setBusy('Separating…');
    try {
      const stems = separateStems(win.channels, win.rate);
      for (const name of STEM_NAMES) {
        const data = stems[name as StemName];
        const buf = ctx.createBuffer(data.length, data[0].length, win.rate);
        data.forEach((ch, i) => buf.copyToChannel(ch, i));
        const blob = new Blob([audioBufferToWav(buf)], { type: 'audio/wav' });
        const mediaId = newId(`stem-${name}`);
        await putMediaBlob(mediaId, blob, 'audio/wav');
        useProjectStore.getState().registerMedia({
          id: mediaId,
          name: `${clip.name} — ${name}`,
          kind: 'import',
          mimeType: 'audio/wav',
          byteSize: blob.size,
          duration: buf.duration,
          sampleRate: buf.sampleRate,
          channels: buf.numberOfChannels,
          createdAt: Date.now(),
          source: 'stem separation',
          peaksVersion: PEAKS_VERSION,
        });
        const trackId = useProjectStore.getState().addTrack('audio');
        useProjectStore.getState().setTrack(trackId, { name: `${clip.name} ${name}` });
        useProjectStore
          .getState()
          .addAudioClip(trackId, mediaId, clip.start, clip.length, name, buf.duration);
      }
      useProjectStore.getState().setClip(clip.id, { muted: true });
      useUiStore.getState().toast('info', 'Four stems added; the original is muted, not replaced.');
    } catch (e) {
      useUiStore.getState().toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="audio-editor" data-testid="audio-editor">
      <div className="ae-head">
        <span className="ae-name">{clip.name}</span>
        <span className="hint">
          {sourceSeconds.toFixed(2)}s · {buffer ? `${buffer.numberOfChannels}ch` : 'decoding…'}
        </span>
        <span className="grow" />
        <div className="seg" role="group" aria-label="Audio tool">
          {(
            [
              ['warp', 'Bend / Warp'],
              ['notes', 'Audio → Notes'],
              ['tune', 'Vocal Tune'],
              ['stems', 'Stems'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={tool === id ? 'on' : ''}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
              data-testid={`ae-tool-${id}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="ae-wave">
        <Waveform
          mediaId={clip.mediaId}
          offsetSec={clip.offset}
          durationSec={sourceSeconds}
          color={project.tracks.find((t) => t.id === clip.trackId)?.color ?? 'var(--accent)'}
          gain={clip.gain}
          fadeIn={clip.fadeIn}
          fadeOut={clip.fadeOut}
          fadeInShape={clip.fadeInShape}
          fadeOutShape={clip.fadeOutShape}
        />
        {tool === 'warp' && sourceSeconds > 0 && (
          <WarpLane
            map={warpMap}
            offsetSec={clip.offset}
            durationSec={sourceSeconds}
            maxSourceSec={buffer?.duration ?? clip.offset + sourceSeconds}
            transients={clip.transients}
            gridBeats={warpGrid}
            onChange={setWarpMap}
          />
        )}
        {detected && tool === 'notes' && sourceSeconds > 0 && (
          <div className="ae-detected" aria-hidden>
            {detected.map((n, i) => (
              <span
                key={`${n.startSec}-${n.pitch}-${i}`}
                style={{
                  left: `${(n.startSec / sourceSeconds) * 100}%`,
                  width: `${Math.max(0.4, (n.durSec / sourceSeconds) * 100)}%`,
                  bottom: `${((n.pitch - 24) / 84) * 100}%`,
                  opacity: 0.35 + n.confidence * 0.65,
                }}
                title={`${midiToName(n.pitch)} · ${Math.round(n.confidence * 100)}%`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="ae-body">
        {tool === 'warp' && (
          <WarpPanel
            clip={clip}
            map={warpMap}
            buffer={buffer}
            gridBeats={warpGrid}
            strength={warpStrength}
            onGrid={setWarpGrid}
            onStrength={setWarpStrength}
            onChange={setWarpMap}
          />
        )}
        {tool === 'notes' && (
          <>
            <div className="ae-row">
              <span className="k">Material</span>
              <div className="seg" role="group" aria-label="Detection mode">
                <button
                  className={mode === 'mono' ? 'on' : ''}
                  aria-pressed={mode === 'mono'}
                  onClick={() => setMode('mono')}
                  title="One voice at a time: a vocal, a bass, a lead line"
                >
                  Single voice
                </button>
                <button
                  className={mode === 'poly' ? 'on' : ''}
                  aria-pressed={mode === 'poly'}
                  onClick={() => setMode('poly')}
                  title="Chords and simple polyphony — not a dense mix"
                >
                  Chords
                </button>
              </div>
            </div>
            <div className="ae-row">
              <span className="k">Sensitivity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={sensitivity}
                aria-label="Detection sensitivity"
                onChange={(e) => setSensitivity(Number(e.target.value))}
              />
              <span className="v t-num">{Math.round(sensitivity * 100)}%</span>
            </div>
            <div className="ae-row">
              <span className="k">Quantize</span>
              <select
                value={quantizeGrid}
                onChange={(e) => setQuantizeGrid(Number(e.target.value))}
                aria-label="Quantize the detected notes"
              >
                <option value={0}>Keep the timing</option>
                <option value={1}>1/4</option>
                <option value={0.5}>1/8</option>
                <option value={0.25}>1/16</option>
              </select>
            </div>
            <div className="ae-actions">
              <button className="btn" onClick={runToNotes} disabled={busy !== null}>
                <Icon name="wand" size={13} /> {busy ?? 'Convert'}
              </button>
              {detected && (
                <>
                  <span className="hint">
                    {detected.length} note{detected.length === 1 ? '' : 's'} found
                  </span>
                  <button
                    className="btn primary"
                    onClick={placeNotes}
                    disabled={detected.length === 0}
                    data-testid="place-notes"
                  >
                    Put on a new instrument track
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {tool === 'tune' && (
          <>
            <div className="ae-row">
              <span className="k">Scale</span>
              <select
                value={tune.tonic ?? 0}
                onChange={(e) => setTune({ ...tune, tonic: Number(e.target.value) })}
                aria-label="Key"
              >
                {KEY_NAMES.map((n, i) => (
                  <option key={n} value={i}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                value={tune.scaleId ?? 'major'}
                onChange={(e) => setTune({ ...tune, scaleId: e.target.value })}
                aria-label="Scale"
              >
                {SCALES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="ae-row">
              <span className="k">Strength</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={tune.strength ?? 0.8}
                aria-label="Correction strength"
                onChange={(e) => setTune({ ...tune, strength: Number(e.target.value) })}
              />
              <span className="v t-num">{Math.round((tune.strength ?? 0.8) * 100)}%</span>
            </div>
            <div className="ae-row">
              <span className="k">Retune speed</span>
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={tune.retuneMs ?? 25}
                aria-label="Retune speed"
                title="0 is the hard, obviously-processed snap; tens of milliseconds keeps the scoop a singer actually sang"
                onChange={(e) => setTune({ ...tune, retuneMs: Number(e.target.value) })}
              />
              <span className="v t-num">{tune.retuneMs ?? 25} ms</span>
            </div>
            <div className="ae-row">
              <span className="k">Keep vibrato</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={tune.humanise ?? 0.6}
                aria-label="Keep vibrato"
                onChange={(e) => setTune({ ...tune, humanise: Number(e.target.value) })}
              />
              <span className="v t-num">{Math.round((tune.humanise ?? 0.6) * 100)}%</span>
            </div>
            <div className="ae-row ae-note">
              <span className="hint">
                {tuneDevice
                  ? `Settings come from the Vocal Tune device on ${tuneTrack?.name ?? 'this track'}, and are saved with the song.`
                  : 'These settings are this session only. Add a Vocal Tune device to the track to keep them with the song.'}
                {formantPreserve ? ' Formants are preserved.' : ' Formants shift with the pitch.'}
              </span>
            </div>
            <div className="ae-actions">
              <button className="btn" onClick={analyseTuning} disabled={busy !== null}>
                <Icon name="tuner" size={13} /> {busy ?? 'Analyse pitch'}
              </button>
              <button
                className="btn primary"
                onClick={() => void renderTuned()}
                disabled={busy !== null}
                data-testid="render-tuned"
              >
                Render corrected take
              </button>
            </div>
            {errors && errors.length > 0 && (
              <div className="ae-errors">
                <span className="t-label">How far off each note was</span>
                <div className="ae-error-bars">
                  {errors.slice(0, 64).map((cents, i) => (
                    <span
                      key={i}
                      className={`ae-err${Math.abs(cents) > 30 ? ' bad' : ''}`}
                      style={{ height: `${Math.min(100, Math.abs(cents))}%` }}
                      title={`${cents > 0 ? '+' : ''}${cents.toFixed(0)} cents`}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {tool === 'stems' && (
          <>
            <p className="t-body">
              Splits the clip into vocals, drums, bass and other using harmonic/percussive
              separation, a bass crossover and centre-channel extraction. It is classical DSP
              running locally, not a trained model: it separates a well-recorded mix usefully and a
              dense one only partly, and the four stems always sum back to the original.
            </p>
            <div className="ae-actions">
              <button
                className="btn primary"
                onClick={() => void runStems()}
                disabled={busy !== null}
                data-testid="run-stems"
              >
                <Icon name="stem" size={13} /> {busy ?? 'Separate into four stems'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Apply a per-frame semitone curve to a channel.
 *
 * Frames sharing a shift within a twentieth of a semitone are batched, so a
 * held note is one pitch-shift call rather than a hundred, and the boundaries
 * are cross-faded over 5 ms so a shift change does not click.
 */
function renderCorrected(
  channel: Float32Array,
  sampleRate: number,
  frames: { timeSec: number; shiftSemitones: number }[],
  formantPreserve: boolean,
): Float32Array {
  const out = new Float32Array(channel.length);
  const fade = Math.max(1, Math.round(sampleRate * 0.005));
  let i = 0;
  while (i < frames.length) {
    let j = i + 1;
    while (
      j < frames.length &&
      Math.abs(frames[j].shiftSemitones - frames[i].shiftSemitones) < 0.05
    ) {
      j++;
    }
    const from = Math.max(0, Math.floor(frames[i].timeSec * sampleRate));
    const to =
      j < frames.length
        ? Math.min(channel.length, Math.floor(frames[j].timeSec * sampleRate))
        : channel.length;
    if (to > from) {
      const block = channel.subarray(from, to);
      const shifted =
        Math.abs(frames[i].shiftSemitones) < 0.02
          ? block
          : pitchShiftChannel(block, sampleRate, frames[i].shiftSemitones, formantPreserve);
      for (let k = 0; k < to - from; k++) {
        const v = k < shifted.length ? shifted[k] : 0;
        // Cross-fade the joins so a change of shift cannot click.
        const head = Math.min(1, k / fade);
        const tail = Math.min(1, (to - from - k) / fade);
        out[from + k] += v * head * tail;
      }
    }
    i = j;
  }
  return out;
}
