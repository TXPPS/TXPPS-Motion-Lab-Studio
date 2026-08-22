/**
 * Pool — every media item this project owns.
 *
 * A session accumulates takes, imports and renders, and after a week nobody
 * remembers which ones anything still uses. The pool answers that: what is
 * here, how big it is, how many clips reference it, and what can safely go.
 */
import { useMemo, useState } from 'react';
import { pickAndImport } from '../../app/importActions';
import { pickMidiFile } from '../../app/midiFileActions';
import { cacheStats } from '../../audio/mediaLibrary';
import type { MediaRef } from '../../model/media';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { AuditionButton, matches } from './browserShared';

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return 'generated';
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function PoolTab({ query }: { query: string }) {
  const project = useProjectStore((s) => s.project);
  const [sort, setSort] = useState<'name' | 'size' | 'uses'>('name');

  const rows = useMemo(() => {
    const uses = new Map<string, number>();
    for (const c of project.clips) {
      if (c.type !== 'audio') continue;
      uses.set(c.mediaId, (uses.get(c.mediaId) ?? 0) + 1);
      for (const t of c.takes ?? []) uses.set(t.mediaId, (uses.get(t.mediaId) ?? 0) + 1);
    }
    // A frozen track's print is used by the track, not by a clip. Counting
    // only clips would list it as unused and offer to remove the audio the
    // track is playing.
    for (const t of project.tracks) {
      if (t.freeze) uses.set(t.freeze.mediaId, (uses.get(t.freeze.mediaId) ?? 0) + 1);
    }
    const list = (project.media ?? [])
      .filter((m) => matches(query, `${m.name} ${m.source}`))
      .map((m) => ({ media: m, uses: uses.get(m.id) ?? 0 }));
    list.sort((a, b) =>
      sort === 'size'
        ? b.media.byteSize - a.media.byteSize
        : sort === 'uses'
          ? b.uses - a.uses
          : a.media.name.localeCompare(b.media.name),
    );
    return list;
  }, [project.media, project.clips, project.tracks, query, sort]);

  const unused = rows.filter((r) => r.uses === 0);
  const totalBytes = rows.reduce((n, r) => n + r.media.byteSize, 0);
  const cache = cacheStats();

  const rename = (m: MediaRef) =>
    useUiStore.getState().showDialog({
      kind: 'prompt',
      title: 'Rename media',
      initialValue: m.name,
      onSubmit: (v) =>
        v &&
        useProjectStore.getState().update((d) => {
          const ref = d.media?.find((x) => x.id === m.id);
          if (ref) ref.name = v.slice(0, 120);
        }),
    });

  return (
    <div className="browser-list">
      <div className="pool-head">
        <button className="btn" onClick={() => pickAndImport({})} data-testid="pool-import">
          <Icon name="upload" size={13} /> Import audio
        </button>
        <button className="btn" onClick={() => pickMidiFile()}>
          <Icon name="file-midi" size={13} /> Import MIDI
        </button>
      </div>

      <div className="pool-stats">
        <span>
          {rows.length} item{rows.length === 1 ? '' : 's'} · {sizeLabel(totalBytes)}
        </span>
        <span>
          {cache.buffers} decoded · {cache.missing} missing
        </span>
      </div>

      <div className="seg pool-sort" role="group" aria-label="Sort the pool">
        {(['name', 'size', 'uses'] as const).map((s) => (
          <button
            key={s}
            className={sort === s ? 'on' : ''}
            aria-pressed={sort === s}
            onClick={() => setSort(s)}
          >
            {s === 'name' ? 'Name' : s === 'size' ? 'Size' : 'Used'}
          </button>
        ))}
      </div>

      {rows.length === 0 && (
        <div className="empty-state">
          <Icon name="database" size={26} className="es-icon" />
          <div className="es-title">Nothing recorded or imported yet</div>
          <p className="es-body">
            Recordings, imports and renders land here. Procedural demo content is generated at play
            time and never stored.
          </p>
        </div>
      )}

      {rows.map(({ media, uses }) => (
        <div
          key={media.id}
          className={`li${uses === 0 ? ' unused' : ''}`}
          data-testid={`pool-${media.name}`}
        >
          <span className="li-icon">
            <Icon
              name={
                media.kind === 'recording'
                  ? 'mic'
                  : media.kind === 'freeze'
                    ? 'freeze'
                    : 'file-audio'
              }
              size={14}
            />
          </span>
          <span className="li-main">
            <span className="li-title">{media.name}</span>
            <span className="li-sub">
              {media.duration.toFixed(1)}s · {media.channels}ch @{' '}
              {(media.sampleRate / 1000).toFixed(1)}k · {sizeLabel(media.byteSize)} ·{' '}
              {uses === 0
                ? 'unused'
                : media.kind === 'freeze'
                  ? 'frozen track'
                  : `${uses} clip${uses === 1 ? '' : 's'}`}
            </span>
          </span>
          <span className="li-actions">
            <AuditionButton mediaId={media.id} name={media.name} />
            <button
              className="icon-btn"
              aria-label={`Rename ${media.name}`}
              title="Rename"
              onClick={() => rename(media)}
            >
              <Icon name="pencil" size={13} />
            </button>
          </span>
        </div>
      ))}

      {unused.length > 0 && (
        <button
          className="btn danger full"
          data-testid="pool-cleanup"
          onClick={() =>
            useUiStore.getState().showDialog({
              kind: 'confirm',
              title: `Remove ${unused.length} unused item${unused.length === 1 ? '' : 's'}?`,
              message:
                'Their audio stays on disk until the next cleanup, but the project stops referencing them. This cannot be undone from the pool.',
              confirmLabel: 'Remove',
              danger: true,
              onSubmit: () =>
                useProjectStore.getState().update((d) => {
                  const drop = new Set(unused.map((u) => u.media.id));
                  d.media = (d.media ?? []).filter((m) => !drop.has(m.id));
                }),
            })
          }
        >
          Remove {unused.length} unused item{unused.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}
