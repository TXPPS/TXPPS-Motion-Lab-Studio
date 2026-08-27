/**
 * The console's device rack.
 *
 * Every professional console strip carries its whole insert chain, in signal
 * order, on the strip itself: you see what is on the channel, you see what
 * order it is in, and you add, open, bypass, reorder and remove without
 * leaving the console. Ours showed the first four devices as read-only chips
 * that navigated to a side panel, which is a summary of a chain rather than a
 * chain.
 *
 * Signal flows top to bottom. On an instrument channel the instrument sits
 * above the inserts, because that is where it is in the signal path.
 */
import { useRef, useState } from 'react';
import {
  EFFECT_GROUPS,
  EFFECT_GROUP_LABELS,
  MAX_INSERTS,
  describeEffect,
  effectSpec,
  effectsInGroup,
  formatParam,
  microParams,
  type ParamSpec,
} from '../../model/effects';
import { CHAIN_PRESETS } from '../../model/effectPresets';
import { applyChainSteps, type ChainStepLike } from '../../app/chainActions';
import { useChainStore } from '../../state/chainStore';
import { saveChainFrom } from './InsertRack';
import { MASTER_ID } from '../../model/types';
import type { Effect, EffectKind, ProjectData, Track } from '../../model/types';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { useTapOrDouble } from '../../hooks/useTapOrDouble';
import { useProjectStore } from '../../state/projectStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { NoteFxSlots, type NoteFxHost } from './NoteFxSlots';
import { SHELF, addShelfPlugin } from '../../audio/wam/shelf';

/**
 * One channel's device chain, whatever kind of channel it is.
 *
 * The master's chain lives on the project rather than on a track, so the rack
 * takes this rather than a Track — otherwise the master gets a second, worse
 * copy of the same component, which is exactly what it had.
 */
export interface RackHost {
  /** Channel id: a track id, or 'master'. Also the drag identity. */
  id: string;
  name: string;
  effects: Effect[];
  /** The instrument above the inserts, on channels that play notes. */
  instrument?: { label: string; frozen: boolean; open: () => void };
  /**
   * The MIDI chain above the instrument, on channels that play notes.
   *
   * Optional because a bus, an FX return and the master do not receive notes —
   * and a rack that showed an empty "MIDI FX" header on an audio bus would be
   * teaching the wrong signal path.
   */
  noteFx?: NoteFxHost;
  add: (kind: EffectKind) => string | null;
  remove: (effectId: string) => void;
  setParam: (effectId: string, key: string, value: number) => void;
  setBypass: (effectId: string, bypass: boolean) => void;
  move: (effectId: string, delta: number) => void;
  reorder: (effectId: string, toIndex: number) => void;
}

/** A track's own chain. */
export function trackRack(track: Track): RackHost {
  const store = useProjectStore;
  const playsNotes = track.type === 'instrument' || track.type === 'drum';
  return {
    id: track.id,
    name: track.name,
    effects: track.effects ?? [],
    instrument: playsNotes
      ? {
          label: track.rack
            ? 'Instrument Rack'
            : track.sampler
              ? 'Sampler'
              : (track.synth?.presetName ?? 'MotionSynth'),
          frozen: !!track.freeze,
          open: () => {
            useUiStore.getState().selectTrack(track.id);
            useWorkspaceStore.getState().reveal('editor');
            useUiStore.getState().set({ editorTab: 'synth' });
          },
        }
      : undefined,
    noteFx: playsNotes
      ? {
          list: track.noteFx ?? [],
          add: (kind) => store.getState().addNoteFx(track.id, kind),
          setBypass: (id, bypass) => store.getState().setNoteFxBypass(track.id, id, bypass),
          remove: (id) => store.getState().removeNoteFx(track.id, id),
          open: () => {
            useUiStore.getState().selectTrack(track.id);
            useWorkspaceStore.getState().reveal('inspector');
            useUiStore.getState().set({ phoneMode: 'browse' });
          },
        }
      : undefined,
    add: (kind) => store.getState().addEffect(track.id, kind),
    remove: (id) => store.getState().removeEffect(track.id, id),
    setParam: (id, key, v) => store.getState().setEffectParam(track.id, id, key, v),
    setBypass: (id, bypass) => store.getState().setEffectBypass(track.id, id, bypass),
    move: (id, delta) => store.getState().moveEffect(track.id, id, delta),
    reorder: (id, to) => store.getState().reorderEffect(track.id, id, to),
  };
}

/** The master channel's chain. */
export function masterRack(effects: Effect[]): RackHost {
  const store = useProjectStore;
  return {
    id: 'master',
    name: 'Master',
    effects,
    add: (kind) => store.getState().addMasterEffect(kind),
    remove: (id) => store.getState().removeMasterEffect(id),
    setParam: (id, key, v) => store.getState().setMasterEffectParam(id, key, v),
    setBypass: (id, bypass) => store.getState().setMasterEffectBypass(id, bypass),
    move: (id, delta) => store.getState().moveMasterEffect(id, delta),
    reorder: (id, to) => store.getState().reorderMasterEffect(id, to),
  };
}

/**
 * The rack for any channel id, master included.
 *
 * The master channel is not a member of `project.tracks` — it is
 * `project.master` — so anything that resolved a channel by searching the track
 * list found nothing for `'master'` and did nothing about it. That is why a
 * device on the master could be inserted and heard but never opened: the editor
 * looked the channel up that way, got `undefined`, and returned `null` rather
 * than a window.
 *
 * One resolver rather than a conditional at each call site, because the whole
 * point of `RackHost` is that a caller should not have to know which kind of
 * channel it is holding.
 */
export function channelRack(project: ProjectData, channelId: string): RackHost | null {
  if (channelId === MASTER_ID) return masterRack(project.master?.effects ?? []);
  const track = project.tracks.find((t) => t.id === channelId);
  return track ? trackRack(track) : null;
}

/** What a drag is carrying: a device, and the channel it came from. */
const DEVICE_MIME = 'application/x-motionlab-device';

interface DragPayload {
  trackId: string;
  effectId: string;
}

function readDrag(e: React.DragEvent): DragPayload | null {
  const raw = e.dataTransfer.getData(DEVICE_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { trackId, effectId } = parsed as Record<string, unknown>;
    if (typeof trackId !== 'string' || typeof effectId !== 'string') return null;
    return { trackId, effectId };
  } catch {
    return null;
  }
}

/**
 * What `deviceMenu` needs from whoever is holding the chain.
 *
 * Deliberately narrower than `RackHost`, so the inspector's `ChainHost` can
 * satisfy it too. The mixer offered these options behind a caret and the
 * inspector offered a subset as inline buttons behind a disclosure — the same
 * job, two different answers depending on which surface the user happened to
 * be on, which is what "some devices have no options" turned out to mean.
 */
export interface DeviceMenuHost {
  id: string;
  name: string;
  setBypass: (effectId: string, bypass: boolean) => void;
  move: (effectId: string, delta: number) => void;
  remove: (effectId: string) => void;
}

/**
 * The device's own disclosure, so the menu can offer it too.
 *
 * Both racks put a device's parameters behind a press on something small — the
 * console's 12px name, the inspector's title row — and neither had a menu
 * entry for it. That is the one command the options menu did not carry, and
 * under WCAG 2.5.8 an inline control is only exempt from the target minimum
 * while an equivalent one is not: a disclosure with no equivalent made the
 * name a 12px target with no alternative rather than a shortcut to one.
 */
export interface DeviceDisclosure {
  shown: boolean;
  toggle: () => void;
}

/**
 * Every command a device offers, wherever it is being offered from.
 *
 * Split out from `deviceMenu` so it can be *read* rather than only shown.
 * `tests/deviceMenu.test.ts` enumerates this against the inline controls each
 * rack draws, which is what turns "the menu is the equivalent alternative"
 * from a claim in a comment into something that fails when it stops being true.
 */
export function deviceCommands(
  rack: DeviceMenuHost,
  effect: Effect,
  index: number,
  total: number,
  disclosure?: DeviceDisclosure,
) {
  const store = useProjectStore.getState();
  const ui = useUiStore.getState();
  const others = store.project.tracks.filter(
    (t) =>
      t.id !== rack.id &&
      (t.type === 'audio' ||
        t.type === 'instrument' ||
        t.type === 'drum' ||
        t.type === 'bus' ||
        t.type === 'fx'),
  );
  return [
    {
      label: 'Open',
      action: () => ui.set({ openDevice: { trackId: rack.id, effectId: effect.id } }),
    },
    ...(disclosure
      ? [
          {
            label: disclosure.shown ? 'Hide controls' : 'Show controls',
            action: disclosure.toggle,
          },
        ]
      : []),
    {
      label: effect.bypass ? 'Enable' : 'Bypass',
      action: () => rack.setBypass(effect.id, !effect.bypass),
    },
    { label: 'Move up', disabled: index === 0, action: () => rack.move(effect.id, -1) },
    {
      label: 'Move down',
      disabled: index >= total - 1,
      action: () => rack.move(effect.id, 1),
    },
    // Copying to another channel only makes sense from a track's chain; the
    // master's devices have nowhere else of the same kind to go.
    ...(rack.id === 'master'
      ? []
      : others.slice(0, 8).map((t) => ({
          label: `Copy to ${t.name}`,
          action: () => {
            const id = useProjectStore.getState().copyEffectTo(rack.id, effect.id, t.id);
            if (!id) ui.toast('error', `${t.name} has no free insert slot.`);
          },
        }))),
    { label: 'Remove', danger: true, action: () => rack.remove(effect.id) },
  ];
}

/** The menu every device slot answers to, on right-click and from its caret. */
export function deviceMenu(
  rack: DeviceMenuHost,
  effect: Effect,
  index: number,
  total: number,
  x: number,
  y: number,
  disclosure?: DeviceDisclosure,
) {
  useUiStore
    .getState()
    .showMenu({ x, y, items: deviceCommands(rack, effect, index, total, disclosure) });
}

/**
 * One parameter on a closed device.
 *
 * A horizontal bar rather than a knob: the rack is sixteen pixels tall and a
 * knob at that size is a dot. Drag it, or focus it and use the arrows — the
 * same contract every other parameter control in the product honours.
 */
export function MicroParam({
  rack,
  effect,
  spec,
}: {
  rack: RackHost;
  effect: Effect;
  spec: ParamSpec;
}) {
  const value = effect.params[spec.key] ?? spec.default;
  const norm = (v: number) => (v - spec.min) / (spec.max - spec.min || 1);
  const denorm = (n: number) => spec.min + Math.min(1, Math.max(0, n)) * (spec.max - spec.min);
  const set = (v: number) => rack.setParam(effect.id, spec.key, v);

  const onPointerDown = usePointerDrag<number>({
    onStart: () => {
      useProjectStore.getState().beginGesture();
      return norm(value);
    },
    onMove: (dx, _dy, e, start) => set(denorm(start + dx / (e.shiftKey ? 600 : 90))),
    onEnd: () => useProjectStore.getState().endGesture(),
  });

  return (
    <div
      className="micro-param"
      role="slider"
      tabIndex={0}
      aria-label={`${spec.label} on ${effectSpec(effect.kind)?.label ?? effect.kind}`}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={Math.round(value * 1000) / 1000}
      aria-valuetext={formatParam(spec, value)}
      onPointerDown={onPointerDown}
      onKeyDown={(e) => {
        const step = e.shiftKey ? spec.step : (spec.max - spec.min) / 40;
        let next: number | null = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step;
        else if (e.key === 'Home') next = spec.default;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation();
        set(Math.min(spec.max, Math.max(spec.min, next)));
      }}
      onDoubleClick={() => set(spec.default)}
    >
      <span
        className="micro-fill"
        style={{ width: `${Math.max(0, Math.min(1, norm(value))) * 100}%` }}
      />
      <span className="micro-label">{spec.label}</span>
      <span className="micro-value">{formatParam(spec, value)}</span>
    </div>
  );
}

function DeviceSlot({
  rack,
  effect,
  index,
  total,
  dropIndex,
  setDropIndex,
}: {
  rack: RackHost;
  effect: Effect;
  index: number;
  total: number;
  dropIndex: number | null;
  setDropIndex: (i: number | null) => void;
}) {
  const spec = effectSpec(effect.kind);
  const open = useUiStore(
    (s) => s.openDevice?.trackId === rack.id && s.openDevice.effectId === effect.id,
  );
  const [micro, setMicro] = useState(false);
  const nameRef = useRef<HTMLButtonElement>(null);
  const label = spec?.label ?? effect.kind;
  const microSpecs = micro ? microParams(effect.kind) : [];

  /*
   * Item 13's gesture, and it is the inverse of what this rack used to do: a
   * click showed the micro params and a double-click opened the window. The
   * window is what you want most often and it was the one costing two clicks.
   *
   * Both racks carry the same contract because they draw the same control, and
   * two identical-looking controls answering the same press differently is a
   * worse defect than either arrangement on its own. `useTapOrDouble` says why
   * the double tap is the half that reverts, and why nothing is deferred.
   */
  const toggle = (alsoMicro: boolean) => {
    const live = useUiStore.getState();
    const was = live.openDevice?.trackId === rack.id && live.openDevice.effectId === effect.id;
    const r = nameRef.current?.getBoundingClientRect();
    live.set({
      openDevice: was ? null : { trackId: rack.id, effectId: effect.id },
      // Where the press landed, so the window does not open on top of the
      // control that has to be pressed again to close it.
      openedFrom: was || !r ? null : { x: r.x, y: r.y, width: r.width, height: r.height },
    });
    if (alsoMicro) setMicro((m) => !m);
  };
  const press = useTapOrDouble(
    () => toggle(false),
    () => toggle(true),
  );

  return (
    <li
      // `fam-*` carries the processor family to the slot's 2px rail. It is the
      // one thing the rack draws that CSS cannot work out for itself, and the
      // spec is already in hand.
      className={`dev-slot fam-${spec?.group ?? 'utility'}${effect.bypass ? ' bypassed' : ''}${
        open ? ' open' : ''
      }${dropIndex === index ? ' drop-before' : ''}`}
      data-testid={`device-${rack.name}-${index + 1}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          DEVICE_MIME,
          JSON.stringify({ trackId: rack.id, effectId: effect.id }),
        );
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DEVICE_MIME)) return;
        e.preventDefault();
        // Above the midpoint drops before this device, below it drops after —
        // the same rule every list with a drop line uses.
        const box = e.currentTarget.getBoundingClientRect();
        setDropIndex(e.clientY < box.top + box.height / 2 ? index : index + 1);
      }}
      onDragLeave={() => setDropIndex(null)}
      onDrop={(e) => {
        const payload = readDrag(e);
        setDropIndex(null);
        if (!payload) return;
        e.preventDefault();
        e.stopPropagation();
        const to = dropIndex ?? index;
        if (payload.trackId === rack.id) {
          const from = rack.effects.findIndex((x) => x.id === payload.effectId);
          rack.reorder(payload.effectId, from < to ? to - 1 : to);
        } else if (
          !useProjectStore.getState().copyEffectTo(payload.trackId, payload.effectId, rack.id)
        ) {
          useUiStore.getState().toast('error', `${rack.name} has no free insert slot.`);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        deviceMenu(rack, effect, index, total, e.clientX, e.clientY, {
          shown: micro,
          toggle: () => setMicro((m) => !m),
        });
      }}
    >
      <button
        className="dev-power"
        aria-label={`${effect.bypass ? 'Enable' : 'Bypass'} ${label} on ${rack.name}`}
        aria-pressed={!effect.bypass}
        title={effect.bypass ? 'Bypassed — click to enable' : 'Active — click to bypass'}
        onClick={(e) => {
          e.stopPropagation();
          rack.setBypass(effect.id, !effect.bypass);
        }}
      />
      <button
        ref={nameRef}
        className="dev-name"
        aria-expanded={micro}
        aria-pressed={open}
        title={`${label} — ${describeEffect(effect)}\nClick to open it, click again to close, double-click for its main controls`}
        onClick={press}
      >
        <span className="dev-index">{index + 1}</span>
        <span className="dev-label">{label}</span>
      </button>
      <button
        className="dev-menu"
        data-testid={`device-menu-${rack.name}-${index + 1}`}
        aria-label={`${label} options`}
        onClick={(e) => {
          e.stopPropagation();
          const box = e.currentTarget.getBoundingClientRect();
          deviceMenu(rack, effect, index, total, box.left, box.bottom, {
            shown: micro,
            toggle: () => setMicro((m) => !m),
          });
        }}
      >
        <Icon name="dots-v" size={11} />
      </button>
      {microSpecs.length > 0 && (
        <div className="dev-micro" data-testid={`micro-${rack.name}-${index + 1}`}>
          {microSpecs.map((p) => (
            <MicroParam key={p.key} rack={rack} effect={effect} spec={p} />
          ))}
        </div>
      )}
    </li>
  );
}

/** The picker. Grouped the way a plugin menu is; 27 flat entries is a wall. */
/** One gesture per chain, and one message when the insert limit truncates it. */
function addChain(rack: RackHost, steps: readonly ChainStepLike[]): void {
  const dropped = applyChainSteps(rack, steps);
  if (dropped > 0) useUiStore.getState().toast('error', `Insert limit is ${MAX_INSERTS}.`);
}

export function AddDevice({ rack, full }: { rack: RackHost; full: boolean }) {
  const saved = useChainStore((s) => s.chains);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      className="dev-add"
      disabled={full}
      data-testid={`device-add-${rack.name}`}
      aria-label={full ? `Insert limit of ${MAX_INSERTS} reached` : `Add a device to ${rack.name}`}
      title={full ? `Insert limit is ${MAX_INSERTS}` : 'Add a device'}
      onClick={(e) => {
        const ui = useUiStore.getState();
        const box = e.currentTarget.getBoundingClientRect();
        const addAndOpen = (kind: EffectKind) => {
          const id = rack.add(kind);
          if (!id) return ui.toast('error', `Insert limit is ${MAX_INSERTS}.`);
          // A device you just added is a device you want to look at.
          ui.set({ openDevice: { trackId: rack.id, effectId: id } });
        };
        ui.showMenu({
          x: box.left,
          y: box.bottom,
          items: [
            ...EFFECT_GROUPS.flatMap((g) => [
              { label: `— ${EFFECT_GROUP_LABELS[g]} —`, disabled: true, action: () => {} },
              ...effectsInGroup(g).map((sp) => ({
                label: sp.label,
                action: () => addAndOpen(sp.kind),
              })),
            ]),
            // Third-party plugins are chosen by name, not by kind: the shelf
            // is what says which plugin, so the picker adds it directly rather
            // than going through `rack.add` with a bare kind.
            { label: '— Plugins —', disabled: true, action: () => {} },
            ...SHELF.map((entry) => ({
              label: entry.name,
              action: () => {
                const id = addShelfPlugin(rack.add, entry.id);
                if (!id) return ui.toast('error', `Insert limit is ${MAX_INSERTS}.`);
                ui.set({ openDevice: { trackId: rack.id, effectId: id } });
              },
            })),
            { label: '— Chains —', disabled: true, action: () => {} },
            ...CHAIN_PRESETS.map((c) => ({
              label: c.name,
              action: () => addChain(rack, c.steps),
            })),
            ...(saved.length > 0
              ? [
                  { label: '— Your chains —', disabled: true, action: () => {} },
                  ...saved.map((c) => ({
                    label: c.name,
                    action: () => addChain(rack, c.steps),
                  })),
                ]
              : []),
            ...(rack.effects.length > 0
              ? [{ label: 'Save this chain…', action: () => saveChainFrom(rack) }]
              : []),
            // Saving without a way to unsave is a library that only grows.
            ...(saved.length > 0
              ? [
                  {
                    label: 'Forget a chain…',
                    action: () =>
                      ui.showMenu({
                        x: box.left,
                        y: box.bottom,
                        items: saved.map((c) => ({
                          label: c.name,
                          danger: true,
                          action: () => useChainStore.getState().remove(c.id),
                        })),
                      }),
                  },
                ]
              : []),
          ],
        });
      }}
    >
      <Icon name="plus" size={11} />
      <span>Insert</span>
    </button>
  );
}

/**
 * The instrument, above the inserts, because that is where it is in the path.
 * Opening it goes to the instrument editor, which is a different surface from
 * a device window — a synth is not an insert.
 */
function InstrumentSlot({ rack }: { rack: RackHost }) {
  const inst = rack.instrument;
  if (!inst) return null;
  return (
    <button
      className={`dev-instrument${inst.frozen ? ' frozen' : ''}`}
      data-testid={`instrument-${rack.name}`}
      aria-label={`${inst.label} on ${rack.name}${inst.frozen ? ', frozen' : ''}`}
      title={
        inst.frozen ? `${inst.label} — frozen, playing a render` : `${inst.label} — click to edit`
      }
      onClick={inst.open}
    >
      <Icon name={inst.frozen ? 'freeze' : 'piano'} size={11} />
      <span className="dev-label">{inst.label}</span>
    </button>
  );
}

/** The rack for one channel. Read it top to bottom and you have the chain. */
export function DeviceRack({ rack }: { rack: RackHost }) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const effects = rack.effects;
  const full = effects.length >= MAX_INSERTS;

  return (
    <div
      className="dev-rack"
      data-testid={`rack-${rack.name}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DEVICE_MIME)) e.preventDefault();
      }}
      onDrop={(e) => {
        // Dropped on the rack's empty space: append.
        const payload = readDrag(e);
        setDropIndex(null);
        if (!payload || payload.trackId === rack.id) return;
        e.preventDefault();
        if (!useProjectStore.getState().copyEffectTo(payload.trackId, payload.effectId, rack.id)) {
          useUiStore.getState().toast('error', `${rack.name} has no free insert slot.`);
        }
      }}
    >
      {/* Signal order, read top to bottom: what the clip writes goes through the
          MIDI chain, into the instrument, and out through the inserts. */}
      {rack.noteFx && <NoteFxSlots host={rack.noteFx} />}
      <InstrumentSlot rack={rack} />
      <ul className={`dev-list${dropIndex === effects.length ? ' drop-end' : ''}`}>
        {effects.map((fx, i) => (
          <DeviceSlot
            key={fx.id}
            rack={rack}
            effect={fx}
            index={i}
            total={effects.length}
            dropIndex={dropIndex}
            setDropIndex={setDropIndex}
          />
        ))}
      </ul>
      <AddDevice rack={rack} full={full} />
    </div>
  );
}
