/**
 * Note-effect rack.
 *
 * Note effects sit between what is written in a clip and what the instrument
 * receives — an arpeggiator turns a held chord into a stream, a chorder builds
 * one out of a single note. They never rewrite the clip, so switching one off
 * gives the written performance back exactly; the rack says so, because a
 * musician needs to know their part is still there.
 */
import { NOTE_FX_SPECS, noteFxParam } from '../../model/noteFx';
import type { NoteFxKind, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { FxKnob } from '../mixer/PluginFace';

const MAX_NOTE_FX = 4;

export function NoteFxRack({ track }: { track: Track }) {
  const store = useProjectStore;
  const list = track.noteFx ?? [];
  const full = list.length >= MAX_NOTE_FX;

  return (
    <div className="fx-rack" data-testid={`notefx-rack-${track.id}`}>
      <div className="ps-title">Note FX</div>
      {list.length === 0 && (
        <div className="hint">
          Nothing between the clip and the instrument. Note effects transform what is played without
          changing what is written.
        </div>
      )}

      {list.map((fx, i) => {
        const spec = NOTE_FX_SPECS.find((s) => s.kind === fx.kind);
        return (
          <div
            key={fx.id}
            className={`fx-slot${fx.bypass ? ' bypassed' : ''} open`}
            data-testid={`notefx-${fx.id}`}
          >
            <div className="fx-head">
              <span className="fx-title">
                <span className="fx-name">{spec?.label ?? fx.kind}</span>
                <span className="fx-sum">{spec?.blurb}</span>
              </span>
              <button
                className={`th-mini${fx.bypass ? '' : ' on'}`}
                aria-pressed={!fx.bypass}
                aria-label={`Bypass ${spec?.label ?? fx.kind}`}
                title={fx.bypass ? 'Bypassed — the written notes play' : 'Active'}
                onClick={() => store.getState().setNoteFxBypass(track.id, fx.id, !fx.bypass)}
              >
                {fx.bypass ? 'OFF' : 'ON'}
              </button>
            </div>
            <div className="fx-body">
              <div className="fx-knobs">
                {spec?.params.map((p) =>
                  p.choices ? (
                    <div className="fx-choice" key={p.key}>
                      <select
                        value={String(Math.round(noteFxParam(fx, p.key)))}
                        aria-label={p.label}
                        onChange={(e) =>
                          store
                            .getState()
                            .setNoteFxParam(track.id, fx.id, p.key, Number(e.target.value))
                        }
                      >
                        {p.choices.map((c, ci) => (
                          <option key={c} value={ci}>
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
                      value={noteFxParam(fx, p.key)}
                      onChange={(v) => store.getState().setNoteFxParam(track.id, fx.id, p.key, v)}
                      onGestureStart={() => store.getState().beginGesture()}
                      onGestureEnd={() => store.getState().endGesture()}
                    />
                  ),
                )}
              </div>
              {fx.kind === 'chorder' && (
                <div className="insp-row">
                  <span className="k">Intervals</span>
                  <input
                    type="text"
                    value={(fx.list ?? []).join(', ')}
                    aria-label="Chorder intervals in semitones"
                    title="Semitones above the played note, comma separated"
                    onChange={(e) =>
                      store.getState().setNoteFxList(
                        track.id,
                        fx.id,
                        e.target.value
                          .split(',')
                          .map((x) => Number(x.trim()))
                          .filter((x) => Number.isFinite(x)),
                      )
                    }
                  />
                </div>
              )}
              <div className="fx-actions">
                <button
                  className="btn"
                  disabled={i === 0}
                  title="Move earlier in the chain"
                  onClick={() => store.getState().moveNoteFx(track.id, fx.id, -1)}
                >
                  <Icon name="arrow-up" size={13} />
                </button>
                <button
                  className="btn"
                  disabled={i === list.length - 1}
                  title="Move later in the chain"
                  onClick={() => store.getState().moveNoteFx(track.id, fx.id, 1)}
                >
                  <Icon name="arrow-down" size={13} />
                </button>
                <span className="grow" />
                <button
                  className="btn danger"
                  onClick={() => store.getState().removeNoteFx(track.id, fx.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="fx-add">
        <select
          value=""
          disabled={full}
          aria-label="Add note effect"
          data-testid={`notefx-add-${track.id}`}
          onChange={(e) => {
            const kind = e.target.value as NoteFxKind;
            if (!kind) return;
            const id = store.getState().addNoteFx(track.id, kind);
            e.currentTarget.value = '';
            if (!id) useUiStore.getState().toast('error', `Note-FX limit is ${MAX_NOTE_FX}.`);
          }}
        >
          <option value="">{full ? `Full (${MAX_NOTE_FX})` : 'Add note effect…'}</option>
          {NOTE_FX_SPECS.map((s) => (
            <option key={s.kind} value={s.kind} title={s.blurb}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** One-line summary for a collapsed slot, mirroring `describeEffect`. */
export function describeNoteFx(kind: NoteFxKind): string {
  return NOTE_FX_SPECS.find((s) => s.kind === kind)?.blurb ?? '';
}
