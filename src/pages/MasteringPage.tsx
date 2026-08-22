/**
 * Project page — mastering and release assembly.
 *
 * A mix is not a release. This page is where finished mixes are put in order,
 * levelled against each other, measured against a delivery target, and exported
 * as a set. Each entry points at a real media item, so a master can be
 * re-opened, re-measured and re-exported instead of being a render that
 * vanished into a download.
 *
 * The loudness numbers are BS.1770-4 (integrated LUFS, LRA, true peak), the
 * same maths the export report prints — a mastering page whose numbers disagree
 * with the file it produced is worse than no numbers at all.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { engine } from '../audio/engine';
import { getBufferSync, loadBuffer } from '../audio/mediaLibrary';
import { audioBufferToWav, preloadForRender, renderProject } from '../audio/exportMix';
import { measureChannels, type LoudnessMeasurement } from '../model/loudness';
import { newId } from '../model/ids';
import { PEAKS_VERSION } from '../model/media';
import { formatClock } from '../model/tempo';
import type { MasterItem, MasteringProject } from '../model/types';
import { useProjectStore, projectEndBeat } from '../state/projectStore';
import { useRouteStore } from '../state/routeStore';
import { useUiStore } from '../state/uiStore';
import { Icon } from '../components/common/Icon';
import { InsertRack, type ChainHost } from '../components/mixer/InsertRack';
import { MAX_INSERTS, defaultParams, effectSpec } from '../model/effects';
import { putMediaBlob } from '../persistence/mediaStore';

const TARGETS = [
  { lufs: -14, ceiling: -1, label: 'Streaming', blurb: 'Spotify, Apple Music, YouTube' },
  { lufs: -16, ceiling: -1, label: 'Podcast', blurb: 'Apple Podcasts, Spotify spoken word' },
  { lufs: -23, ceiling: -2, label: 'Broadcast', blurb: 'EBU R128 / ATSC A/85' },
  { lufs: -9, ceiling: -0.3, label: 'Club / CD', blurb: 'Loud masters for a system' },
];

function fmtLufs(v: number): string {
  return v <= -70 ? '−∞' : `${v.toFixed(1)}`;
}

function MeasureCell({
  label,
  value,
  unit,
  warn,
}: {
  label: string;
  value: string;
  unit: string;
  warn?: boolean;
}) {
  return (
    <div className={`ms-cell${warn ? ' warn' : ''}`}>
      <span className="ms-val t-num">{value}</span>
      <span className="ms-unit">{unit}</span>
      <span className="ms-label">{label}</span>
    </div>
  );
}

export default function MasteringPage() {
  const project = useProjectStore((s) => s.project);
  const mastering = project.mastering ?? { items: [], targetLufs: -14, ceilingDbtp: -1 };
  const go = useRouteStore((s) => s.go);
  const [selectedId, setSelectedId] = useState<string | null>(mastering.items[0]?.id ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [measurement, setMeasurement] = useState<LoudnessMeasurement | null>(null);

  const selected = mastering.items.find((i) => i.id === selectedId) ?? null;

  const update = useCallback((fn: (m: MasteringProject) => void) => {
    useProjectStore.getState().update((d) => {
      d.mastering ??= { items: [], targetLufs: -14, ceilingDbtp: -1, effects: [] };
      fn(d.mastering);
    });
  }, []);

  /** Render the current song and add it to the release. */
  const addCurrentSong = async () => {
    setBusy('Rendering the current song…');
    try {
      const ctxOk = await engine.start();
      if (!ctxOk) throw new Error('Audio could not start.');
      await preloadForRender(project, engine.context!);
      const result = await renderProject(project, {
        range: { startBeat: 0, endBeat: projectEndBeat(project) },
        onProgress: (stage) => setBusy(stage),
      });
      setBusy('Measuring…');
      const channels: Float32Array[] = [];
      for (let c = 0; c < result.buffer.numberOfChannels; c++) {
        channels.push(result.buffer.getChannelData(c));
      }
      const m = measureChannels(channels, result.buffer.sampleRate);
      const blob = new Blob([audioBufferToWav(result.buffer)], { type: 'audio/wav' });
      const mediaId = newId('master');
      await putMediaBlob(mediaId, blob, 'audio/wav');
      const item: MasterItem = {
        id: newId('mi'),
        name: project.name,
        mediaId,
        gainDb: 0,
        fadeIn: 0,
        fadeOut: 0,
        gapAfter: 2,
        measured: {
          integratedLufs: m.integratedLufs,
          loudnessRangeLu: m.loudnessRangeLu,
          truePeakDbtp: m.truePeakDbtp,
          samplePeakDbfs: m.samplePeakDbfs,
          durationSeconds: m.durationSeconds,
          measuredAt: Date.now(),
        },
      };
      update((ms) => {
        ms.items.push(item);
      });
      useProjectStore.getState().registerMedia({
        id: mediaId,
        name: `${project.name} (master)`,
        kind: 'import',
        mimeType: 'audio/wav',
        byteSize: blob.size,
        duration: result.buffer.duration,
        sampleRate: result.buffer.sampleRate,
        channels: result.buffer.numberOfChannels,
        createdAt: Date.now(),
        source: 'mastering render',
        peaksVersion: PEAKS_VERSION,
      });
      setSelectedId(item.id);
      setMeasurement(m);
      useUiStore.getState().toast('info', `Added “${project.name}” to the release.`);
    } catch (e) {
      useUiStore.getState().toast('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // Measure whatever is selected, decoding it first if it is not in memory.
  useEffect(() => {
    if (!selected) {
      setMeasurement(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      let buf = getBufferSync(selected.mediaId);
      if (!buf) {
        const ctx = engine.context;
        if (!ctx) return;
        buf = await loadBuffer(selected.mediaId, ctx);
      }
      if (!buf || cancelled) return;
      const channels: Float32Array[] = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      const m = measureChannels(channels, buf.sampleRate);
      if (!cancelled) setMeasurement(m);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const totalSeconds = useMemo(
    () =>
      mastering.items.reduce((sum, i) => sum + (i.measured?.durationSeconds ?? 0) + i.gapAfter, 0),
    [mastering.items],
  );

  const overTarget = measurement ? measurement.integratedLufs - mastering.targetLufs : 0;
  const overCeiling = measurement ? measurement.truePeakDbtp > mastering.ceilingDbtp : false;

  /**
   * The release chain lives on the mastering document, not on a track, so it
   * supplies its own chain host rather than pretending to be a channel.
   */
  const releaseChain: ChainHost = {
    id: 'release',
    effects: mastering.effects ?? [],
    add: (kind) => {
      const id = newId('fx');
      let ok = false;
      update((m) => {
        m.effects ??= [];
        if (m.effects.length >= MAX_INSERTS) return;
        m.effects.push({ id, kind, bypass: false, params: defaultParams(kind) });
        ok = true;
      });
      return ok ? id : null;
    },
    remove: (id) => update((m) => void (m.effects = (m.effects ?? []).filter((e) => e.id !== id))),
    setParam: (id, key, value) =>
      update((m) => {
        const e = m.effects?.find((x) => x.id === id);
        if (!e) return;
        const spec = effectSpec(e.kind)?.params.find((pp) => pp.key === key);
        e.params[key] = spec ? Math.min(spec.max, Math.max(spec.min, value)) : value;
      }),
    setBypass: (id, bypass) =>
      update((m) => {
        const e = m.effects?.find((x) => x.id === id);
        if (e) e.bypass = bypass;
      }),
    move: (id, delta) =>
      update((m) => {
        const list = m.effects ?? [];
        const i = list.findIndex((e) => e.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
      }),
  };

  return (
    <div className="page mastering-page" data-testid="mastering-page">
      <header className="page-head">
        <button className="btn" onClick={() => go('song')} title="Back to the song">
          <Icon name="chevron-left" size={14} /> Song
        </button>
        <h1 className="t-heading">Release</h1>
        <span className="hint">
          {mastering.items.length} track{mastering.items.length === 1 ? '' : 's'} ·{' '}
          {formatClock(totalSeconds, false)}
        </span>
        <span className="grow" />
        <button className="btn primary" onClick={addCurrentSong} disabled={busy !== null}>
          <Icon name="plus" size={14} /> {busy ?? 'Add current song'}
        </button>
      </header>

      <div className="mastering-body">
        <section className="ms-list">
          <div className="ms-list-head">
            <span className="t-label">Order</span>
            <span className="grow" />
            <label className="ms-normalize">
              <input
                type="checkbox"
                checked={mastering.normalize === true}
                onChange={(e) => update((m) => void (m.normalize = e.target.checked))}
              />
              Normalise every track to target
            </label>
          </div>
          {mastering.items.length === 0 ? (
            <div className="empty-state">
              <Icon name="meter" size={30} className="es-icon" />
              <div className="es-title">Nothing in the release yet</div>
              <p className="es-body">
                “Add current song” renders the song page’s mix, measures it to BS.1770 and puts it
                in the running order.
              </p>
            </div>
          ) : (
            <ol className="ms-items" aria-label="Running order">
              {mastering.items.map((item, i) => {
                const m = item.measured;
                const diff = m ? m.integratedLufs - mastering.targetLufs : 0;
                return (
                  <li
                    key={item.id}
                    className={`ms-item${item.id === selectedId ? ' selected' : ''}`}
                    // Not role="option" — the row carries reorder and remove
                    // buttons, and an option may not contain interactive
                    // children.
                    tabIndex={0}
                    aria-current={item.id === selectedId || undefined}
                    onPointerDown={() => setSelectedId(item.id)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      setSelectedId(item.id);
                    }}
                    data-testid={`master-item-${i + 1}`}
                  >
                    <span className="ms-num">{i + 1}</span>
                    <span className="ms-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="ms-dur t-num">
                      {formatClock(m?.durationSeconds ?? 0, false)}
                    </span>
                    {/* Off-target and over-ceiling were signalled by hue alone:
                        the number reads the same, so a red/green deficiency or
                        a screen reader saw nothing wrong. */}
                    <span
                      className={`ms-lufs t-num${Math.abs(diff) > 1 ? ' off' : ''}`}
                      aria-label={
                        m
                          ? `${fmtLufs(m.integratedLufs)} LUFS${
                              Math.abs(diff) > 1
                                ? `, ${Math.abs(diff).toFixed(1)} LU ${diff > 0 ? 'above' : 'below'} the ${mastering.targetLufs} LUFS target`
                                : ''
                            }`
                          : 'not measured'
                      }
                    >
                      {Math.abs(diff) > 1 && m && <span aria-hidden="true">⚠ </span>}
                      {m ? `${fmtLufs(m.integratedLufs)} LUFS` : '—'}
                    </span>
                    <span
                      className={`ms-tp t-num${m && m.truePeakDbtp > mastering.ceilingDbtp ? ' over' : ''}`}
                      aria-label={
                        m
                          ? `${m.truePeakDbtp.toFixed(1)} dBTP${
                              m.truePeakDbtp > mastering.ceilingDbtp
                                ? `, over the ${mastering.ceilingDbtp} dBTP ceiling`
                                : ''
                            }`
                          : 'not measured'
                      }
                    >
                      {m && m.truePeakDbtp > mastering.ceilingDbtp && (
                        <span aria-hidden="true">⚠ </span>
                      )}
                      {m ? `${m.truePeakDbtp.toFixed(1)} dBTP` : '—'}
                    </span>
                    <span className="ms-actions">
                      <button
                        className="icon-btn"
                        aria-label={`Move ${item.name} up`}
                        disabled={i === 0}
                        onClick={() =>
                          update((ms) => {
                            const [x] = ms.items.splice(i, 1);
                            ms.items.splice(i - 1, 0, x);
                          })
                        }
                      >
                        <Icon name="arrow-up" size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Move ${item.name} down`}
                        disabled={i === mastering.items.length - 1}
                        onClick={() =>
                          update((ms) => {
                            const [x] = ms.items.splice(i, 1);
                            ms.items.splice(i + 1, 0, x);
                          })
                        }
                      >
                        <Icon name="arrow-down" size={13} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Remove ${item.name}`}
                        onClick={() =>
                          update((ms) => {
                            ms.items = ms.items.filter((x) => x.id !== item.id);
                          })
                        }
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <aside className="ms-side">
          <section>
            <h2 className="t-label">Delivery target</h2>
            <div className="ms-targets">
              {TARGETS.map((t) => (
                <button
                  key={t.label}
                  className={`ms-target${mastering.targetLufs === t.lufs ? ' on' : ''}`}
                  onClick={() =>
                    update((m) => {
                      m.targetLufs = t.lufs;
                      m.ceilingDbtp = t.ceiling;
                    })
                  }
                  title={t.blurb}
                >
                  <span className="mst-name">{t.label}</span>
                  <span className="mst-num t-num">
                    {t.lufs} LUFS · {t.ceiling} dBTP
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="t-label">Measured{selected ? ` — ${selected.name}` : ''}</h2>
            {!measurement ? (
              <p className="hint">Select a track to measure it.</p>
            ) : (
              <>
                <div className="ms-grid">
                  <MeasureCell
                    label="Integrated"
                    value={fmtLufs(measurement.integratedLufs)}
                    unit="LUFS"
                    warn={Math.abs(overTarget) > 1}
                  />
                  <MeasureCell
                    label="Range"
                    value={measurement.loudnessRangeLu.toFixed(1)}
                    unit="LU"
                  />
                  <MeasureCell
                    label="True peak"
                    value={measurement.truePeakDbtp.toFixed(1)}
                    unit="dBTP"
                    warn={overCeiling}
                  />
                  <MeasureCell
                    label="Sample peak"
                    value={measurement.samplePeakDbfs.toFixed(1)}
                    unit="dBFS"
                  />
                  <MeasureCell
                    label="Short-term max"
                    value={fmtLufs(measurement.shortTermMaxLufs)}
                    unit="LUFS"
                  />
                  <MeasureCell
                    label="Correlation"
                    value={measurement.correlation.toFixed(2)}
                    unit=""
                    warn={measurement.correlation < 0}
                  />
                </div>
                <p
                  className={`ms-verdict${Math.abs(overTarget) > 1 || overCeiling ? ' warn' : ' ok'}`}
                >
                  {overCeiling
                    ? `True peak is ${(measurement.truePeakDbtp - mastering.ceilingDbtp).toFixed(1)} dB over the ceiling — a lossy encoder will clip this.`
                    : Math.abs(overTarget) <= 1
                      ? 'Within 1 LU of target and under the ceiling.'
                      : `${Math.abs(overTarget).toFixed(1)} LU ${overTarget > 0 ? 'louder' : 'quieter'} than target.`}
                </p>
              </>
            )}
          </section>

          <section>
            <h2 className="t-label">Release chain</h2>
            <p className="hint">Applied to the whole release, ahead of the delivery limiter.</p>
            <InsertRack host={releaseChain} />
          </section>
        </aside>
      </div>
    </div>
  );
}
