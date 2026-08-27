/**
 * The MIDI FX rack, on the channel.
 *
 * The arpeggiator, the chorder, the repeater and the note filter all existed and
 * had nowhere a person could get to. An earlier audit recorded them as reachable
 * in four steps with no signpost and deferred it, and "reachable in four steps
 * with no signpost" is the same thing as absent for anybody who does not already
 * know they are there.
 *
 * So they sit on the channel, in the rack, **above the instrument** — which is
 * where they are in the signal: what a clip writes goes through these, then into
 * the instrument, then out through the audio inserts. Reading the rack top to
 * bottom is reading the signal path, and that is the whole reason this is here
 * rather than in a fifth grid row of its own.
 *
 * They live inside `dev-rack` rather than beside it because the strip's grid
 * places every row explicitly — a tenth row means editing five templates, and
 * `mixer.css`'s `@container` blocks renumber rows per tier, which is the change
 * this repository has a written warning about.
 *
 * A slot opens the inspector rather than editing in place. A channel strip is
 * 96px wide and an arpeggiator has seven parameters; the strip's job is to say
 * *what is loaded* and let you get to it, which is what was missing.
 */
import { MAX_NOTE_FX, NOTE_FX_SPECS } from '../../model/noteFx';
import type { NoteFx, NoteFxKind } from '../../model/types';
import { useUiStore } from '../../state/uiStore';

export interface NoteFxHost {
  list: NoteFx[];
  add: (kind: NoteFxKind) => string | null;
  setBypass: (id: string, bypass: boolean) => void;
  remove: (id: string) => void;
  /** Where there is room to edit one. */
  open: () => void;
}

function labelOf(fx: NoteFx): string {
  return NOTE_FX_SPECS.find((s) => s.kind === fx.kind)?.label ?? fx.kind;
}

export function NoteFxSlots({ host }: { host: NoteFxHost }) {
  const full = host.list.length >= MAX_NOTE_FX;
  return (
    <div className="dev-notefx" data-testid="notefx-slots">
      {/* Named even when empty. A rack that only appears once something is in it
          cannot tell you the thing exists, and not knowing it exists is the
          defect. */}
      <div className="dev-notefx-head">MIDI FX</div>
      <ul className="dev-notefx-list">
        {host.list.map((fx) => (
          <li key={fx.id} className={`dev-nfx${fx.bypass ? ' bypassed' : ''}`}>
            <button
              className="dev-nfx-open"
              data-testid={`nfx-open-${fx.id}`}
              title={`Edit ${labelOf(fx)}`}
              onClick={host.open}
            >
              {labelOf(fx)}
            </button>
            <button
              className={`dev-nfx-power${fx.bypass ? '' : ' on'}`}
              data-testid={`nfx-bypass-${fx.id}`}
              aria-pressed={!fx.bypass}
              aria-label={`${fx.bypass ? 'Enable' : 'Bypass'} ${labelOf(fx)}`}
              title={fx.bypass ? 'Bypassed — the written notes play' : 'Active'}
              onClick={() => host.setBypass(fx.id, !fx.bypass)}
            >
              {fx.bypass ? 'OFF' : 'ON'}
            </button>
          </li>
        ))}
      </ul>
      <button
        className="dev-nfx-add"
        data-testid="notefx-add"
        disabled={full}
        aria-label={full ? `MIDI FX limit of ${MAX_NOTE_FX} reached` : 'Add a MIDI effect'}
        title={full ? `MIDI FX limit is ${MAX_NOTE_FX}` : 'Add a MIDI effect'}
        onClick={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          useUiStore.getState().showMenu({
            x: box.left,
            y: box.bottom,
            items: NOTE_FX_SPECS.map((spec) => ({
              label: spec.label,
              action: () => {
                // Added and then opened: a device you have just chosen is one
                // you want to look at, and on a phone the rack has no room to
                // show you that anything happened.
                if (host.add(spec.kind)) host.open();
              },
            })),
          });
        }}
      >
        {host.list.length === 0 ? '+ MIDI FX' : '+'}
      </button>
    </div>
  );
}
