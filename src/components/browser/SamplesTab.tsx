/**
 * Browser → Samples: every sample source in one searchable list — procedural
 * one-shots and loops plus the project's imported files and recordings — with
 * favorites, recents, preview, waveform thumbnails and drag-out. Rows drag as
 * `text/x-ml-media`, which sampler drop targets (pads, quick-sampler drop
 * zone) accept; tapping a row loads it into the target instrument's sampler.
 */
import { useMemo, useState } from 'react';
import { listHitMedia, listMedia } from '../../audio/demoAudio';
import { buildQuickSampler, DRUM_PAD_BASE } from '../../model/sampler';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Waveform } from '../arrangement/Waveform';
import { useSynthTarget } from '../synth/SynthPanel';
import { AuditionButton, matches } from './browserShared';

const FAVS_KEY = 'txpps-motionlab-sample-favs-v1';
const RECENT_KEY = 'txpps-motionlab-sample-recent-v1';
/** Above this many rows, waveform thumbnails are skipped to keep the list cheap. */
const THUMB_LIMIT = 200;

function readIds(key: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: string[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(ids.slice(0, 60)));
  } catch {
    /* storage full or blocked — favorites just don't persist */
  }
}

interface SampleItem {
  id: string;
  name: string;
  sub: string;
  kind: 'one-shot' | 'loop' | 'imported' | 'recording';
  seconds: number;
}

type Cat = 'all' | 'one-shots' | 'loops' | 'project' | 'favorites' | 'recent';
const CATS: Cat[] = ['all', 'one-shots', 'loops', 'project', 'favorites', 'recent'];

export function SamplesTab({ query }: { query: string }) {
  const media = useProjectStore((s) => s.project.media);
  const target = useSynthTarget();
  const [cat, setCat] = useState<Cat>('all');
  const [favs, setFavs] = useState<string[]>(() => readIds(FAVS_KEY));
  const [recent, setRecent] = useState<string[]>(() => readIds(RECENT_KEY));

  const items = useMemo<SampleItem[]>(() => {
    const project: SampleItem[] = (media ?? [])
      // A frozen track's print is not a sample: it belongs to that track, and
      // dropping it into a sampler would be a copy nobody asked for.
      .filter((m) => m.kind !== 'procedural' && m.kind !== 'freeze')
      .map((m) => ({
        id: m.id,
        name: m.name,
        sub: `${m.kind === 'recording' ? 'Recording' : 'Imported'} · ${m.duration.toFixed(1)}s · ${
          m.channels === 1 ? 'mono' : `${m.channels}ch`
        } @ ${(m.sampleRate / 1000).toFixed(1)}k`,
        kind: m.kind === 'recording' ? 'recording' : 'imported',
        seconds: m.duration,
      }));
    const hits: SampleItem[] = listHitMedia().map((h) => ({
      id: h.id,
      name: h.name,
      sub: `One-shot · ${h.seconds.toFixed(2)}s · drums`,
      kind: 'one-shot',
      seconds: h.seconds,
    }));
    const loops: SampleItem[] = listMedia().map((m) => ({
      id: m.id,
      name: m.name,
      sub: `Loop · ${m.bars} bars · ${m.seconds.toFixed(1)}s`,
      kind: 'loop',
      seconds: m.seconds,
    }));
    return [...project, ...hits, ...loops];
  }, [media]);

  const shown = useMemo(() => {
    const inCat = (it: SampleItem) =>
      cat === 'all'
        ? true
        : cat === 'one-shots'
          ? it.kind === 'one-shot'
          : cat === 'loops'
            ? it.kind === 'loop'
            : cat === 'project'
              ? it.kind === 'imported' || it.kind === 'recording'
              : cat === 'favorites'
                ? favs.includes(it.id)
                : recent.includes(it.id);
    const list = items.filter((it) => inCat(it) && matches(query, it.name, it.sub, it.kind));
    if (cat === 'recent') {
      list.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    }
    return list;
  }, [items, cat, query, favs, recent]);

  const markRecent = (id: string) => {
    setRecent((r) => {
      const next = [id, ...r.filter((x) => x !== id)].slice(0, 24);
      writeIds(RECENT_KEY, next);
      return next;
    });
  };
  const toggleFav = (id: string) => {
    setFavs((f) => {
      const next = f.includes(id) ? f.filter((x) => x !== id) : [id, ...f];
      writeIds(FAVS_KEY, next);
      return next;
    });
  };

  /** Tap: load into the target instrument — first free drum pad, or the quick sampler. */
  const loadToTarget = (it: SampleItem) => {
    const toast = useUiStore.getState().toast;
    if (!target) {
      toast('error', 'Add or select an instrument track first.');
      return;
    }
    const s = useProjectStore.getState();
    if (target.sampler?.view === 'drum') {
      const used = new Set(
        target.sampler.zones.filter((z) => z.keyLo === z.keyHi).map((z) => z.keyLo - DRUM_PAD_BASE),
      );
      let idx = 0;
      while (used.has(idx) && idx < 63) idx++;
      s.assignPad(target.id, idx, it.id, it.name);
      toast('info', `"${it.name}" → pad ${idx + 1} on ${target.name}`);
    } else {
      s.applySamplerPreset(target.id, buildQuickSampler(it.id, it.name));
      toast('info', `"${it.name}" loaded into Quick Sampler on ${target.name}`);
    }
    markRecent(it.id);
  };

  const thumbs = shown.length <= THUMB_LIMIT;
  return (
    <>
      <div className="panel-section chip-row" data-testid="sample-cats">
        {CATS.map((c) => (
          <button
            key={c}
            className={`chip${cat === c ? ' on' : ''}`}
            onClick={() => setCat(c)}
            data-testid={`sample-cat-${c}`}
          >
            {c === 'favorites' ? `★ ${favs.length}` : c}
          </button>
        ))}
      </div>
      <div className="panel-section hint">
        {target
          ? `Tap to load into ${target.name}; drag onto pads, zones or the sampler drop area.`
          : 'Add an instrument track to load samples into it.'}
      </div>
      {shown.length === 0 && (
        <div className="panel-section hint" data-testid="samples-empty">
          {cat === 'favorites'
            ? 'No favorites yet — star a sample to keep it here.'
            : cat === 'recent'
              ? 'Nothing used recently.'
              : `No samples match${query ? ` “${query}”` : ''}.`}
        </div>
      )}
      {shown.map((it) => (
        <div
          key={it.id}
          className="list-item sample-row"
          draggable
          data-testid={`sample-item-${it.id}`}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/x-ml-media', it.id);
            e.dataTransfer.effectAllowed = 'copy';
            markRecent(it.id);
          }}
          onClick={() => loadToTarget(it)}
        >
          {thumbs && (
            <span className="sample-thumb" aria-hidden="true">
              <Waveform
                mediaId={it.id}
                offsetSec={0}
                durationSec={it.seconds}
                color="#37b89a"
                gain={1}
                fadeIn={0}
                fadeOut={0}
                widthPx={56}
                heightPx={22}
              />
            </span>
          )}
          <button
            className="li-main"
            onClick={(e) => {
              e.stopPropagation();
              loadToTarget(it);
            }}
          >
            <div className="li-title">{it.name}</div>
            <div className="li-sub">{it.sub}</div>
          </button>
          <span className="li-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className={`icon-btn star${favs.includes(it.id) ? ' on' : ''}`}
              title={favs.includes(it.id) ? 'Remove favorite' : 'Favorite'}
              aria-label={`${favs.includes(it.id) ? 'Unfavorite' : 'Favorite'} ${it.name}`}
              aria-pressed={favs.includes(it.id)}
              data-testid={`fav-${it.id}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFav(it.id);
              }}
            >
              ★
            </button>
            <AuditionButton mediaId={it.id} name={it.name} onPlay={() => markRecent(it.id)} />
          </span>
        </div>
      ))}
    </>
  );
}
