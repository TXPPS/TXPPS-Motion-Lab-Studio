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
import type { Effect, EffectKind, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { EffectVisual, FxKnob, faceKindOf } from './PluginFace';

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
  track,
  effect,
  index,
  total,
}: {
  track: Track;
  effect: Effect;
  index: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const [band, setBand] = useState('b1');
  const store = useProjectStore;
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
          onClick={() => store.getState().setEffectBypass(track.id, effect.id, !effect.bypass)}
        >
          {effect.bypass ? 'OFF' : 'ON'}
        </button>
      </div>

      {open && (
        <div className="fx-body">
          {faceKindOf(effect.kind) && (
            <div className="fx-visual">
              <EffectVisual
                effect={effect}
                trackId={track.id}
                onParam={(key, v) => store.getState().setEffectParam(track.id, effect.id, key, v)}
                onGestureStart={() => store.getState().beginGesture()}
                onGestureEnd={() => store.getState().endGesture()}
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
                    onChange={(e) =>
                      store
                        .getState()
                        .setEffectParam(track.id, effect.id, p.key, Number(e.target.value))
                    }
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
                  onChange={(v) => store.getState().setEffectParam(track.id, effect.id, p.key, v)}
                  onGestureStart={() => store.getState().beginGesture()}
                  onGestureEnd={() => store.getState().endGesture()}
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
                    store.getState().setEffectParam(track.id, effect.id, k, v);
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
              onClick={() => store.getState().moveEffect(track.id, effect.id, -1)}
            >
              ↑
            </button>
            <button
              className="btn"
              disabled={index === total - 1}
              title="Move later in the chain"
              onClick={() => store.getState().moveEffect(track.id, effect.id, 1)}
            >
              ↓
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn danger"
              data-testid={`fx-remove-${effect.id}`}
              onClick={() => store.getState().removeEffect(track.id, effect.id)}
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Insert chain editor for one track. Signal flows top to bottom. */
export function InsertRack({ track }: { track: Track }) {
  const effects = track.effects ?? [];
  const full = effects.length >= MAX_INSERTS;

  return (
    <div className="fx-rack" data-testid={`fx-rack-${track.id}`}>
      <div className="ps-title">Inserts</div>
      {effects.length === 0 && <div className="hint">No inserts. Signal passes through.</div>}
      {effects.map((fx, i) => (
        <InsertSlot key={fx.id} track={track} effect={fx} index={i} total={effects.length} />
      ))}

      <div className="fx-add">
        <select
          value=""
          disabled={full}
          aria-label="Add insert effect"
          data-testid={`fx-add-${track.id}`}
          onChange={(e) => {
            const kind = e.target.value as EffectKind;
            if (!kind) return;
            const id = useProjectStore.getState().addEffect(track.id, kind);
            e.currentTarget.value = '';
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
        </select>
        <select
          value=""
          disabled={full}
          aria-label="Add an effect chain"
          className="fx-chain-preset"
          onChange={(e) => {
            const chain = CHAIN_PRESETS.find((c) => c.name === e.target.value);
            e.currentTarget.value = '';
            if (!chain) return;
            for (const step of chain.steps) {
              const id = useProjectStore.getState().addEffect(track.id, step.kind);
              if (!id) {
                useUiStore.getState().toast('error', `Insert limit is ${MAX_INSERTS}.`);
                break;
              }
              for (const [k, v] of Object.entries(step.params)) {
                useProjectStore.getState().setEffectParam(track.id, id, k, v);
              }
              if (step.bypass) useProjectStore.getState().setEffectBypass(track.id, id, true);
            }
          }}
        >
          <option value="">Chain…</option>
          {CHAIN_PRESETS.map((c) => (
            <option key={c.name} value={c.name} title={c.blurb}>
              {c.name}
            </option>
          ))}
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
