/**
 * Time and pitch for one audio clip.
 *
 * Four related decisions in one place: how fast the material plays, whether it
 * follows the song's tempo, whether the pitch comes with the rate, and where
 * its transients are — because half of what warp is for is knowing where the
 * beats already are.
 */
import { useState } from 'react';
import { engine } from '../../audio/engine';
import { getBufferSync, loadBuffer } from '../../audio/mediaLibrary';
import { analyseTransients } from '../../model/transients';
import { projectBpmAt } from '../../model/music';
import type { AudioClip } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

export function TimePitchPanel({ clip }: { clip: AudioClip }) {
  const project = useProjectStore((s) => s.project);
  const store = useProjectStore;
  const [busy, setBusy] = useState(false);

  const stretch = clip.stretch ?? 1;
  const transpose = clip.transpose ?? 0;
  const songBpm = projectBpmAt(project, clip.start);
  const transientCount = clip.transients?.length ?? 0;

  /**
   * Read the clip's own tempo and its transients off the audio. Both come from
   * one analysis pass, because the tempo estimate is derived from the onsets.
   */
  const analyse = async () => {
    setBusy(true);
    try {
      let buf = getBufferSync(clip.mediaId);
      if (!buf) {
        const ctx = engine.context;
        if (!ctx) throw new Error('Start audio first.');
        buf = await loadBuffer(clip.mediaId, ctx);
      }
      if (!buf) throw new Error('That clip’s audio is not available.');
      const mono = buf.getChannelData(0);
      const result = analyseTransients(mono, buf.sampleRate);
      store.getState().setClip(clip.id, {
        transients: result.transients.map((t) => Math.round(t.timeSec * 1000) / 1000),
        ...(result.tempo && result.tempo.confidence > 0.3
          ? { sourceBpm: Math.round(result.tempo.bpm * 10) / 10 }
          : {}),
      });
      useUiStore
        .getState()
        .toast(
          'info',
          `${result.transients.length} transients${
            result.tempo && result.tempo.confidence > 0.3
              ? ` · ${result.tempo.bpm.toFixed(1)} BPM (${Math.round(result.tempo.confidence * 100)}% sure)`
              : ' · tempo unclear'
          }`,
        );
    } catch (e) {
      useUiStore.getState().toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-section" data-testid="time-pitch">
      <div className="ps-title">Time &amp; pitch</div>

      <div className="insp-row">
        <span className="k">Follow tempo</span>
        <button
          className={`th-mini${clip.followTempo ? ' on' : ''}`}
          aria-pressed={clip.followTempo === true}
          title={
            clip.sourceBpm
              ? `Stretch from ${clip.sourceBpm} BPM to the song's ${songBpm.toFixed(1)}`
              : 'Detect the clip’s own tempo first'
          }
          disabled={!clip.sourceBpm}
          onClick={() => store.getState().setClip(clip.id, { followTempo: !clip.followTempo })}
          data-testid="follow-tempo"
        >
          {clip.followTempo ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="insp-row">
        <span className="k">Clip tempo</span>
        <input
          type="number"
          min={20}
          max={999}
          step={0.1}
          value={clip.sourceBpm ?? ''}
          placeholder="detect"
          aria-label="Clip source tempo"
          onChange={(e) => {
            const v = Number(e.target.value);
            store.getState().setClip(clip.id, {
              sourceBpm: Number.isFinite(v) && v > 0 ? v : undefined,
            });
          }}
        />
      </div>

      <div className="insp-row">
        <span className="k">Speed</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.01}
          value={stretch}
          aria-label="Playback speed"
          onChange={(e) => store.getState().setClip(clip.id, { stretch: Number(e.target.value) })}
        />
        <span className="v t-num">{stretch.toFixed(2)}×</span>
      </div>

      <div className="insp-row">
        <span className="k">Transpose</span>
        <input
          type="range"
          min={-24}
          max={24}
          step={1}
          value={transpose}
          aria-label="Transpose in semitones"
          onChange={(e) => store.getState().setClip(clip.id, { transpose: Number(e.target.value) })}
        />
        <span className="v t-num">
          {transpose > 0 ? '+' : ''}
          {transpose} st
        </span>
      </div>

      <div className="insp-row">
        <span className="k">Preserve pitch</span>
        <button
          className={`th-mini${clip.preservePitch !== false ? ' on' : ''}`}
          aria-pressed={clip.preservePitch !== false}
          title="Off resamples like tape: faster is higher. On renders through the stretcher and keeps the pitch."
          onClick={() =>
            store.getState().setClip(clip.id, { preservePitch: clip.preservePitch === false })
          }
        >
          {clip.preservePitch !== false ? 'ON' : 'TAPE'}
        </button>
      </div>

      <div className="insp-actions">
        <button
          className="btn"
          onClick={() => void analyse()}
          disabled={busy}
          data-testid="detect-transients"
        >
          <Icon name="wand" size={13} /> {busy ? 'Analysing…' : 'Detect tempo & transients'}
        </button>
        {transientCount > 0 && (
          <span className="hint">
            {transientCount} transient{transientCount === 1 ? '' : 's'}
          </span>
        )}
        {(stretch !== 1 || transpose !== 0 || clip.followTempo) && (
          <button
            className="btn"
            title="Back to the recorded speed and pitch"
            onClick={() =>
              store.getState().setClip(clip.id, {
                stretch: 1,
                transpose: 0,
                followTempo: false,
              })
            }
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
