import { useEffect, useState } from 'react';
import { formatDb } from '../../model/music';
import { setArmed } from '../../app/monitorActions';
import { TRACK_COLORS } from '../../model/types';
import type { AudioClip, Effect, FadeShape, ProjectData, Track } from '../../model/types';
import { freezeRefusal, isFrozen } from '../../model/freeze';
import { freezeTrack, unfreezeTrack } from '../../audio/freeze';
import { isMissing } from '../../audio/mediaLibrary';
import { getClip, getTrack, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { PanKnob } from '../common/widgets';
import { TrackInputControls } from '../recording/RecordControls';
import { InsertRack, SendRack, type ChainHost } from '../mixer/InsertRack';
import { GroovePanel } from './GroovePanel';
import { NoteFxRack } from './NoteFxRack';
import { MacroPanel } from './MacroPanel';
import { TimePitchPanel } from './TimePitchPanel';
import {
  analyzeClip,
  clipBufferReady,
  ensureClipDecoded,
  normalizeClip,
  type ClipAnalysis,
} from '../../app/audioEditActions';

const FADE_SHAPE_OPTIONS: { id: FadeShape; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'equalPower', label: 'Equal power' },
  { id: 'equalGain', label: 'Equal gain' },
  { id: 's', label: 'S-curve' },
];

/** Audio-cleanup block: fades with shapes, analysis, polarity, mono, lock. */
function AudioClipTools({ clip }: { clip: AudioClip }) {
  const store = useProjectStore.getState();
  const [analysis, setAnalysis] = useState<ClipAnalysis | null>(null);

  useEffect(() => {
    setAnalysis(null);
    let cancelled = false;
    void ensureClipDecoded(clip).then((ok) => {
      if (!cancelled && ok) setAnalysis(analyzeClip(clip));
    });
    return () => {
      cancelled = true;
    };
    // Re-analyze when the audible window changes.
  }, [clip.id, clip.offset, clip.sourceDuration, clip.mediaId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="insp-row">
        <span className="k">Fade in</span>
        <input
          type="number"
          min={0}
          step={0.05}
          value={Number(clip.fadeIn.toFixed(2))}
          onChange={(e) =>
            store.setClipFades(clip.id, Math.max(0, Number(e.target.value)), undefined)
          }
          aria-label="Fade in seconds"
          style={{ width: 58 }}
        />
        <select
          value={clip.fadeInShape ?? 'linear'}
          onChange={(e) => store.setFadeShape(clip.id, 'in', e.target.value as FadeShape)}
          aria-label="Fade in shape"
          data-testid="fade-in-shape"
        >
          {FADE_SHAPE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="insp-row">
        <span className="k">Fade out</span>
        <input
          type="number"
          min={0}
          step={0.05}
          value={Number(clip.fadeOut.toFixed(2))}
          onChange={(e) =>
            store.setClipFades(clip.id, undefined, Math.max(0, Number(e.target.value)))
          }
          aria-label="Fade out seconds"
          style={{ width: 58 }}
        />
        <select
          value={clip.fadeOutShape ?? 'linear'}
          onChange={(e) => store.setFadeShape(clip.id, 'out', e.target.value as FadeShape)}
          aria-label="Fade out shape"
          data-testid="fade-out-shape"
        >
          {FADE_SHAPE_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="insp-row" style={{ gap: 6 }}>
        <button className="btn" onClick={() => normalizeClip(clip.id)} data-testid="normalize-clip">
          Normalize
        </button>
        <button
          className={`th-mini${clip.phaseInvert ? ' s-on' : ''}`}
          title="Phase invert (polarity flip)"
          aria-pressed={!!clip.phaseInvert}
          onClick={() => store.setClip(clip.id, { phaseInvert: !clip.phaseInvert })}
        >
          ø
        </button>
        <button
          className={`th-mini${clip.monoSum ? ' s-on' : ''}`}
          title="Mono sum on playback"
          aria-pressed={!!clip.monoSum}
          onClick={() => store.setClip(clip.id, { monoSum: !clip.monoSum })}
        >
          M→1
        </button>
        <button
          className={`th-mini${clip.locked ? ' m-on' : ''}`}
          title={clip.locked ? 'Unlock clip' : 'Lock clip (blocks edits)'}
          aria-pressed={!!clip.locked}
          onClick={() => store.setClip(clip.id, { locked: !clip.locked })}
        >
          🔒
        </button>
      </div>
      <div className="insp-row">
        <span className="k">Analysis</span>
        <span className="v mono" data-testid="audio-analysis">
          {analysis
            ? `peak ${formatDb(analysis.peak)} · DC ${
                Math.abs(analysis.dcOffset) < 0.001 ? 'clean' : analysis.dcOffset.toFixed(4)
              } · ${analysis.channels}ch`
            : clipBufferReady(clip)
              ? '…'
              : 'start audio to analyze'}
        </span>
      </div>
      {clip.takes && clip.takes.length > 0 && (
        <div className="insp-row">
          <span className="k">Takes</span>
          <span className="v">{clip.takes.length}</span>
          <button
            className="btn"
            onClick={() => store.setClipView(clip.id, { takesOpen: !clip.takesOpen })}
          >
            {clip.takesOpen ? 'Hide lanes' : 'Show lanes'}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * A clip's own insert chain, as a chain host.
 *
 * Event FX process one clip and nothing else on its track, which is why they
 * cannot live on the channel — and why they reuse the same rack rather than
 * growing a second copy of it.
 */
function eventChainHost(clip: { id: string; eventFx?: Effect[] }): ChainHost {
  const store = useProjectStore;
  return {
    id: `clip:${clip.id}`,
    name: 'this clip',
    title: 'Event FX',
    emptyHint: 'Inserts that process this clip alone, before it reaches the channel.',
    effects: clip.eventFx ?? [],
    add: (kind) => store.getState().addEventFx(clip.id, kind),
    remove: (id) => store.getState().removeEventFx(clip.id, id),
    setParam: (id, key, v) => store.getState().setEventFxParam(clip.id, id, key, v),
    setBypass: (id, bypass) => store.getState().setEventFxBypass(clip.id, id, bypass),
    move: (id, delta) => store.getState().moveEventFx(clip.id, id, delta),
  };
}

/**
 * Freeze: print the track and play the print.
 *
 * The panel is honest about the two things a musician has to know — that the
 * instrument is not running while the track is frozen, and that editing what
 * the print was made from gives the instrument straight back.
 */
function FreezePanel({ project, track }: { project: ProjectData; track: Track }) {
  const [busy, setBusy] = useState(false);
  const frozen = isFrozen(track);
  const refusal = frozen ? null : freezeRefusal(project, track);
  const printMissing = frozen && isMissing(track.freeze!.mediaId);

  return (
    <div className="panel-section">
      <div className="ps-title">Freeze</div>
      <div className="insp-row" style={{ gap: 6 }}>
        <button
          className={`btn${frozen ? ' primary' : ''}`}
          disabled={busy || (!frozen && refusal !== null)}
          aria-label={`${frozen ? 'Unfreeze' : 'Freeze'} ${track.name}`}
          data-testid={frozen ? 'unfreeze-track' : 'freeze-track'}
          title={
            refusal ??
            (frozen
              ? 'Give the instrument back and play the notes again'
              : 'Render this track to audio and play that instead — no instrument, no notes, no CPU')
          }
          onClick={() => {
            if (frozen) {
              unfreezeTrack(track.id);
              return;
            }
            setBusy(true);
            void freezeTrack(track.id).finally(() => setBusy(false));
          }}
        >
          {busy ? 'Rendering…' : frozen ? 'Unfreeze' : 'Freeze'}
        </button>
        <span className="v" data-testid="freeze-state">
          {frozen ? 'Frozen' : 'Playing live'}
        </span>
      </div>
      <div className="hint">
        {printMissing
          ? 'The rendered audio for this freeze is missing — unfreeze to get the instrument back.'
          : frozen
            ? `Rendered ${new Date(track.freeze!.renderedAt).toLocaleString()}. The instrument is not running: editing the notes, the instrument, its note FX or its inserts releases the freeze and gives it back.`
            : (refusal ??
              'Renders the notes, the instrument, its note FX and its inserts to audio. Fader, pan, mute and sends keep working.')}
      </div>
    </div>
  );
}

/** MIDI channels an instrument track can listen to. 0 is omni. */
const MIDI_CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

export function Inspector() {
  const project = useProjectStore((s) => s.project);
  const selectedClipId = useUiStore((s) => s.selectedClipId);
  const selectedTrackId = useUiStore((s) => s.selectedTrackId);
  const store = useProjectStore.getState();
  const ui = useUiStore.getState();

  const clip = selectedClipId ? getClip(project, selectedClipId) : undefined;
  const track = clip
    ? getTrack(project, clip.trackId)
    : selectedTrackId
      ? getTrack(project, selectedTrackId)
      : undefined;

  if (clip && track) {
    return (
      <div className="panel-body" data-testid="inspector">
        <div className="panel-section">
          <div className="ps-title">Clip</div>
          <div className="insp-row">
            <span className="k">Name</span>
            <input
              type="text"
              value={clip.name}
              onChange={(e) => store.setClip(clip.id, { name: e.target.value })}
              aria-label="Clip name"
            />
          </div>
          <div className="insp-row">
            <span className="k">Track</span>
            <span className="v">{track.name}</span>
          </div>
          <div className="insp-row">
            <span className="k">Start (beats)</span>
            <input
              type="number"
              min={0}
              step={0.25}
              value={clip.start}
              onChange={(e) => store.moveClip(clip.id, Number(e.target.value))}
              aria-label="Clip start"
            />
          </div>
          <div className="insp-row">
            <span className="k">Length (beats)</span>
            <input
              type="number"
              min={0.25}
              step={0.25}
              value={clip.length}
              onChange={(e) => store.resizeClip(clip.id, clip.start, Number(e.target.value))}
              aria-label="Clip length"
            />
          </div>
          <div className="insp-row">
            <span className="k">Mute</span>
            <button
              className={`th-mini${clip.muted ? ' m-on' : ''}`}
              onClick={() => store.setClip(clip.id, { muted: !clip.muted })}
            >
              M
            </button>
          </div>
          {clip.type === 'audio' && (
            <div className="insp-row">
              <span className="k">Gain</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={clip.gain}
                onChange={(e) => store.setClip(clip.id, { gain: Number(e.target.value) })}
                aria-label="Clip gain"
              />
              <span className="v mono">{formatDb(clip.gain)}</span>
            </div>
          )}
          {clip.type === 'audio' && <AudioClipTools clip={clip} />}
        </div>
        {clip.type === 'audio' && <TimePitchPanel clip={clip} />}
        {clip.type === 'midi' && <GroovePanel clip={clip} />}
        {clip.type === 'audio' && (
          <div className="panel-section">
            <InsertRack host={eventChainHost(clip)} />
          </div>
        )}
        <div className="panel-section">
          {clip.type === 'midi' && (
            <>
              <div className="insp-row">
                <span className="k">Notes</span>
                <span className="v">{clip.notes.length}</span>
              </div>
              <div className="insp-row">
                <button className="btn" onClick={() => ui.openEditorFor(clip.id)}>
                  Open in Piano Roll
                </button>
              </div>
            </>
          )}
          <div className="insp-row" style={{ gap: 6 }}>
            <button className="btn" onClick={() => store.duplicateClip(clip.id)}>
              Duplicate
            </button>
            <button
              className="btn danger"
              onClick={() => {
                store.deleteClip(clip.id);
                ui.selectClip(null);
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (track) {
    const buses = project.tracks.filter((t) => t.type === 'bus' && t.id !== track.id);
    return (
      <div className="panel-body" data-testid="inspector">
        <div className="panel-section">
          <div className="ps-title">{track.type} track</div>
          <div className="insp-row">
            <span className="k">Name</span>
            <input
              type="text"
              value={track.name}
              onChange={(e) => store.setTrack(track.id, { name: e.target.value })}
              aria-label="Track name"
            />
          </div>
          <div className="insp-row">
            <span className="k">Color</span>
          </div>
          <div className="color-swatches">
            {TRACK_COLORS.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                className={track.color === c ? 'on' : ''}
                onClick={() => store.setTrack(track.id, { color: c })}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
          <div className="insp-row">
            <span className="k">Volume</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={track.volume}
              onChange={(e) => store.setTrack(track.id, { volume: Number(e.target.value) })}
              aria-label="Track volume"
            />
            <span className="v mono">{formatDb(track.volume)}</span>
          </div>
          <div className="insp-row">
            <span className="k">Pan</span>
            <PanKnob
              value={track.pan}
              onChange={(v) => store.setTrack(track.id, { pan: v })}
              label="Track pan"
            />
            <span className="v mono">
              {track.pan === 0
                ? 'C'
                : `${Math.abs(Math.round(track.pan * 100))}${track.pan < 0 ? 'L' : 'R'}`}
            </span>
          </div>
          {track.type !== 'bus' && (
            <div className="insp-row">
              <span className="k">Output</span>
              <select
                value={track.output}
                onChange={(e) => store.setTrack(track.id, { output: e.target.value })}
                aria-label="Track output"
              >
                <option value="master">Master</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {(track.type === 'instrument' || track.type === 'drum') && (
            <div className="insp-row">
              <span className="k">MIDI input</span>
              <select
                value={track.midiChannel ?? 0}
                onChange={(e) => store.setTrack(track.id, { midiChannel: Number(e.target.value) })}
                aria-label={`MIDI input channel for ${track.name}`}
                data-testid="midi-channel"
                title="Which MIDI channel plays this track. Omni takes every channel; any other value takes that one alone, which is how one keyboard drives several tracks."
              >
                <option value={0}>Omni — every channel</option>
                {MIDI_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    Channel {c}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="insp-row" style={{ gap: 6 }}>
            {/* A button's own text is its accessible name, so "M", "S" and a
                bullet announce as themselves and nothing else. The label has to
                say which track, and the pressed state has to be exposed, or
                there is no way to hear whether the track is muted. */}
            <button
              className={`th-mini${track.mute ? ' m-on' : ''}`}
              aria-label={`Mute ${track.name}`}
              aria-pressed={track.mute}
              title="Mute"
              onClick={() => store.setTrack(track.id, { mute: !track.mute })}
            >
              M
            </button>
            <button
              className={`th-mini${track.solo ? ' s-on' : ''}`}
              aria-label={`Solo ${track.name}`}
              aria-pressed={track.solo}
              title="Solo"
              onClick={() => store.setTrack(track.id, { solo: !track.solo })}
            >
              S
            </button>
            {track.type !== 'bus' && (
              <button
                className={`th-mini${track.armed ? ' r-on' : ''}`}
                aria-label={`Record arm ${track.name}`}
                aria-pressed={track.armed}
                title="Record arm"
                onClick={() => void setArmed(track.id, !track.armed)}
              >
                ●
              </button>
            )}
            <span className="spacer" style={{ flex: 1 }} />
            <button className="btn" onClick={() => store.duplicateTrack(track.id)}>
              Duplicate
            </button>
          </div>
        </div>
        {track.type === 'audio' && (
          <div className="panel-section">
            <TrackInputControls trackId={track.id} />
          </div>
        )}
        {(track.type === 'instrument' || track.type === 'drum') && (
          <div className="panel-section">
            <NoteFxRack track={track} />
          </div>
        )}
        {(track.type === 'instrument' || track.type === 'drum') && (
          <FreezePanel project={project} track={track} />
        )}
        <div className="panel-section">
          <MacroPanel track={track} />
        </div>
        <div className="panel-section">
          <InsertRack track={track} />
        </div>
        <div className="panel-section">
          <SendRack track={track} buses={buses} />
        </div>
      </div>
    );
  }

  return (
    <div className="panel-body" data-testid="inspector">
      <div className="panel-section">
        <div className="ps-title">Project</div>
        <div className="insp-row">
          <span className="k">Name</span>
          <span className="v">{project.name}</span>
        </div>
        <div className="insp-row">
          <span className="k">Tempo</span>
          <span className="v mono">{project.bpm} BPM</span>
        </div>
        <div className="insp-row">
          <span className="k">Signature</span>
          <span className="v mono">
            {project.timeSig.num}/{project.timeSig.den}
          </span>
        </div>
        <div className="insp-row">
          <span className="k">Tracks</span>
          <span className="v">{project.tracks.length}</span>
        </div>
        <div className="insp-row">
          <span className="k">Clips</span>
          <span className="v">{project.clips.length}</span>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Select a track or clip to edit its properties.
        </div>
      </div>
      <div className="panel-section">
        <div className="ps-title">Notes</div>
        <textarea
          className="project-notes"
          value={project.notes ?? ''}
          placeholder="Lyrics, session to-dos, mix decisions… saved with the project."
          aria-label="Project notes"
          data-testid="project-notes"
          rows={6}
          onChange={(e) => store.setNotes(e.target.value)}
        />
      </div>
    </div>
  );
}
