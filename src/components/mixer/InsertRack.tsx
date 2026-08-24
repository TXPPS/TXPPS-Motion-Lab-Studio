import { useState } from 'react';
import {
  EFFECT_GROUPS,
  EFFECT_GROUP_LABELS,
  EFFECT_SPECS,
  MAX_INSERTS,
  choiceOf,
  describeEffect,
  effectSpec,
  effectsInGroup,
  paramOf,
  EQ8_BANDS,
} from '../../model/effects';
import { CHAIN_PRESETS, presetsFor } from '../../model/effectPresets';
import { applyChainSteps, captureChain, type ChainTarget } from '../../app/chainActions';
import { useChainStore } from '../../state/chainStore';
import type { Effect, EffectKind, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { EffectVisual, FxKnob, faceKindOf } from './PluginFace';
import { MotionWaveFace } from './MotionWaveFace';
import { isMotionWaveKind } from '../../audio/motionwave/registry';
import { SHELF, addShelfPlugin } from '../../audio/wam/shelf';

/** Marks a picker option as a shelf plugin rather than a built-in effect kind. */
const SHELF_OPTION_PREFIX = 'shelf:';

/**
 * Which parameters to show at once.
 *
 * The eight-band EQ has 32 parameters; showing them all is a wall of knobs
 * nobody reads. It gets band tabs instead — the curve stays whole, and the
 * knobs below it belong to the band being edited, which is how every
 * parametric EQ works.
 */
function bandTabsFor(effect: Effect): { id: string; label: string }[] | null {
  if (effect.kind !== 'eq8') return null;
  return EQ8_BANDS.map((b) => ({ id: b.prefix, label: b.label }));
}

function InsertSlot({
  chain,
  effect,
  index,
  total,
}: {
  chain: ChainHost;
  effect: Effect;
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [band, setBand] = useState('b1');
  const spec = effectSpec(effect.kind);
  const tabs = bandTabsFor(effect);
  const params = (spec?.params ?? []).filter((p) => !tabs || p.key.startsWith(band));

  return (
    <div
      className={`fx-slot${effect.bypass ? ' bypassed' : ''}${open ? ' open' : ''}`}
      data-testid={`fx-slot-${effect.id}`}
    >
      <div className="fx-head">
        <button
          className="fx-title"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${spec?.label ?? effect.kind} settings`}
        >
          <span className="fx-name">{spec?.label ?? effect.kind}</span>
          <span className="fx-sum mono">{describeEffect(effect)}</span>
        </button>
        <button
          className={`th-mini${effect.bypass ? '' : ' on'}`}
          title={effect.bypass ? 'Bypassed — click to enable' : 'Active — click to bypass'}
          aria-pressed={!effect.bypass}
          aria-label={`Bypass ${spec?.label ?? effect.kind}`}
          data-testid={`fx-bypass-${effect.id}`}
          onClick={() => chain.setBypass(effect.id, !effect.bypass)}
        >
          {effect.bypass ? 'OFF' : 'ON'}
        </button>
      </div>

      {open && isMotionWaveKind(effect.kind) && (
        /*
         * A Motion Wave unit brings its own panel here too.
         *
         * This inline rack is where a phone user actually lands — the floating
         * window is a desktop affordance — so mounting the face only there
         * would mean the designed panel existed on the one device least likely
         * to be used. The knob grid below is right for a device whose only
         * declaration is its parameters; these units declare a face.
         */
        <div className="fx-body fx-body-mw">
          <MotionWaveFace trackId={chain.id} effect={effect} />
        </div>
      )}

      {open && !isMotionWaveKind(effect.kind) && (
        <div className="fx-body">
          {faceKindOf(effect.kind) && (
            <div className="fx-visual">
              <EffectVisual
                effect={effect}
                trackId={chain.id}
                onParam={(key, v) => chain.setParam(effect.id, key, v)}
                onGestureStart={() => useProjectStore.getState().beginGesture()}
                onGestureEnd={() => useProjectStore.getState().endGesture()}
              />
            </div>
          )}
          {tabs && (
            <div className="seg fx-bands" role="group" aria-label="EQ band">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className={band === t.id ? 'on' : ''}
                  aria-pressed={band === t.id}
                  onClick={() => setBand(t.id)}
                  title={`Edit the ${t.label} band`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div className="fx-knobs">
            {params.map((p) =>
              p.choices ? (
                <div className="fx-choice" key={p.key}>
                  <select
                    value={String(choiceOf(effect, p.key))}
                    aria-label={p.label}
                    onChange={(e) => chain.setParam(effect.id, p.key, Number(e.target.value))}
                  >
                    {p.choices.map((c, i) => (
                      <option key={c} value={i}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <span className="fx-knob-label">{p.label}</span>
                </div>
              ) : (
                <FxKnob
                  key={p.key}
                  spec={p}
                  value={paramOf(effect, p.key)}
                  onChange={(v) => chain.setParam(effect.id, p.key, v)}
                  onGestureStart={() => useProjectStore.getState().beginGesture()}
                  onGestureEnd={() => useProjectStore.getState().endGesture()}
                />
              ),
            )}
          </div>
          <div className="fx-actions">
            {presetsFor(effect.kind).length > 0 && (
              <select
                className="fx-preset"
                value=""
                aria-label={`${spec?.label ?? effect.kind} presets`}
                onChange={(e) => {
                  const preset = presetsFor(effect.kind).find((pp) => pp.name === e.target.value);
                  if (!preset) return;
                  for (const [k, v] of Object.entries(preset.params)) {
                    chain.setParam(effect.id, k, v);
                  }
                  e.currentTarget.value = '';
                }}
              >
                <option value="">Preset…</option>
                {presetsFor(effect.kind).map((pp) => (
                  <option key={pp.name} value={pp.name}>
                    {pp.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="btn"
              disabled={index === 0}
              title="Move earlier in the chain"
              onClick={() => chain.move(effect.id, -1)}
            >
              ↑
            </button>
            <button
              className="btn"
              disabled={index === total - 1}
              title="Move later in the chain"
              onClick={() => chain.move(effect.id, 1)}
            >
              ↓
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn danger"
              data-testid={`fx-remove-${effect.id}`}
              onClick={() => chain.remove(effect.id)}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Everything the rack needs to edit a chain, wherever that chain lives.
 *
 * A chain is not always a track's: the mastering page's release chain and the
 * master channel both own one. Abstracting the five mutations means one editor
 * serves all of them instead of three near-identical components drifting apart.
 */
export interface ChainHost {
  /** stable id used for meter and gain-reduction lookups ('master' for the master) */
  id: string;
  /** Section heading; defaults to "Inserts". */
  title?: string;
  /** Shown when the chain is empty. */
  emptyHint?: string;
  effects: Effect[];
  add: (kind: EffectKind) => string | null;
  remove: (effectId: string) => void;
  setParam: (effectId: string, key: string, value: number) => void;
  setBypass: (effectId: string, bypass: boolean) => void;
  move: (effectId: string, delta: number) => void;
}

/** Sentinel for the one entry in the chain menu that is an action, not a chain. */
const SAVE_OPTION = '__save__';

/**
 * Save what is on this channel as a chain of the user's own.
 *
 * Named rather than numbered, because a library of "Chain 4" is a library
 * nobody opens; saving over an existing name replaces it, which is what a
 * second save of the same chain plainly means.
 */
export function saveChainFrom(chain: ChainTarget & { effects: Effect[] }): void {
  const ui = useUiStore.getState();
  ui.showDialog({
    kind: 'prompt',
    title: 'Save this chain',
    message: `${chain.effects.length} device${chain.effects.length === 1 ? '' : 's'}, with their settings.`,
    initialValue: '',
    confirmLabel: 'Save',
    onSubmit: (name) => {
      const id = useChainStore.getState().save(name, captureChain(chain.effects));
      ui.toast(
        id ? 'info' : 'error',
        id ? `Saved "${name.trim()}" to your chains.` : 'A chain needs a name.',
      );
    },
  });
}

/** The default host: a track's own insert chain. */
export function trackChainHost(track: Track): ChainHost {
  const store = useProjectStore;
  return {
    id: track.id,
    effects: track.effects ?? [],
    add: (kind) => store.getState().addEffect(track.id, kind),
    remove: (id) => store.getState().removeEffect(track.id, id),
    setParam: (id, key, v) => store.getState().setEffectParam(track.id, id, key, v),
    setBypass: (id, bypass) => store.getState().setEffectBypass(track.id, id, bypass),
    move: (id, delta) => store.getState().moveEffect(track.id, id, delta),
  };
}

/** Insert chain editor. Signal flows top to bottom. */
export function InsertRack({ track, host }: { track?: Track; host?: ChainHost }) {
  const chain = host ?? trackChainHost(track!);
  const effects = chain.effects;
  const savedChains = useChainStore((s) => s.chains);
  const full = effects.length >= MAX_INSERTS;

  return (
    <div className="fx-rack" data-testid={`fx-rack-${chain.id}`}>
      <div className="ps-title">{chain.title ?? 'Inserts'}</div>
      {effects.length === 0 && (
        <div className="hint">{chain.emptyHint ?? 'No inserts. Signal passes through.'}</div>
      )}
      {effects.map((fx, i) => (
        <InsertSlot key={fx.id} chain={chain} effect={fx} index={i} total={effects.length} />
      ))}

      <div className="fx-add">
        <select
          value=""
          disabled={full}
          aria-label="Add insert effect"
          data-testid={`fx-add-${chain.id}`}
          onChange={(e) => {
            const value = e.target.value;
            e.currentTarget.value = '';
            if (!value) return;
            // A plugin is picked by name from the shelf rather than by kind,
            // because 'wam' on its own does not say which plugin.
            const id = value.startsWith(SHELF_OPTION_PREFIX)
              ? addShelfPlugin(chain.add, value.slice(SHELF_OPTION_PREFIX.length))
              : chain.add(value as EffectKind);
            if (!id) useUiStore.getState().toast('error', `Insert limit is ${MAX_INSERTS}.`);
          }}
        >
          <option value="">
            {full ? `Full (${MAX_INSERTS} inserts)` : `Add insert… (${EFFECT_SPECS.length})`}
          </option>
          {/* Grouped the way a plugin menu is: dynamics, tone, modulation,
              time, stereo, utility — 27 flat entries would be a wall. */}
          {EFFECT_GROUPS.map((g) => (
            <optgroup key={g} label={EFFECT_GROUP_LABELS[g]}>
              {effectsInGroup(g).map((sp) => (
                <option key={sp.kind} value={sp.kind} title={sp.blurb}>
                  {sp.label}
                </option>
              ))}
            </optgroup>
          ))}
          <optgroup label="Plugins">
            {SHELF.map((entry) => (
              <option
                key={entry.id}
                value={`${SHELF_OPTION_PREFIX}${entry.id}`}
                title={`${entry.blurb} — ${entry.vendor}, ${entry.licence}`}
              >
                {entry.name}
              </option>
            ))}
          </optgroup>
        </select>
        <select
          value=""
          disabled={full}
          aria-label="Add an effect chain"
          className="fx-chain-preset"
          data-testid={`fx-chain-${chain.id}`}
          onChange={(e) => {
            const value = e.target.value;
            e.currentTarget.value = '';
            if (value === SAVE_OPTION) return saveChainFrom(chain);
            const saved = useChainStore.getState().chains.find((c) => c.id === value);
            const steps = saved?.steps ?? CHAIN_PRESETS.find((c) => c.name === value)?.steps;
            if (!steps) return;
            const dropped = applyChainSteps(chain, steps);
            if (dropped > 0) {
              useUiStore.getState().toast('error', `Insert limit is ${MAX_INSERTS}.`);
            }
          }}
        >
          <option value="">Chain…</option>
          <optgroup label="Built in">
            {CHAIN_PRESETS.map((c) => (
              <option key={c.name} value={c.name} title={c.blurb}>
                {c.name}
              </option>
            ))}
          </optgroup>
          {savedChains.length > 0 && (
            <optgroup label="Saved">
              {savedChains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          )}
          {effects.length > 0 && <option value={SAVE_OPTION}>Save this chain…</option>}
        </select>
      </div>
    </div>
  );
}

/**
 * Send editor. Only effect buses appear as targets, and a send that would feed
 * a bus already routed back into this track is rejected by the store, so the
 * graph cannot be made to feed back on itself from the UI.
 */
export function SendRack({ track, buses }: { track: Track; buses: Track[] }) {
  const store = useProjectStore;
  const sends = track.sends ?? [];

  if (track.type === 'bus') {
    return (
      <div className="fx-rack">
        <div className="ps-title">Sends</div>
        <div className="hint">Buses route straight to Master and cannot send onward.</div>
      </div>
    );
  }

  if (buses.length === 0) {
    return (
      <div className="fx-rack">
        <div className="ps-title">Sends</div>
        <div className="hint">Add a bus track to send to.</div>
        <button
          className="btn"
          data-testid="add-bus-track"
          onClick={() => useUiStore.getState().selectTrack(store.getState().addTrack('bus'))}
        >
          <Icon name="plus" size={13} />
          Add bus
        </button>
      </div>
    );
  }

  return (
    <div className="fx-rack" data-testid={`send-rack-${track.id}`}>
      <div className="ps-title">Sends</div>
      {buses.map((bus) => {
        const send = sends.find((s) => s.busId === bus.id);
        const amount = send?.amount ?? 0;
        const on = !!send?.enabled;
        return (
          <div className="send-row" key={bus.id} data-testid={`send-${bus.id}`}>
            <button
              className={`th-mini${on ? ' on' : ''}`}
              aria-pressed={on}
              aria-label={`Send to ${bus.name}`}
              onClick={() =>
                send
                  ? store.getState().setSend(track.id, bus.id, { enabled: !send.enabled })
                  : store.getState().setSend(track.id, bus.id, { enabled: true, amount: 0.3 })
              }
            >
              {on ? 'ON' : 'OFF'}
            </button>
            <span className="k send-name" title={bus.name}>
              {bus.name}
            </span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={amount}
              disabled={!send}
              aria-label={`${bus.name} send amount`}
              onChange={(e) =>
                store.getState().setSend(track.id, bus.id, {
                  amount: Number(e.target.value),
                  enabled: true,
                })
              }
            />
            <button
              className={`th-mini${send?.preFader ? ' on' : ''}`}
              disabled={!send}
              title={send?.preFader ? 'Pre-fader (post-insert)' : 'Post-fader'}
              aria-label={`${bus.name} pre-fader`}
              onClick={() =>
                send && store.getState().setSend(track.id, bus.id, { preFader: !send.preFader })
              }
            >
              {send?.preFader ? 'PRE' : 'PST'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
