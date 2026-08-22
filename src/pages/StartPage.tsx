/**
 * Start page.
 *
 * The reference opens on a page, not on a session: recent work, somewhere to
 * begin from a template, the demos, and the state of the machine you are about
 * to record on. Booting straight into a demo song is what a toy does.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  deleteById,
  duplicateById,
  newProjectFromTemplate,
  openProject,
} from '../app/projectActions';
import { listProjects } from '../persistence/projectRepo';
import { TEMPLATES, type Template } from '../model/templates';
import type { ProjectMeta } from '../model/types';
import { useProjectStore } from '../state/projectStore';
import { useRouteStore } from '../state/routeStore';
import { useTransportStore } from '../state/transportStore';
import { useUiStore } from '../state/uiStore';
import { Icon, type IconName } from '../components/common/Icon';
import { APP_VERSION } from '../diagnostics/report';

/**
 * Release highlights, shown on the Start page rather than buried in a file
 * nobody opens. Kept short: three things that changed, not a changelog.
 */
const WHATS_NEW: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'sliders',
    title: '27 effects with real plugin faces',
    body: 'Dynamics, tone, modulation, time and stereo — each with the curve, meter or shape it actually needs, plus chain presets.',
  },
  {
    icon: 'section',
    title: 'Global tracks and an arrangement overview',
    body: 'Markers, arranger sections, a chord track and a tempo map with ramps, over a bird’s-eye navigator of the whole song.',
  },
  {
    icon: 'meter',
    title: 'Release and Live pages',
    body: 'Assemble and measure a release to BS.1770, or run a setlist from a stage-legible transport.',
  },
];

function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.round(d)} d ago`;
  return new Date(ms).toLocaleDateString();
}

function TemplateCard({ template }: { template: Template }) {
  const go = useRouteStore((s) => s.go);
  return (
    <button
      className="start-template"
      onClick={async () => {
        await newProjectFromTemplate(template);
        go('song');
      }}
      title={template.blurb}
      data-testid={`template-${template.id}`}
    >
      <span className="tpl-icon" style={{ color: template.color }}>
        <Icon name={template.icon as IconName} size={20} />
      </span>
      <span className="tpl-name">{template.name}</span>
      <span className="tpl-blurb">{template.blurb}</span>
      <span className="tpl-meta">{template.summary}</span>
    </button>
  );
}

export default function StartPage() {
  const [recents, setRecents] = useState<ProjectMeta[] | null>(null);
  const go = useRouteStore((s) => s.go);
  const currentId = useProjectStore((s) => s.project.id);
  const currentName = useProjectStore((s) => s.project.name);
  const audioState = useTransportStore((s) => s.audioState);
  const midiSupported = useTransportStore((s) => s.midiSupported);

  const refresh = useCallback(() => {
    void listProjects()
      .then(setRecents)
      .catch(() => setRecents([]));
  }, []);

  // The boot save can still be in flight when this page mounts, so the list
  // also refreshes whenever a save completes — otherwise a first-run visitor
  // is told they have no projects while one is being written.
  useEffect(() => {
    refresh();
    return useProjectStore.subscribe((s, prev) => {
      if (s.lastSavedAt !== prev.lastSavedAt || s.project.id !== prev.project.id) refresh();
    });
  }, [refresh]);

  return (
    <div className="start-page" data-testid="start-page">
      <div className="start-inner">
        <header className="start-hero">
          <Icon name="logo" size={44} />
          <div>
            <h1 className="t-title">MotionLab Studio</h1>
            <p className="t-body">Professional music production. Anywhere. v{APP_VERSION}</p>
          </div>
          <span className="grow" />
          <button className="btn primary" onClick={() => go('song')} data-testid="start-continue">
            <Icon name="play" size={14} /> Continue “{currentName}”
          </button>
        </header>

        <div className="start-cols">
          <section className="start-recent">
            <h2 className="t-label">Recent</h2>
            {recents === null && <p className="hint">Reading your projects…</p>}
            {recents?.length === 0 && (
              <div className="empty-state">
                <Icon name="folder-open" size={26} className="es-icon" />
                <div className="es-title">No saved projects yet</div>
                <p className="es-body">
                  Start from a template on the right — it saves as you work.
                </p>
              </div>
            )}
            <ul className="start-list">
              {(recents ?? []).map((p) => (
                <li key={p.id} className={p.id === currentId ? 'current' : ''}>
                  <button
                    className="start-item"
                    onClick={async () => {
                      if (p.id !== currentId) await openProject(p.id);
                      go('song');
                    }}
                    data-testid={`recent-${p.name}`}
                  >
                    <span className="si-name">{p.name}</span>
                    <span className="si-meta">
                      {p.trackCount} track{p.trackCount === 1 ? '' : 's'} · {p.clipCount} clip
                      {p.clipCount === 1 ? '' : 's'} · {timeAgo(p.modifiedAt)}
                    </span>
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Actions for ${p.name}`}
                    title="Duplicate or delete"
                    onClick={(e) =>
                      useUiStore.getState().showMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          {
                            label: 'Open',
                            action: async () => {
                              await openProject(p.id);
                              go('song');
                            },
                          },
                          {
                            label: 'Duplicate',
                            action: async () => {
                              await duplicateById(p.id);
                              refresh();
                            },
                          },
                          {
                            label: 'Delete',
                            danger: true,
                            action: async () => {
                              await deleteById(p.id);
                              refresh();
                            },
                          },
                        ],
                      })
                    }
                  >
                    <Icon name="dots" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="start-templates">
            <h2 className="t-label">Start something</h2>
            <div className="template-grid">
              {TEMPLATES.map((t) => (
                <TemplateCard key={t.id} template={t} />
              ))}
            </div>
          </section>
        </div>

        <section className="start-news">
          <h2 className="t-label">What’s new</h2>
          <ul className="news-list">
            {WHATS_NEW.map((n) => (
              <li key={n.title}>
                <span className="news-icon">
                  <Icon name={n.icon} size={14} />
                </span>
                <div>
                  <span className="news-title">{n.title}</span>
                  <span className="news-body">{n.body}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="start-foot">
          <div className="start-status">
            <span className={`chip ${audioState === 'running' ? 'ok' : ''}`}>
              <span className="dot" /> Audio {audioState === 'running' ? 'running' : 'idle'}
            </span>
            <span className={`chip ${midiSupported ? 'ok' : 'warn'}`}>
              <span className="dot" /> Web MIDI {midiSupported ? 'available' : 'unavailable'}
            </span>
            <span className="chip ok">
              <span className="dot" /> Works offline
            </span>
          </div>
          <span className="grow" />
          <button className="btn" onClick={() => go('mastering')}>
            <Icon name="meter" size={14} /> Mastering
          </button>
          <button className="btn" onClick={() => go('show')}>
            <Icon name="zap" size={14} /> Live
          </button>
          <button
            className="btn"
            onClick={() => useUiStore.getState().set({ settingsOpen: true })}
            data-testid="start-settings"
          >
            <Icon name="settings" size={14} /> Preferences
          </button>
        </footer>
      </div>
    </div>
  );
}
