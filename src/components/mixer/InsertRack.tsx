import { useState } from 'react';
import {
  EFFECT_SPECS,
  MAX_INSERTS,
  describeEffect,
  effectSpec,
  formatParam,
  paramOf,
  type ParamSpec,
} from '../../model/effects';
import type { Effect, EffectKind, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

/**
 * One parameter row. Log-curve parameters map the slider position through an
 * exponential so frequency controls are usable across their whole range instead
 * of bunching everything below a quarter of the travel.
 */
function ParamRow({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const log = spec.curve === 'log' && spec.min > 0;
  const toSlider = (v: number) =>
    log
      ? (Math.log(v / spec.min) / Math.log(spec.max / spec.min)) * 1000
      : ((v - spec.min) / (spec.max - spec.min)) * 1000;
  const fromSlider = (s: number) =>
    log
      ? spec.min * Math.pow(spec.max / spec.min, s / 1000)
      : spec.min + (s / 1000) * (spec.max - spec.min);

  return (
    <div className="fx-param">
      <span className="k">{spec.label}</span>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(toSlider(value))}
        aria-label={spec.label}
        onChange={(e) => {
          const raw = fromSlider(Number(e.target.value));
          // Re-quantise to the spec step so stored values stay tidy.
          const stepped = Math.round(raw / spec.step) * spec.step;
          onChange(Math.min(spec.max, Math.max(spec.min, stepped)));
        }}
      />
      <span className="v mono">{formatParam(spec, value)}</span>
    </div>
  );
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
  const store = useProjectStore;
  const spec = effectSpec(effect.kind);

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
          {spec?.params.map((p) => (
            <ParamRow
              key={p.key}
              spec={p}
              value={paramOf(effect, p.key)}
              onChange={(v) => store.getState().setEffectParam(track.id, effect.id, p.key, v)}
            />
          ))}
          <div className="fx-actions">
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
          <option value="">{full ? `Full (${MAX_INSERTS} inserts)` : 'Add insert…'}</option>
          {EFFECT_SPECS.map((s) => (
            <option key={s.kind} value={s.kind} title={s.blurb}>
              {s.label}
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
