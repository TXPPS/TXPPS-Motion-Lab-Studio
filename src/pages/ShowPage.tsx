/**
 * Show page — live performance.
 *
 * On stage nobody edits. They need the next song cued, the tempo and key in
 * front of them, a click they can start without hunting, and type big enough to
 * read from three metres away in the dark. This page is a setlist and a
 * transport, and deliberately nothing else.
 *
 * Everything here writes into `project.show`, so a setlist is saved with the
 * project and travels with it.
 */
import { useCallback, useEffect, useState } from 'react';
import { engine } from '../audio/engine';
import { newId } from '../model/ids';
import { barToBeat, formatBBT } from '../model/tempo';
import { tempoMapOf } from '../model/music';
import type { SetlistEntry, ShowSetup } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useRouteStore } from '../state/routeStore';
import { useTransportStore } from '../state/transportStore';
import { useUiStore } from '../state/uiStore';
import { Icon } from '../components/common/Icon';

const ENTRY_COLORS = ['#37b89a', '#d9a13c', '#4a90c4', '#c96f9b', '#9070c9', '#d97455'];

export default function ShowPage() {
  const project = useProjectStore((s) => s.project);
  const show = project.show ?? { entries: [], cued: 0, stageMode: false };
  const playState = useTransportStore((s) => s.playState);
  const go = useRouteStore((s) => s.go);
  const [position, setPosition] = useState('1.1.000');

  const update = useCallback((fn: (s: ShowSetup) => void) => {
    useProjectStore.getState().update((d) => {
      d.show ??= { entries: [], cued: 0, stageMode: false };
      fn(d.show);
    });
  }, []);

  // A big position readout, written from the audio frame like the transport's.
  useEffect(() => {
    return engine.onFrame(() => {
      const p = useProjectStore.getState().project;
      setPosition(formatBBT(tempoMapOf(p), engine.getPositionBeats(), false));
    });
  }, []);

  const cued = Math.min(show.cued ?? 0, Math.max(0, show.entries.length - 1));
  const entry: SetlistEntry | undefined = show.entries[cued];

  const cue = (index: number) => {
    const target = show.entries[index];
    if (!target) return;
    update((s) => void (s.cued = index));
    if (target.bpm) useProjectStore.getState().setBpm(target.bpm);
    if (target.timeSig)
      useProjectStore.getState().setTimeSig(target.timeSig.num, target.timeSig.den);
    engine.seek(target.startBeat ?? 0);
  };

  const addFromCurrentSong = () => {
    update((s) => {
      s.entries.push({
        id: newId('set'),
        name: project.name,
        projectId: project.id,
        startBeat: 0,
        bpm: project.bpm,
        timeSig: { ...project.timeSig },
        color: ENTRY_COLORS[s.entries.length % ENTRY_COLORS.length],
      });
    });
  };

  return (
    <div className={`page show-page${show.stageMode ? ' stage' : ''}`} data-testid="show-page">
      <header className="page-head">
        <button className="btn" onClick={() => go('song')} title="Back to the song">
          <Icon name="chevron-left" size={14} /> Song
        </button>
        <h1 className="t-heading">Setlist</h1>
        <span className="hint">
          {show.entries.length} song{show.entries.length === 1 ? '' : 's'}
        </span>
        <span className="grow" />
        <button
          className={`btn${show.stageMode ? ' on' : ''}`}
          onClick={() => update((s) => void (s.stageMode = !s.stageMode))}
          title="Stage mode — larger type, fewer controls"
          data-testid="stage-mode"
        >
          <Icon name="sun" size={14} /> Stage mode
        </button>
        <button className="btn" onClick={addFromCurrentSong}>
          <Icon name="plus" size={14} /> Add current song
        </button>
      </header>

      <div className="show-body">
        <section className="show-list">
          {show.entries.length === 0 ? (
            <div className="empty-state">
              <Icon name="zap" size={30} className="es-icon" />
              <div className="es-title">No setlist yet</div>
              <p className="es-body">
                Add the current song, then add more. Each entry carries its own tempo, signature,
                start point and a note you can read from the back of the stage.
              </p>
            </div>
          ) : (
            <ol className="show-entries">
              {show.entries.map((e, i) => (
                <li
                  key={e.id}
                  className={`show-entry${i === cued ? ' cued' : ''}`}
                  style={{ ['--entry-color' as string]: e.color ?? 'var(--accent)' }}
                  data-testid={`setlist-${i + 1}`}
                >
                  <button className="se-main" onClick={() => cue(i)}>
                    <span className="se-num">{i + 1}</span>
                    <span className="se-name">{e.name}</span>
                    <span className="se-meta t-num">
                      {e.bpm ? `${Math.round(e.bpm)} BPM` : ''}
                      {e.timeSig ? ` · ${e.timeSig.num}/${e.timeSig.den}` : ''}
                    </span>
                    {e.note && <span className="se-note">{e.note}</span>}
                  </button>
                  <span className="se-actions">
                    <button
                      className="icon-btn"
                      aria-label={`Note for ${e.name}`}
                      title="Performance note"
                      onClick={() =>
                        useUiStore.getState().showDialog({
                          kind: 'prompt',
                          title: `Note — ${e.name}`,
                          initialValue: e.note ?? '',
                          onSubmit: (v) =>
                            update((s) => {
                              const t = s.entries.find((x) => x.id === e.id);
                              if (t) t.note = v;
                            }),
                        })
                      }
                    >
                      <Icon name="pencil" size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Move ${e.name} up`}
                      disabled={i === 0}
                      onClick={() =>
                        update((s) => {
                          const [x] = s.entries.splice(i, 1);
                          s.entries.splice(i - 1, 0, x);
                        })
                      }
                    >
                      <Icon name="arrow-up" size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Move ${e.name} down`}
                      disabled={i === show.entries.length - 1}
                      onClick={() =>
                        update((s) => {
                          const [x] = s.entries.splice(i, 1);
                          s.entries.splice(i + 1, 0, x);
                        })
                      }
                    >
                      <Icon name="arrow-down" size={13} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${e.name}`}
                      onClick={() =>
                        update((s) => {
                          s.entries = s.entries.filter((x) => x.id !== e.id);
                        })
                      }
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="show-stage">
          <div className="stage-now">
            <span className="t-label">Now</span>
            <span className="stage-name">{entry?.name ?? project.name}</span>
            <span className="stage-note">{entry?.note ?? ''}</span>
          </div>

          <div className="stage-readout">
            <span className="stage-pos t-num">{position}</span>
            <span className="stage-tempo t-num">
              {Math.round(project.bpm)} BPM · {project.timeSig.num}/{project.timeSig.den}
            </span>
          </div>

          <div className="stage-transport">
            <button
              className="stage-btn"
              onClick={() => engine.returnToStart()}
              aria-label="Return to start"
            >
              <Icon name="skipback" size={26} />
            </button>
            <button
              className={`stage-btn go${playState === 'playing' ? ' on' : ''}`}
              onClick={() => (playState === 'playing' ? engine.stop() : void engine.play())}
              aria-label={playState === 'playing' ? 'Stop' : 'Play'}
              data-testid="stage-play"
            >
              <Icon name={playState === 'playing' ? 'stop' : 'play'} size={34} />
            </button>
            <button
              className={`stage-btn${project.metronome ? ' on' : ''}`}
              onClick={() => useProjectStore.getState().setMetronome(!project.metronome)}
              aria-label="Metronome"
              aria-pressed={project.metronome}
            >
              <Icon name="metronome" size={26} />
            </button>
          </div>

          <div className="stage-next">
            <span className="t-label">Next</span>
            <button
              className="btn full"
              disabled={cued + 1 >= show.entries.length}
              onClick={() => cue(cued + 1)}
              data-testid="stage-next"
            >
              {show.entries[cued + 1]?.name ?? 'End of set'}
              <Icon name="chevron-right" size={14} />
            </button>
          </div>

          <div className="stage-marks">
            <span className="t-label">Jump</span>
            <div className="row wrap">
              {(project.markers ?? []).slice(0, 12).map((m) => (
                <button key={m.id} className="btn" onClick={() => engine.seek(m.beat)}>
                  {m.name}
                </button>
              ))}
              {(project.markers ?? []).length === 0 && (
                <button
                  className="btn"
                  onClick={() => engine.seek(barToBeat(tempoMapOf(project), 0))}
                >
                  Top
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
