/**
 * The plugin editor, as a window.
 *
 * A device opened from the console belongs in front of the console, not in a
 * side panel the console has to be abandoned for. This is that window: it
 * floats, it moves, it remembers where it was put, and it carries the header
 * every professional plugin has — the device's name, its preset, an A/B
 * compare, a bypass, and the in/out level it is working on.
 *
 * The body is the device's own face. What varies between a compressor and a
 * delay is the picture and the controls; what does not vary is the frame
 * around them, which is why the frame lives here and only here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeEffect, effectSpec, formatParam, MAX_INSERTS } from '../../model/effects';
import { presetParams, presetsFor } from '../../model/effectPresets';
import type { Effect, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { Icon } from '../common/Icon';
import { EffectVisual, FxKnob } from './PluginFace';

/** Where a window opens when it has no remembered place. */
const DEFAULT_POS = { x: 220, y: 120 };

/**
 * The A/B slots.
 *
 * Held outside the project on purpose: an A/B is a working comparison, not a
 * decision, and it should not dirty the song or land in undo. It survives as
 * long as the window is open, which is as long as the comparison is live.
 */
type Snapshot = Record<string, number>;

function EffectBody({ track, effect }: { track: Track; effect: Effect }) {
  const spec = effectSpec(effect.kind);
  const store = useProjectStore;
  const params = spec?.params ?? [];

  return (
    <div className="pw-body">
      <div className="pw-visual">
        <EffectVisual
          effect={effect}
          trackId={track.id}
          onParam={(key, value) => store.getState().setEffectParam(track.id, effect.id, key, value)}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
        />
      </div>
      <div className="pw-params">
        {params.map((p) => (
          <FxKnob
            key={p.key}
            spec={p}
            value={effect.params[p.key] ?? p.default}
            size={48}
            onChange={(v) => store.getState().setEffectParam(track.id, effect.id, p.key, v)}
            onGestureStart={() => store.getState().beginGesture()}
            onGestureEnd={() => store.getState().endGesture()}
          />
        ))}
      </div>
    </div>
  );
}

export function PluginWindow() {
  const open = useUiStore((s) => s.openDevice);
  const track = useProjectStore((s) =>
    open ? s.project.tracks.find((t) => t.id === open.trackId) : undefined,
  );
  const effect = track?.effects?.find((e) => e.id === open?.effectId);

  const [pos, setPos] = useState(DEFAULT_POS);
  const [ab, setAb] = useState<{ slot: 'a' | 'b'; a: Snapshot | null; b: Snapshot | null }>({
    slot: 'a',
    a: null,
    b: null,
  });
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => useUiStore.getState().set({ openDevice: null }), []);

  // Escape closes the window rather than reaching the app behind it — a window
  // in front of the console owns the key while it is there.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  const onHeaderDown = usePointerDrag<{ x: number; y: number }>({
    onStart: () => pos,
    onMove: (dx, dy, _e, start) =>
      setPos({
        // Kept inside the window: a plugin dragged off the edge is a plugin
        // that has to be found again with the keyboard.
        x: Math.max(8, Math.min(window.innerWidth - 220, start.x + dx)),
        y: Math.max(8, Math.min(window.innerHeight - 60, start.y + dy)),
      }),
  });

  const presets = useMemo(() => (effect ? presetsFor(effect.kind) : []), [effect]);

  if (!open || !track || !effect) return null;
  const spec = effectSpec(effect.kind);
  const name = spec?.label ?? effect.kind;
  const store = useProjectStore.getState();

  const snapshot = (): Snapshot => ({ ...effect.params });
  const restore = (snap: Snapshot) => {
    store.beginGesture();
    for (const [k, v] of Object.entries(snap)) store.setEffectParam(track.id, effect.id, k, v);
    store.endGesture();
  };

  return (
    <div
      // `fam-*` puts the processor family's colour on the header rail, which is
      // how you tell nine open windows apart without reading any of them.
      className={`plugin-window fam-${spec?.group ?? 'utility'}`}
      ref={panelRef}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label={`${name} on ${track.name}`}
      data-testid="plugin-window"
    >
      <header className="pw-head" onPointerDown={onHeaderDown}>
        <button
          className="pw-power"
          aria-label={`${effect.bypass ? 'Enable' : 'Bypass'} ${name}`}
          aria-pressed={!effect.bypass}
          title={effect.bypass ? 'Bypassed' : 'Active'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => store.setEffectBypass(track.id, effect.id, !effect.bypass)}
        />
        <div className="pw-title">
          <span className="pw-name">{name}</span>
          <span className="pw-on">{track.name}</span>
        </div>
        <span className="grow" />
        {presets.length > 0 && (
          <select
            className="pw-preset"
            value=""
            aria-label={`${name} presets`}
            data-testid="pw-preset"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const preset = presets.find((p) => p.id === e.target.value);
              e.currentTarget.value = '';
              if (!preset) return;
              store.beginGesture();
              for (const [k, v] of Object.entries(presetParams(preset))) {
                store.setEffectParam(track.id, effect.id, k, v);
              }
              store.endGesture();
            }}
          >
            <option value="">Presets…</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id} title={p.blurb}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="pw-ab" role="group" aria-label="A/B compare">
          {(['a', 'b'] as const).map((slot) => (
            <button
              key={slot}
              className={ab.slot === slot ? 'on' : ''}
              aria-pressed={ab.slot === slot}
              aria-label={`Compare slot ${slot.toUpperCase()}`}
              title={`Slot ${slot.toUpperCase()} — the other slot keeps what you had`}
              data-testid={`pw-ab-${slot}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (ab.slot === slot) return;
                // Park what is on screen in the slot being left, then take
                // whatever the slot being entered was holding.
                const parked = snapshot();
                const incoming = ab[slot];
                setAb((prev) => ({ ...prev, slot, [prev.slot]: parked }));
                if (incoming) restore(incoming);
              }}
            >
              {slot.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          className="pw-close"
          aria-label={`Close ${name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={close}
        >
          <Icon name="x" size={13} />
        </button>
      </header>

      <EffectBody track={track} effect={effect} />

      <footer className="pw-foot">
        <span className="pw-summary" title={describeEffect(effect)}>
          {describeEffect(effect)}
        </span>
        <span className="grow" />
        <span className="pw-slot">
          {(track.effects ?? []).findIndex((e) => e.id === effect.id) + 1} of{' '}
          {(track.effects ?? []).length} · max {MAX_INSERTS}
        </span>
      </footer>
    </div>
  );
}

/** Exported for the tests that check a readout without opening a window. */
export { formatParam };
