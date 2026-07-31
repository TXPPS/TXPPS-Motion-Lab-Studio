import { useEffect, useState } from 'react';
import { listMedia } from '../../audio/demoAudio';
import { snapBeatFloor } from '../../model/music';
import { SYNTH_PRESETS } from '../../model/presets';
import type { ProjectMeta } from '../../model/types';
import { listProjects } from '../../persistence/projectRepo';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import {
  deleteById,
  duplicateById,
  newProject,
  openProject,
  renameCurrent,
  saveCurrent,
  saveCurrentAs,
} from '../../app/projectActions';
import { Icon } from '../common/Icon';
import { engine } from '../../audio/engine';
import { pickAndImport } from '../../app/importActions';

function fmtWhen(ts: number): string {
  if (!ts) return '—';
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function ProjectsTab() {
  const current = useProjectStore((s) => s.project);
  const dirty = useProjectStore((s) => s.dirty);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const [metas, setMetas] = useState<ProjectMeta[] | null>(null);

  const refresh = () => {
    listProjects()
      .then(setMetas)
      .catch(() => setMetas([]));
  };
  useEffect(refresh, [current.id, lastSavedAt]);

  const ui = useUiStore.getState();
  return (
    <>
      <div className="panel-section" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          className="btn"
          data-testid="proj-new"
          onClick={() =>
            ui.showDialog({
              kind: 'prompt',
              title: 'New project',
              initialValue: 'Untitled Project',
              confirmLabel: 'Create',
              onSubmit: (v) => void newProject(v || 'Untitled Project'),
            })
          }
        >
          <Icon name="plus" size={12} /> New
        </button>
        <button className="btn" data-testid="proj-save" onClick={() => void saveCurrent()}>
          <Icon name="save" size={12} /> Save
        </button>
        <button
          className="btn"
          data-testid="proj-saveas"
          onClick={() =>
            ui.showDialog({
              kind: 'prompt',
              title: 'Save As',
              initialValue: `${current.name} copy`,
              confirmLabel: 'Save',
              onSubmit: (v) => void saveCurrentAs(v || `${current.name} copy`),
            })
          }
        >
          Save As…
        </button>
      </div>
      {metas === null ? (
        <div className="panel-section hint">Loading projects…</div>
      ) : metas.length === 0 ? (
        <div className="panel-section hint">No saved projects yet.</div>
      ) : (
        metas.map((m) => (
          <div
            key={m.id}
            className={`list-item${m.id === current.id ? ' on' : ''}`}
            data-testid={`proj-item-${m.name}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (m.id !== current.id) void openProject(m.id);
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && m.id !== current.id)
                void openProject(m.id);
            }}
          >
            <div className="li-main">
              <div className="li-title">
                {m.name}
                {m.id === current.id && dirty ? ' •' : ''}
              </div>
              <div className="li-sub">
                {fmtWhen(m.modifiedAt)} · {m.trackCount} tracks · {m.clipCount} clips
              </div>
            </div>
            <span
              className="li-actions"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                className="icon-btn"
                title="Project menu"
                onClick={(e) => {
                  e.stopPropagation();
                  useUiStore.getState().showMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      ...(m.id === current.id
                        ? [
                            {
                              label: 'Rename…',
                              action: () =>
                                useUiStore.getState().showDialog({
                                  kind: 'prompt',
                                  title: 'Rename project',
                                  initialValue: m.name,
                                  confirmLabel: 'Rename',
                                  onSubmit: (v) => v && void renameCurrent(v),
                                }),
                            },
                          ]
                        : [{ label: 'Open', action: () => void openProject(m.id) }]),
                      { label: 'Duplicate', action: () => void duplicateById(m.id) },
                      {
                        label: 'Delete',
                        danger: true,
                        action: () =>
                          useUiStore.getState().showDialog({
                            kind: 'confirm',
                            title: `Delete "${m.name}"?`,
                            message: 'This permanently removes the saved project.',
                            confirmLabel: 'Delete',
                            danger: true,
                            onSubmit: () => void deleteById(m.id),
                          }),
                      },
                    ],
                  });
                }}
              >
                <Icon name="dots" size={13} />
              </button>
            </span>
          </div>
        ))
      )}
      <div className="panel-section">
        <button
          className="btn"
          onClick={() => void newProject('MotionLab Demo', { demo: true })}
          data-testid="proj-demo"
        >
          <Icon name="wave" size={12} /> New demo project
        </button>
      </div>
    </>
  );
}

function PresetsTab() {
  const applyPreset = useProjectStore((s) => s.applyPreset);
  const tracks = useProjectStore((s) => s.project.tracks);
  const selId = useUiStore((s) => s.selectedTrackId);
  const target =
    tracks.find((t) => t.id === selId && t.type === 'instrument') ??
    tracks.find((t) => t.type === 'instrument');
  return (
    <>
      <div className="panel-section hint">
        {target ? `Applies to: ${target.name}` : 'Select an instrument track first.'}
      </div>
      {SYNTH_PRESETS.map((p) => (
        <button
          key={p.presetName}
          className={`list-item${target?.synth?.presetName === p.presetName ? ' on' : ''}`}
          disabled={!target}
          onClick={() => target && applyPreset(target.id, p.presetName)}
        >
          <div className="li-main">
            <div className="li-title">{p.presetName}</div>
            <div className="li-sub">
              {p.waveform} · cutoff{' '}
              {p.cutoff >= 1000 ? `${(p.cutoff / 1000).toFixed(1)}k` : p.cutoff}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}

function LoopsTab() {
  const addAudioClip = useProjectStore((s) => s.addAudioClip);
  const addTrack = useProjectStore((s) => s.addTrack);
  const bpm = useProjectStore((s) => s.project.bpm);
  const media = useProjectStore((s) => s.project.media);
  const imported = (media ?? []).filter((m) => m.kind !== 'procedural');

  return (
    <>
      <div className="panel-section">
        <button
          className="btn primary full"
          data-testid="import-audio"
          onClick={() => pickAndImport({})}
        >
          <Icon name="plus" size={13} />
          Import audio file
        </button>
        <div className="hint">
          Or drag files onto a track. Decoding is the browser&apos;s — WAV, MP3 and M4A work
          everywhere.
        </div>
      </div>

      {imported.length > 0 && (
        <>
          <div className="panel-section hint">In this project</div>
          {imported.map((m) => (
            <button
              key={m.id}
              className="list-item"
              data-testid={`media-item-${m.id}`}
              onClick={() => {
                const trackId = addTrack('audio');
                const start = snapBeatFloor(engine.getPositionBeats(), 4);
                addAudioClip(
                  trackId,
                  m.id,
                  start,
                  Math.max(0.25, (m.duration * bpm) / 60),
                  m.name,
                  m.duration,
                );
                useUiStore.getState().selectTrack(trackId);
                useUiStore.getState().toast('info', `Added "${m.name}" on a new audio track`);
              }}
            >
              <div className="li-main">
                <div className="li-title">{m.name}</div>
                <div className="li-sub">
                  {m.kind === 'recording' ? 'Recording' : 'Imported'} · {m.duration.toFixed(1)}s ·{' '}
                  {m.channels === 1 ? 'mono' : `${m.channels}ch`} @ {(m.sampleRate / 1000).toFixed(1)}k
                </div>
              </div>
              <Icon name="plus" size={14} />
            </button>
          ))}
        </>
      )}

      <div className="panel-section hint">
        Generated royalty-free loops (rendered at 110 BPM{bpm !== 110 ? `, project is ${bpm}` : ''}
        ).
      </div>
      {listMedia().map((m) => (
        <button
          key={m.id}
          className="list-item"
          onClick={() => {
            const trackId = addTrack('audio');
            const start = snapBeatFloor(engine.getPositionBeats(), 4);
            addAudioClip(trackId, m.id, start, m.bars * 4, m.name);
            useUiStore.getState().selectTrack(trackId);
            useUiStore.getState().toast('info', `Added "${m.name}" on a new audio track`);
          }}
        >
          <div className="li-main">
            <div className="li-title">{m.name}</div>
            <div className="li-sub">
              {m.bars} bars · {m.seconds.toFixed(1)}s · tap to add
            </div>
          </div>
          <Icon name="plus" size={14} />
        </button>
      ))}
    </>
  );
}

export function BrowserPanel() {
  const tab = useUiStore((s) => s.browserTab);
  return (
    <>
      <div className="browser-tabs">
        {(['projects', 'presets', 'loops'] as const).map((t) => (
          <button
            key={t}
            className={tab === t ? 'on' : ''}
            onClick={() => useUiStore.getState().set({ browserTab: t })}
            data-testid={`browser-tab-${t}`}
          >
            {t === 'projects' ? 'Projects' : t === 'presets' ? 'Presets' : 'Loops'}
          </button>
        ))}
      </div>
      <div className="panel-body" data-testid="browser-panel">
        {tab === 'projects' ? <ProjectsTab /> : tab === 'presets' ? <PresetsTab /> : <LoopsTab />}
      </div>
    </>
  );
}
