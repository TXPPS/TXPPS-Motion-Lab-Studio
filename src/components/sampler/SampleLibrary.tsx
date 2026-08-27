/**
 * The sampler's library: what is loaded, and everything you can do to the set.
 *
 * Loading *one* sample was solved. Managing a set was not — there was no rename,
 * no reorder, and for a quick sampler no list at all, so the only way to find
 * out what was in it was to play it. "See what is loaded" is the first thing a
 * sampler owes you and it was the thing missing.
 *
 * Order is not cosmetic here, which is why reorder is a first-class control
 * rather than a nicety: `matchZones` returns *every* zone whose key and velocity
 * ranges contain the note, and overlapping zones are summed in list order — so
 * which one comes first is which one a key crossfade tapers from.
 *
 * The row wraps rather than scrolls sideways, and every control in it is sized
 * from `--control-h`. That is the same discipline `.zone-row` records: a target
 * that needs 44pt on a coarse pointer grows the row it is in, because a target
 * grown past its row is a target pointing at whatever is underneath.
 */
import { useEffect, useState } from 'react';
import type { SampleZone } from '../../model/sampler';
import { useProjectStore } from '../../state/projectStore';
import { SampleSourceButton } from './SampleSource';

/** One row. Kept out of the map so the rename input can hold its own draft. */
function LibraryRow({
  trackId,
  zone,
  index,
  total,
  onPreview,
}: {
  trackId: string;
  zone: SampleZone;
  index: number;
  total: number;
  onPreview: (zone: SampleZone) => void;
}) {
  const store = useProjectStore;
  const [draft, setDraft] = useState(zone.name);

  // A rename committed elsewhere — an undo, a preset load, another view — has
  // to reach the field. Without this the input keeps showing what was typed
  // into it and the panel disagrees with the project it is editing.
  useEffect(() => setDraft(zone.name), [zone.name]);

  const commit = () => {
    const name = draft.trim();
    if (name && name !== zone.name) store.getState().renameSamplerZone(trackId, zone.id, name);
    else setDraft(zone.name);
  };

  return (
    <div className="smp-lib-row" data-testid="library-row" data-zone={zone.id}>
      <button
        className="th-mini smp-lib-move"
        data-testid={`library-up-${zone.id}`}
        disabled={index === 0}
        aria-label={`Move ${zone.name} earlier`}
        title="Earlier in the chain — overlapping zones sum in this order"
        onClick={() => store.getState().moveSamplerZone(trackId, zone.id, -1)}
      >
        ▲
      </button>
      <button
        className="th-mini smp-lib-move"
        data-testid={`library-down-${zone.id}`}
        disabled={index === total - 1}
        aria-label={`Move ${zone.name} later`}
        title="Later in the chain"
        onClick={() => store.getState().moveSamplerZone(trackId, zone.id, 1)}
      >
        ▼
      </button>

      <input
        className="smp-lib-name"
        data-testid={`library-name-${zone.id}`}
        aria-label={`Name of ${zone.name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(zone.name);
            e.currentTarget.blur();
          }
        }}
      />

      <button
        className="th-mini"
        data-testid={`library-preview-${zone.id}`}
        aria-label={`Play ${zone.name}`}
        title="Play it"
        onClick={() => onPreview(zone)}
      >
        ▶
      </button>
      <SampleSourceButton
        trackId={trackId}
        dest={{ kind: 'replace', zoneId: zone.id }}
        label="Replace"
        testId={`library-replace-${zone.id}`}
      />
      <button
        className="th-mini"
        data-testid={`library-remove-${zone.id}`}
        aria-label={`Remove ${zone.name}`}
        title="Remove it from the instrument"
        onClick={() => store.getState().removeSamplerZones(trackId, [zone.id])}
      >
        ×
      </button>
    </div>
  );
}

export function SampleLibrary({
  trackId,
  zones,
  onPreview,
  addLabel = 'Add sample',
  addDest = 'zone',
}: {
  trackId: string;
  zones: SampleZone[];
  onPreview: (zone: SampleZone) => void;
  addLabel?: string;
  /** `zone` makes a new layer; `quick` replaces the single loaded sample. */
  addDest?: 'zone' | 'quick';
}) {
  return (
    <div className="smp-lib" data-testid="sample-library">
      {zones.length === 0 ? (
        // Said, not left blank. An empty library that renders nothing is
        // indistinguishable from a library that has not loaded yet, and this
        // instrument makes no sound until something is in it.
        <div className="hint" data-testid="library-empty">
          Nothing loaded. This instrument plays what is in this list, and there is nothing in it
          yet.
        </div>
      ) : (
        zones.map((z, i) => (
          <LibraryRow
            key={z.id}
            trackId={trackId}
            zone={z}
            index={i}
            total={zones.length}
            onPreview={onPreview}
          />
        ))
      )}
      <div className="smp-lib-foot">
        <SampleSourceButton
          trackId={trackId}
          dest={addDest === 'quick' ? { kind: 'quick' } : { kind: 'zone' }}
          label={addLabel}
          testId="library-add"
          primary
        />
        <span className="t-label">
          {zones.length} sample{zones.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
