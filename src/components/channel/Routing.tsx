/**
 * Where a channel goes, and what it also gets copied to.
 *
 * Item 14. The model has always told these apart — `track.output` is one
 * destination and `track.sends[]` is a list of amounts — and the interface has
 * never said so. Both appeared as rows of text with a dB number beside them,
 * which makes a send look like a second output and a bus look like a loud send.
 *
 * So the difference is drawn rather than labelled: **an output is an arrow and
 * a send is a knob.** An arrow has no quantity and a knob is nothing but
 * quantity, which is exactly the distinction being made.
 *
 * And one defect this names. `Mixer.tsx` builds its bus list as buses *plus* FX
 * returns and hands it to the strip, which fills the output menu from it — so
 * an FX return has been offered as an output destination, and the `fx` type
 * exists precisely to say "fed by sends rather than by output routing". Here
 * the two lists are separate, which is the whole point.
 */
import { formatDb } from '../../model/music';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { ParamKnob } from '../common/widgets';
import { Icon } from '../common/Icon';

/** The widest a send can be turned up, matching `Send.amount`'s own range. */
const SEND_MAX = 1.5;

/**
 * A knob per possible destination, whether or not a send exists yet.
 *
 * Drawing only the sends that already exist means the way to *make* one is
 * somewhere else, and "somewhere else" was the inspector — which is how a
 * channel came to have a sends row that could only ever shrink. Turning a knob
 * up from zero creates the send; turning it to zero leaves it in place at zero,
 * because a send you have just silenced is one you are still deciding about.
 */
export function SendKnobs({ track, targets }: { track: Track; targets: Track[] }) {
  const store = useProjectStore;
  const sends = track.sends ?? [];

  if (targets.length === 0) {
    return (
      <div className="chn-sends empty" data-testid="channel-sends">
        <span className="hint">
          No FX returns or buses yet — add one in the mixer and it appears here.
        </span>
      </div>
    );
  }

  return (
    <div className="chn-sends" data-testid="channel-sends">
      {targets.map((bus) => {
        const send = sends.find((s) => s.busId === bus.id);
        const amount = send?.enabled ? send.amount : 0;
        const set = (v: number) =>
          store.getState().setSend(track.id, bus.id, { amount: v, enabled: true });
        return (
          <div
            className={`chn-send${send?.enabled && send.amount > 0 ? ' live' : ''}`}
            key={bus.id}
            data-testid={`send-${bus.id}`}
          >
            <ParamKnob
              size={34}
              norm={amount / SEND_MAX}
              onNorm={(n) => set(n * SEND_MAX)}
              onGestureStart={() => store.getState().beginGesture()}
              onGestureEnd={() => store.getState().endGesture()}
              label={`Send from ${track.name} to ${bus.name}`}
              display={amount > 0 ? formatDb(amount) : 'off'}
            />
            <span className="chn-send-name" title={bus.name}>
              {bus.name}
            </span>
            <button
              className={`chn-send-tap${send?.preFader ? ' pre' : ''}`}
              data-testid={`send-tap-${bus.id}`}
              aria-pressed={send?.preFader === true}
              aria-label={`${bus.name} send tap point on ${track.name}`}
              title={
                send?.preFader
                  ? 'Pre-fader — the send ignores this channel’s fader'
                  : 'Post-fader — the send follows this channel’s fader'
              }
              onClick={() =>
                store
                  .getState()
                  .setSend(track.id, bus.id, { preFader: !send?.preFader, enabled: true })
              }
            >
              {send?.preFader ? 'PRE' : 'POST'}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The one destination, and the VCA that scales it without moving it.
 *
 * Buses only. An FX return routed *into* would be a second way to feed a
 * channel whose whole definition is that it is fed by sends — and a track whose
 * output is already an FX return keeps that option listed, because a select
 * that cannot represent its own value is a control that silently re-routes
 * somebody's mix on first render. Same rule `paramIdExists` follows.
 */
export function OutputRoute({
  track,
  buses,
  vcas,
}: {
  track: Track;
  buses: Track[];
  vcas: Track[];
}) {
  const store = useProjectStore;
  const isSum = track.type === 'bus' || track.type === 'fx';
  const current = useProjectStore((s) => s.project.tracks.find((t) => t.id === track.output));
  const strayTarget = current && current.type !== 'bus' ? current : null;

  return (
    <div className="chn-route" data-testid="channel-route">
      <span className="chn-route-arrow" aria-hidden>
        <Icon name="chevron-right" size={12} />
      </span>
      {isSum ? (
        <span className="chn-route-static" data-testid="channel-route-static">
          Master
        </span>
      ) : (
        <select
          className="chn-route-select"
          value={track.output}
          aria-label={`${track.name} output`}
          title="Where this channel goes. One destination — a send is the other thing."
          data-testid="channel-route-select"
          onChange={(e) => store.getState().setTrack(track.id, { output: e.target.value })}
        >
          <option value="master">Master</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
          {strayTarget && <option value={strayTarget.id}>{strayTarget.name} (FX return)</option>}
        </select>
      )}
      {vcas.length > 0 && !isSum && (
        <select
          className="chn-vca-select"
          value={track.vcaId ?? ''}
          aria-label={`${track.name} VCA`}
          title="A VCA scales this channel's gain without changing where it goes."
          data-testid="channel-vca-select"
          onChange={(e) => store.getState().assignVca(track.id, e.target.value || undefined)}
        >
          <option value="">No VCA</option>
          {vcas.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
