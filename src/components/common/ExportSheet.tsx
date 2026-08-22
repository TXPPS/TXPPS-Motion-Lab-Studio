/**
 * Export dialog.
 *
 * Bouncing used to be one menu item that produced a 16-bit WAV of the whole
 * song with no dither, no metadata and no progress. Every decision an engineer
 * makes before delivering is here, the size is estimated before anything runs,
 * and the render reports what it is doing while it does it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_EXPORT,
  cancelExport,
  exportProject,
  exportState,
  onExportState,
  type ExportSettings,
} from '../../app/exportActions';
import { AUDIO_FORMATS, estimateSize, type EncodeBitDepth } from '../../audio/encode';
import { projectBeatRangeSec } from '../../model/music';
import { useProjectStore, projectEndBeat } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { Icon } from '../common/Icon';

const RATES = [44100, 48000, 88200, 96000];

function bytesLabel(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function ExportSheet() {
  const open = useUiStore((s) => s.exportOpen);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  const project = useProjectStore((s) => s.project);
  const [settings, setSettings] = useState<ExportSettings>(() => ({
    ...DEFAULT_EXPORT,
    metadata: { artist: project.artist ?? '', genre: project.genre ?? '' },
  }));
  const [progress, setProgress] = useState(exportState());

  useEffect(() => onExportState(setProgress), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUiStore.getState().set({ exportOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const format = AUDIO_FORMATS.find((f) => f.id === settings.format) ?? AUDIO_FORMATS[0];

  const { seconds, fileCount } = useMemo(() => {
    const loop = project.loop;
    const start = settings.range === 'loop' ? loop.start : 0;
    const end = settings.range === 'loop' ? loop.end : projectEndBeat(project);
    const secs =
      projectBeatRangeSec(project, start, Math.max(0, end - start)) + settings.tailSeconds;
    const count =
      settings.scope === 'mix'
        ? 1
        : settings.scope === 'stems'
          ? Math.max(1, project.tracks.filter((t) => t.type === 'bus' || t.type === 'fx').length)
          : Math.max(
              1,
              project.tracks.filter(
                (t) => t.type === 'audio' || t.type === 'instrument' || t.type === 'drum',
              ).length,
            );
    return { seconds: secs, fileCount: count };
  }, [project, settings.range, settings.scope, settings.tailSeconds]);

  const estimate =
    estimateSize(Math.ceil(seconds * settings.sampleRate), 2, {
      format: settings.format,
      sampleRate: settings.sampleRate,
      bitDepth: settings.bitDepth,
      float: settings.float,
    }) * fileCount;

  if (!open) return null;

  const running = progress.stage === 'rendering' || progress.stage === 'preparing';

  const patch = (p: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...p }));

  return (
    <div
      className="sheet-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !running) {
          useUiStore.getState().set({ exportOpen: false });
        }
      }}
    >
      <div
        className="sheet export-sheet"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Export"
        data-testid="export-sheet"
      >
        <div className="sheet-head">
          <h2 className="t-heading">Export</h2>
          <button
            className="icon-btn"
            disabled={running}
            onClick={() => useUiStore.getState().set({ exportOpen: false })}
            aria-label="Close export"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="sheet-body">
          <section>
            <h3 className="t-label">What</h3>
            <div className="set-row">
              <div className="set-label">
                <span>Scope</span>
                <span className="hint">
                  Stems render each bus and FX return through the same signal path the mix used
                </span>
              </div>
              <div className="seg" role="group" aria-label="Export scope">
                {(
                  [
                    ['mix', 'Master mix'],
                    ['stems', 'Stems (buses)'],
                    ['tracks', 'Per track'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={settings.scope === id ? 'on' : ''}
                    aria-pressed={settings.scope === id}
                    onClick={() => patch({ scope: id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="set-label">
                <span>Range</span>
              </div>
              <div className="seg" role="group" aria-label="Export range">
                <button
                  className={settings.range === 'song' ? 'on' : ''}
                  aria-pressed={settings.range === 'song'}
                  onClick={() => patch({ range: 'song' })}
                >
                  Whole song
                </button>
                <button
                  className={settings.range === 'loop' ? 'on' : ''}
                  aria-pressed={settings.range === 'loop'}
                  disabled={!(project.loop.end > project.loop.start)}
                  onClick={() => patch({ range: 'loop' })}
                >
                  Loop region
                </button>
              </div>
            </div>
            <div className="set-row">
              <div className="set-label">
                <span>Tail</span>
                <span className="hint">Decay captured past the last event</span>
              </div>
              <div className="set-control">
                <input
                  type="range"
                  min={0}
                  max={10}
                  step={0.5}
                  value={settings.tailSeconds}
                  aria-label="Tail seconds"
                  onChange={(e) => patch({ tailSeconds: Number(e.target.value) })}
                />
                <span className="t-num">{settings.tailSeconds.toFixed(1)} s</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="t-label">Format</h3>
            <div className="format-grid">
              {AUDIO_FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={`format-card${settings.format === f.id ? ' on' : ''}`}
                  onClick={() =>
                    patch({
                      format: f.id,
                      bitDepth: f.bitDepths.includes(settings.bitDepth)
                        ? settings.bitDepth
                        : f.bitDepths[f.bitDepths.length - 1],
                      float: f.supportsFloat ? settings.float : false,
                    })
                  }
                  data-testid={`format-${f.id}`}
                >
                  <span className="fmt-name">{f.name}</span>
                  <span className="fmt-desc">{f.description}</span>
                </button>
              ))}
            </div>
            <div className="set-row">
              <div className="set-label">
                <span>Bit depth</span>
              </div>
              <div className="seg" role="group" aria-label="Bit depth">
                {format.bitDepths.map((d: EncodeBitDepth) => (
                  <button
                    key={d}
                    className={settings.bitDepth === d && !settings.float ? 'on' : ''}
                    aria-pressed={settings.bitDepth === d && !settings.float}
                    onClick={() => patch({ bitDepth: d, float: false })}
                  >
                    {d}-bit
                  </button>
                ))}
                {format.supportsFloat && (
                  <button
                    className={settings.float ? 'on' : ''}
                    aria-pressed={settings.float}
                    onClick={() => patch({ bitDepth: 32, float: true })}
                    title="No clipping and no dither needed — the right choice for a file that will be processed again"
                  >
                    32-bit float
                  </button>
                )}
              </div>
            </div>
            <div className="set-row">
              <div className="set-label">
                <span>Sample rate</span>
              </div>
              <div className="seg" role="group" aria-label="Sample rate">
                {RATES.map((r) => (
                  <button
                    key={r}
                    className={settings.sampleRate === r ? 'on' : ''}
                    aria-pressed={settings.sampleRate === r}
                    onClick={() => patch({ sampleRate: r })}
                  >
                    {(r / 1000).toFixed(r % 1000 ? 1 : 0)} k
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="set-label">
                <span>Dither</span>
                <span className="hint">
                  {settings.float || settings.bitDepth === 32
                    ? 'Not needed at 32-bit'
                    : 'Applied when reducing to a fixed-point depth'}
                </span>
              </div>
              <div className="seg" role="group" aria-label="Dither">
                {(
                  [
                    ['none', 'Off'],
                    ['tpdf', 'TPDF'],
                    ['shaped', 'Shaped'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    className={settings.dither === id ? 'on' : ''}
                    aria-pressed={settings.dither === id}
                    disabled={settings.float || settings.bitDepth === 32}
                    onClick={() => patch({ dither: id })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section>
            <h3 className="t-label">Level</h3>
            <div className="set-row">
              <div className="set-label">
                <span>Normalise</span>
                <span className="hint">Scale so the true peak lands on a ceiling</span>
              </div>
              <div className="seg" role="group" aria-label="Normalise">
                <button
                  className={settings.normalizeDbtp === null ? 'on' : ''}
                  aria-pressed={settings.normalizeDbtp === null}
                  onClick={() => patch({ normalizeDbtp: null })}
                >
                  Off
                </button>
                {[-1, -0.3].map((db) => (
                  <button
                    key={db}
                    className={settings.normalizeDbtp === db ? 'on' : ''}
                    aria-pressed={settings.normalizeDbtp === db}
                    onClick={() => patch({ normalizeDbtp: db })}
                  >
                    {db} dBTP
                  </button>
                ))}
              </div>
            </div>
            <div className="set-row">
              <div className="set-label">
                <span>Trim silence</span>
                <span className="hint">Remove quiet heads and tails</span>
              </div>
              <div className="set-control">
                <input
                  type="checkbox"
                  checked={settings.trimSilence}
                  aria-label="Trim silence"
                  onChange={(e) => patch({ trimSilence: e.target.checked })}
                />
              </div>
            </div>
          </section>

          {format.supportsMetadata && (
            <section>
              <h3 className="t-label">Metadata</h3>
              <div className="set-row">
                <div className="set-label">
                  <span>Artist</span>
                </div>
                <input
                  value={settings.metadata.artist ?? ''}
                  onChange={(e) =>
                    patch({ metadata: { ...settings.metadata, artist: e.target.value } })
                  }
                  aria-label="Artist"
                />
              </div>
              <div className="set-row">
                <div className="set-label">
                  <span>Album</span>
                </div>
                <input
                  value={settings.metadata.album ?? ''}
                  onChange={(e) =>
                    patch({ metadata: { ...settings.metadata, album: e.target.value } })
                  }
                  aria-label="Album"
                />
              </div>
              <div className="set-row">
                <div className="set-label">
                  <span>Genre</span>
                </div>
                <input
                  value={settings.metadata.genre ?? ''}
                  onChange={(e) =>
                    patch({ metadata: { ...settings.metadata, genre: e.target.value } })
                  }
                  aria-label="Genre"
                />
              </div>
            </section>
          )}
        </div>

        <div className="sheet-foot">
          <div className="export-estimate">
            <span className="t-num">
              {fileCount > 1 ? `${fileCount} files · ` : ''}
              {Math.floor(seconds / 60)}:{String(Math.round(seconds % 60)).padStart(2, '0')} ·{' '}
              {bytesLabel(estimate)}
            </span>
            {progress.message && progress.stage !== 'idle' && (
              <span className={`export-status ${progress.stage}`}>{progress.message}</span>
            )}
          </div>
          <span className="grow" />
          {running ? (
            <button className="btn danger" onClick={() => cancelExport()}>
              Cancel
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => useUiStore.getState().set({ exportOpen: false })}
            >
              Close
            </button>
          )}
          <button
            className="btn primary"
            disabled={running}
            onClick={() => void exportProject(settings)}
            data-testid="export-run"
          >
            <Icon name="download" size={14} /> Export
          </button>
        </div>
      </div>
    </div>
  );
}
