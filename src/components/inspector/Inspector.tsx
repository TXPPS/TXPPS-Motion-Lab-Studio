import { formatDb } from '../../model/music';
import { TRACK_COLORS } from '../../model/types';
import { getClip, getTrack, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { PanKnob } from '../common/widgets';
import { TrackInputControls } from '../recording/RecordControls';

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
          <div className="insp-row" style={{ gap: 6 }}>
            <button
              className={`th-mini${track.mute ? ' m-on' : ''}`}
              onClick={() => store.setTrack(track.id, { mute: !track.mute })}
            >
              M
            </button>
            <button
              className={`th-mini${track.solo ? ' s-on' : ''}`}
              onClick={() => store.setTrack(track.id, { solo: !track.solo })}
            >
              S
            </button>
            {track.type !== 'bus' && (
              <button
                className={`th-mini${track.armed ? ' r-on' : ''}`}
                onClick={() => store.setTrack(track.id, { armed: !track.armed })}
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
    </div>
  );
}
