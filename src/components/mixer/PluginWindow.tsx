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
import type { Effect } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { Icon } from '../common/Icon';
import { EffectVisual, FxKnob } from './PluginFace';
import { MotionWaveFaceLazy } from './MotionWaveFaceLazy';
import { isMotionWaveKind } from '../../audio/motionwave/registry';
import { channelRack, type RackHost } from './DeviceRack';
import { clampToViewport, placeWindow } from './windowPlace';
import type { Rect } from './windowPlace';

/**
 * Where a window opens when there is room for it there.
 *
 * Clear of the console on a desktop. On anything narrower `placeWindow` centres
 * it instead — this is a preference, not a position. See `windowPlace.ts`.
 */
const PREFERRED_POS = { x: 220, y: 120 };

/**
 * Where the user last put a device window, for the rest of this session.
 *
 * Module-level rather than component state, because the window unmounts between
 * devices: opening a second device used to place it back at the default, so a
 * musician working through a chain had to move it again for every insert. Once
 * they have moved one, that is where the next one belongs.
 *
 * Not persisted across reloads on purpose. A saved x/y is a promise about a
 * viewport that may not be the same one next time, and `clampToViewport` can
 * only rescue a position that is off the edge, not one that is now covering the
 * control the window was moved away from.
 */
let lastUserPos: { x: number; y: number } | null = null;

/**
 * Where a window opens: where the user last dragged one, or the default.
 *
 * Clamped either way — a remembered position on a smaller viewport is exactly
 * the case that would otherwise open a window off the screen with its own drag
 * handle out of reach.
 */
function placeOpening(
  box: Rect,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return lastUserPos
    ? clampToViewport(lastUserPos, box, viewport)
    : placeWindow(PREFERRED_POS, box, viewport);
}

/** How far the header must be thrown downward before a drag counts as a dismiss. */
const SWIPE_CLOSE_PX = 120;

/**
 * The A/B slots.
 *
 * Held outside the project on purpose: an A/B is a working comparison, not a
 * decision, and it should not dirty the song or land in undo. It survives as
 * long as the window is open, which is as long as the comparison is live.
 */
type Snapshot = Record<string, number>;

function EffectBody({ rack, effect }: { rack: RackHost; effect: Effect }) {
  /*
   * A Motion Wave unit brings its own panel.
   *
   * The generic body below is a grid of knobs built from a spec, which is the
   * right thing for a device whose only declaration is its parameters. These
   * units declare a *face* — artwork, meters and a visualiser, graded by U19,
   * U20, U22 and U23 — and rendering knobs instead would show the user none of
   * the half those cells are about.
   */
  if (isMotionWaveKind(effect.kind)) {
    return (
      <div className="pw-body pw-body-mw">
        <MotionWaveFaceLazy trackId={rack.id} effect={effect} />
      </div>
    );
  }
  const spec = effectSpec(effect.kind);
  const store = useProjectStore;
  const params = spec?.params ?? [];

  return (
    <div className="pw-body">
      <div className="pw-visual">
        <EffectVisual
          effect={effect}
          trackId={rack.id}
          onParam={(key, value) => rack.setParam(effect.id, key, value)}
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
            onChange={(v) => rack.setParam(effect.id, p.key, v)}
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
  // Resolved through `channelRack`, which knows the master channel is not a
  // member of `project.tracks`. Searching the track list here is why a device
  // on the master could be inserted and heard but never opened.
  const project = useProjectStore((s) => s.project);
  const rack = open ? channelRack(project, open.trackId) : null;
  const effect = rack?.effects.find((e) => e.id === open?.effectId);

  const [pos, setPos] = useState(PREFERRED_POS);
  const [ab, setAb] = useState<{ slot: 'a' | 'b'; a: Snapshot | null; b: Snapshot | null }>({
    slot: 'a',
    a: null,
    b: null,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  /** False until this device's window has been given its opening place. */
  const placed = useRef(false);

  const close = useCallback(() => useUiStore.getState().set({ openDevice: null }), []);

  /*
   * Escape closes the window rather than reaching the app behind it — a window
   * in front of the console owns the key while it is there.
   *
   * Unless something is in front of the *window*. This listens on `window` in
   * the capture phase and calls `stopPropagation`, which is what makes it win
   * against the app behind — and it was also winning against the menus above
   * it. A device's own options menu sits at `--z-menu` (800) over the window's
   * `--z-plugin` (300), so pressing Escape on an open menu closed the window
   * underneath and left the menu standing: measured, and it is why the next
   * press on that device's options button was intercepted by the menu that
   * should already have gone. `devicewindow.spec.ts` had been failing on it
   * for as long as anyone had looked, described as a target-size failure.
   *
   * Read from the store rather than from `e.target`, because a menu can be
   * open with focus anywhere — what decides ownership is which overlay is on
   * top, not where the keyboard happens to be.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const ui = useUiStore.getState();
      if (ui.contextMenu || ui.dialog) return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  /** The window's measured box, or its CSS minimum before it has been laid out. */
  const measure = useCallback((): Rect => {
    const el = panelRef.current;
    return { width: el?.offsetWidth || 320, height: el?.offsetHeight || 240 };
  }, []);

  /**
   * Swipe the header down to dismiss, on touch.
   *
   * The header is already the drag handle, so this rides on the same gesture
   * rather than adding a second one: drag it and the window moves, throw it
   * downward and it closes. `SWIPE_CLOSE_PX` is far enough that repositioning a
   * window low on the screen does not dismiss it by accident.
   */
  const swipe = useRef({ dy: 0, touch: false });

  const onHeaderDown = usePointerDrag<{ x: number; y: number }>({
    onStart: (e) => {
      swipe.current = { dy: 0, touch: e.pointerType === 'touch' };
      return pos;
    },
    onEnd: () => {
      if (swipe.current.touch && swipe.current.dy > SWIPE_CLOSE_PX) close();
    },
    onMove: (dx, dy, _e, start) => {
      swipe.current.dy = dy;
      // Kept inside the viewport: a plugin dragged off the edge is a plugin
      // that has to be found again with the keyboard. Clamped against the
      // window's real width — the old constant 220 was neither the window's
      // width nor related to it, so a wide device could still be dragged out.
      //
      // There was a bare `return` above this comment. The handler had been a
      // concise arrow whose body *was* this call, and turning it into a block
      // to add the swipe line above kept the `return` and left it on its own
      // line — so automatic semicolon insertion ended the statement there and
      // everything below became dead. The window stopped moving on every
      // pointer type at once, and nothing said so: `tsc` greys unreachable code
      // by default rather than failing, and typescript-eslint defers
      // `no-unreachable` to the compiler. `allowUnreachableCode: false` is now
      // set in every tsconfig, and it fails this file if the `return` returns.
      const next = clampToViewport({ x: start.x + dx, y: start.y + dy }, measure(), {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      lastUserPos = next;
      setPos(next);
    },
  });

  // Place on open, and re-place whenever the viewport changes underneath it.
  // Rotating a phone otherwise leaves a correctly-placed window off-screen,
  // and there is no way back to it because the drag handle went with it.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      setPos((current) =>
        placed.current
          ? clampToViewport(current, measure(), viewport)
          : placeOpening(measure(), viewport),
      );
      placed.current = true;
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('orientationchange', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('orientationchange', place);
    };
  }, [open, measure]);

  // A different device re-places the window — unless the user has moved one,
  // in which case `placeOpening` below honours where they put it.
  useEffect(() => {
    placed.current = false;
  }, [open?.trackId, open?.effectId]);

  const presets = useMemo(() => (effect ? presetsFor(effect.kind) : []), [effect]);

  if (!open || !rack || !effect) return null;
  const spec = effectSpec(effect.kind);
  const name = spec?.label ?? effect.kind;
  const store = useProjectStore.getState();

  const snapshot = (): Snapshot => ({ ...effect.params });
  const restore = (snap: Snapshot) => {
    store.beginGesture();
    for (const [k, v] of Object.entries(snap)) rack.setParam(effect.id, k, v);
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
      aria-label={`${name} on ${rack.name}`}
      data-testid="plugin-window"
    >
      <header className="pw-head" onPointerDown={onHeaderDown}>
        <button
          className="pw-power"
          aria-label={`${effect.bypass ? 'Enable' : 'Bypass'} ${name}`}
          aria-pressed={!effect.bypass}
          title={effect.bypass ? 'Bypassed' : 'Active'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => rack.setBypass(effect.id, !effect.bypass)}
        />
        <div className="pw-title">
          <span className="pw-name">{name}</span>
          <span className="pw-on">{rack.name}</span>
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
                rack.setParam(effect.id, k, v);
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

      <EffectBody rack={rack} effect={effect} />

      <footer className="pw-foot">
        <span className="pw-summary" title={describeEffect(effect)}>
          {describeEffect(effect)}
        </span>
        <span className="grow" />
        <span className="pw-slot">
          {rack.effects.findIndex((e) => e.id === effect.id) + 1} of {rack.effects.length} · max{' '}
          {MAX_INSERTS}
        </span>
      </footer>
    </div>
  );
}

/** Exported for the tests that check a readout without opening a window. */
export { formatParam };
