/**
 * The two pieces of a Channel view that every channel has, master included.
 *
 * They are here rather than in `ChannelView.tsx` because the master is a
 * channel with a chain like any other, and the console's shortest tiers now
 * send every chain to this surface — so a master that could not be drawn here
 * would be a channel whose devices the tier ladder had quietly stranded. One
 * copy, for the same reason `RackHost` is one type: a caller should not have to
 * know which kind of channel it is holding.
 */
import { PanKnob, PeakReadout, StereoMeter, Fader, panText } from '../common/widgets';
import { formatDb } from '../../model/music';
import { useProjectStore } from '../../state/projectStore';

/** One labelled section of the rail. The label is the section's only chrome. */
export function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="chn-section" data-testid={testId}>
      <span className="chn-title">{title}</span>
      <div className="chn-body">{children}</div>
    </section>
  );
}

/**
 * The output column: pan, fader, meter, readout and wherever the signal goes.
 *
 * A sibling of the rail rather than its last child — that is what makes "the
 * chain never steals room from the fader" structural rather than a promise. A
 * twelfth insert changes the rail's scroll extent and cannot move anything in
 * here, because the rail does not contain it.
 */
export function OutColumn({
  meterId,
  label,
  pan,
  volume,
  onPan,
  onVolume,
  route,
}: {
  meterId: string;
  label: string;
  pan: number;
  volume: number;
  onPan: (v: number) => void;
  onVolume: (v: number) => void;
  route: React.ReactNode;
}) {
  const store = useProjectStore;
  return (
    <aside className="chn-out" data-testid="channel-output">
      <span className="chn-title">Out</span>
      <div className="chn-out-body">
        <div className="chn-pan">
          <PanKnob
            size={30}
            value={pan}
            onChange={onPan}
            onGestureStart={() => store.getState().beginGesture()}
            onGestureEnd={() => store.getState().endGesture()}
            label={`${label} pan`}
          />
          <span className="t-num">{panText(pan)}</span>
        </div>
        <div className="chn-fader">
          <Fader
            value={volume}
            label={`${label} volume`}
            onGestureStart={() => store.getState().beginGesture()}
            onGestureEnd={() => store.getState().endGesture()}
            onChange={onVolume}
          />
          <StereoMeter meterId={meterId} scale label={`${label} level`} />
        </div>
        <div className="chn-readout">
          <span className="t-num" data-testid="channel-db">
            {formatDb(volume)}
          </span>
          <PeakReadout meterId={meterId} />
        </div>
      </div>
      {route}
    </aside>
  );
}
