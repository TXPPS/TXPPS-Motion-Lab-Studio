/**
 * The master, drawn as the channel it is.
 *
 * Phase B of the strip redesign replaces the console's device rack with a chain
 * summary wherever the rack's touch floor does not fit — and the master strip
 * is one of the strips that happens to. Without this the summary on the master
 * would be a control pointing at a surface that refused to draw its channel:
 * WCAG 2.5.8's equivalent alternative has to carry *every* command the small
 * control offered, and "every" includes the master's inserts.
 *
 * What it does not have is as deliberate as what it does. There is no input
 * trim, no polarity, no MIDI chain, no instrument, no sends and no output menu:
 * the master's output is the interface, so it is stated rather than chosen. The
 * two monitoring flags — mono check and the safety limiter — take the In
 * section, because that is where a channel's own switches live and they are the
 * only two the master has.
 */
import { linToDb } from '../../model/music';
import { masterRack } from '../mixer/DeviceRack';
import { useProjectStore } from '../../state/projectStore';
import { Icon } from '../common/Icon';
import { DeviceRail } from './DeviceRail';
import { OutColumn, Section } from './parts';

export function MasterView() {
  const master = useProjectStore((s) => s.project.master);
  const volume = useProjectStore((s) => s.project.master?.volume ?? s.project.masterVolume);
  const store = useProjectStore;
  const rack = masterRack(master?.effects ?? []);

  return (
    <div
      className="channel-view"
      style={{ ['--strip-color' as string]: 'var(--warm)' }}
      data-testid="channel-view"
      role="group"
      aria-label="Master channel"
    >
      <header className="chn-head">
        <Icon name="output" size={12} />
        <span className="chn-name" title="Master">
          Master
        </span>
      </header>

      <div className="chn-rail" data-testid="channel-rail">
        <Section title="Monitor" testId="channel-input">
          <div className="chn-input">
            <button
              className={`in-flag${master?.monoCheck ? ' on' : ''}`}
              title="Mono compatibility check (monitoring only — never printed to a bounce)"
              aria-pressed={master?.monoCheck === true}
              aria-label="Mono compatibility check"
              data-testid="channel-mono"
              onClick={() => store.getState().setMaster({ monoCheck: !master?.monoCheck })}
            >
              MONO
            </button>
            <button
              className={`in-flag${master?.limiter === false ? '' : ' on'}`}
              title="Safety limiter on the output"
              aria-pressed={master?.limiter !== false}
              aria-label="Safety limiter"
              data-testid="channel-limiter"
              onClick={() => store.getState().setMaster({ limiter: master?.limiter === false })}
            >
              LIM
            </button>
            <button
              className={`in-flag${master?.dim ? ' on' : ''}`}
              title="Dim the monitor output by 20 dB"
              aria-pressed={master?.dim === true}
              aria-label="Dim the monitor output"
              data-testid="channel-dim"
              onClick={() => store.getState().setMaster({ dim: !master?.dim })}
            >
              DIM
            </button>
          </div>
        </Section>

        <DeviceRail rack={rack} />
      </div>

      <OutColumn
        meterId="master"
        label="Master"
        pan={master?.pan ?? 0}
        volume={volume}
        onPan={(v) => store.getState().setMaster({ pan: v })}
        onVolume={(v) => store.getState().setMasterVolume(v)}
        route={
          <div className="chn-route" data-testid="channel-route" title="Stereo output">
            <span className="chn-route-arrow" aria-hidden>
              <Icon name="chevron-right" size={12} />
            </span>
            <span className="chn-route-static" data-testid="channel-route-static">
              OUT {linToDb(volume) >= 0 ? '+' : ''}
              {linToDb(volume).toFixed(1)}
            </span>
          </div>
        }
      />
    </div>
  );
}
