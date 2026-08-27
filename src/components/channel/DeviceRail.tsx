/**
 * The chain, laid out the way landscape is shaped.
 *
 * The console's rack is a vertical list of 44 px touch rows inside a 112 px
 * wide strip, and on a tablet in landscape that strip is 131 px tall while the
 * rack's own floor is 140 — so the rack was larger than the channel that
 * contained it, and every cap tried on it moved the collision to whichever row
 * lost next. `docs/design/channel-strip.md` has the arithmetic.
 *
 * The fix is not a smaller rack. It is the same rack on the other axis: a row
 * of cards that scrolls sideways, in a surface that is wide and short. A
 * vertical rack in a fixed-height strip has to decide what to drop; a
 * horizontal rail in a scroller does not, and adding a twelfth device changes
 * the scroll extent and nothing else.
 *
 * Three card states, and the gestures that reach them are item 13's:
 *
 *   single tap  — open this device's window; tap again and it closes
 *   double tap  — its quick controls, inline, without leaving the channel
 *   the caret   — every card at once, down to a chip and back
 *
 * That is the inverse of what the console rack did, where a click showed the
 * micro params and a double-click opened the window. Both racks moved, because
 * two controls that look identical and answer the same press differently is a
 * worse defect than either arrangement.
 */
import { useRef, useState } from 'react';
import { MAX_INSERTS, describeEffect, effectSpec, microParams } from '../../model/effects';
import type { Effect } from '../../model/types';
import { useTapOrDouble } from '../../hooks/useTapOrDouble';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';
import { AddDevice, MicroParam, deviceMenu, type RackHost } from '../mixer/DeviceRack';

/** A DOMRect as the four numbers the placement needs, or null. */
function boxOf(r: DOMRect | null) {
  return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
}

/** Whether the store currently has this device's window open. */
function isOpen(rackId: string, effectId: string): boolean {
  const open = useUiStore.getState().openDevice;
  return open?.trackId === rackId && open.effectId === effectId;
}

function RailCard({
  rack,
  effect,
  index,
  total,
}: {
  rack: RackHost;
  effect: Effect;
  index: number;
  total: number;
}) {
  const spec = effectSpec(effect.kind);
  const open = useUiStore(
    (s) => s.openDevice?.trackId === rack.id && s.openDevice.effectId === effect.id,
  );
  const [quick, setQuick] = useState(false);
  const label = spec?.label ?? effect.kind;
  // Where this card is, so the window it opens does not land on top of it. A
  // ref rather than the event's `currentTarget`, because the double tap's
  // second press has to be able to ask the same question after a re-render.
  const nameRef = useRef<HTMLButtonElement>(null);
  const from = () => nameRef.current?.getBoundingClientRect() ?? null;

  // Read live from the store rather than from `open`, which is the value this
  // render closed over: two presses inside the double-tap interval both happen
  // before React has re-rendered, so the second would otherwise decide what to
  // revert from a stale answer.
  const press = useTapOrDouble(
    () => {
      const was = isOpen(rack.id, effect.id);
      useUiStore.getState().set({
        openDevice: was ? null : { trackId: rack.id, effectId: effect.id },
        openedFrom: was ? null : boxOf(from()),
      });
    },
    () => {
      // Undo what the single tap that preceded this one did, then do the thing
      // the double tap is actually for. See `useTapOrDouble` for why the cost
      // is here and not on every open.
      const nowOpen = isOpen(rack.id, effect.id);
      useUiStore.getState().set({
        openDevice: nowOpen ? null : { trackId: rack.id, effectId: effect.id },
        openedFrom: nowOpen ? null : boxOf(from()),
      });
      setQuick((q) => !q);
    },
  );

  const specs = quick ? microParams(effect.kind) : [];

  return (
    <li
      className={`rail-card fam-${spec?.group ?? 'utility'}${effect.bypass ? ' bypassed' : ''}${
        open ? ' open' : ''
      }${quick ? ' quick' : ''}`}
      data-testid={`rail-card-${rack.name}-${index + 1}`}
      data-effect={effect.id}
      onContextMenu={(e) => {
        e.preventDefault();
        deviceMenu(rack, effect, index, total, e.clientX, e.clientY, {
          shown: quick,
          toggle: () => setQuick((q) => !q),
        });
      }}
    >
      {/*
        One row, not two. Stacked, a card is 44 + 44 on a coarse pointer and the
        rail alone comes to 103 px inside a channel that has 131 — which is the
        console strip's own arithmetic, reproduced on the other axis. Across,
        the card is 44 tall like every other control here and the whole view
        fits with room to spare. Width is what a horizontal surface has.
      */}
      <div className="rail-row">
        <button
          className="rail-power"
          data-testid={`rail-power-${effect.id}`}
          aria-label={`${effect.bypass ? 'Enable' : 'Bypass'} ${label} on ${rack.name}`}
          aria-pressed={!effect.bypass}
          title={effect.bypass ? 'Bypassed — press to enable' : 'Active — press to bypass'}
          onClick={(e) => {
            e.stopPropagation();
            rack.setBypass(effect.id, !effect.bypass);
          }}
        >
          <span className="rail-lamp" />
        </button>
        <button
          ref={nameRef}
          className="rail-name"
          data-testid={`rail-open-${effect.id}`}
          aria-expanded={quick}
          aria-pressed={open}
          title={`${label} — ${describeEffect(effect)}\nTap to open it, tap again to close, double-tap for its main controls`}
          onClick={press}
        >
          <span className="rail-index">{index + 1}</span>
          <span className="rail-label">{label}</span>
        </button>
        <button
          className="rail-menu"
          data-testid={`rail-menu-${effect.id}`}
          aria-label={`${label} options`}
          onClick={(e) => {
            e.stopPropagation();
            const box = e.currentTarget.getBoundingClientRect();
            deviceMenu(rack, effect, index, total, box.left, box.bottom, {
              shown: quick,
              toggle: () => setQuick((q) => !q),
            });
          }}
        >
          <Icon name="dots-v" size={11} />
        </button>
      </div>

      {specs.length > 0 && (
        <div className="rail-quick" data-testid={`rail-quick-${effect.id}`}>
          {specs.map((p) => (
            <MicroParam key={p.key} rack={rack} effect={effect} spec={p} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The rail: a header that collapses it, the cards, and the Insert button.
 *
 * The Insert button is inside the scroller, at the end of the chain, because
 * that is where the device it adds will go. Pinning it outside would put "add"
 * somewhere the chain does not end and would cost the rail a fixed column on
 * the narrowest thing this has to work on.
 */
export function DeviceRail({ rack }: { rack: RackHost }) {
  const openRack = useWorkspaceStore((w) => w.channelRackOpen);
  const effects = rack.effects;

  return (
    <section className={`dev-rail${openRack ? '' : ' collapsed'}`} data-testid="device-rail">
      <header className="rail-bar">
        <button
          className="rail-caret"
          data-testid="rail-collapse"
          aria-expanded={openRack}
          aria-label={openRack ? 'Collapse the rack' : 'Expand the rack'}
          title={openRack ? 'Collapse the rack' : 'Expand the rack'}
          onClick={() => useWorkspaceStore.getState().toggle('channelRackOpen')}
        >
          <Icon name={openRack ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <span className="rail-title">Inserts</span>
        <span className="rail-count">
          {effects.length} of {MAX_INSERTS}
        </span>
      </header>

      <ul className="rail-list" data-testid="rail-list">
        {effects.map((fx, i) => (
          <RailCard key={fx.id} rack={rack} effect={fx} index={i} total={effects.length} />
        ))}
        {effects.length === 0 && (
          // Said rather than left blank: an empty rail and a rail that has not
          // loaded look the same, and the channel is audible either way.
          <li className="rail-empty" data-testid="rail-empty">
            No inserts on this channel
          </li>
        )}
        <li className="rail-add">
          <AddDevice rack={rack} full={effects.length >= MAX_INSERTS} />
        </li>
      </ul>
    </section>
  );
}
