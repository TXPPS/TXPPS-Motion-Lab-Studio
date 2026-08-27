/**
 * What a console strip says about its chain when the chain will not fit in it.
 *
 * The arithmetic is in `docs/design/channel-strip.md` §1 and it is not close:
 * on a coarse pointer the device rack's derived floor is 140 px — one whole
 * device row, the gap, the Insert button, the padding, and another row on a
 * channel carrying an instrument — while a console strip on a tablet in
 * landscape is 131 px tall in total. The floor is right; a device row clipped
 * part-way down yields an options button under the touch minimum, which is a
 * device on the channel that cannot be bypassed, moved or removed. The
 * container is what is wrong, and no cap inside it was ever going to help.
 *
 * So below the tier where the rack fits, the strip draws this instead: one
 * control, one row, carrying a family-coloured dot per device. It still answers
 * the question a console is for — what *kind* of chain is on this channel,
 * across twenty channels at a glance — and pressing it opens the channel end to
 * end in the Channel view, which is the rack.
 *
 * That substitution is WCAG 2.5.8's equivalent-alternative provision, and the
 * provision obliges the alternative to carry *every* command the small control
 * offered. It does, because the Channel view is not a summary of the rack: it
 * is the rack, on the other axis. The master is included in "every channel" —
 * `MasterView` exists for no other reason.
 */
import { memo } from 'react';
import { effectSpec } from '../../model/effects';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';
import type { RackHost } from './DeviceRack';

/**
 * How many dots are drawn before the rest become a number.
 *
 * A strip is 112 px wide on a coarse pointer and loses 14 to its own padding,
 * so six 9 px dots and their 4 px gaps come to 74 and leave room for the count
 * beside them. Written as one number rather than measured per render because a
 * summary that reflowed as devices were added would be a summary that moved
 * under the finger reaching for it.
 */
const MAX_DOTS = 6;

/** Open this channel end to end. The same navigation the cue bar's link makes. */
export function openChannelView(channelId: string): void {
  useUiStore.getState().selectTrack(channelId);
  useWorkspaceStore.getState().reveal('editor');
  useUiStore.getState().set({ editorTab: 'channel', phoneMode: 'edit' });
}

export const ChainSummary = memo(function ChainSummary({ rack }: { rack: RackHost }) {
  // The instrument is part of what is on the channel, and on a drum or
  // instrument track it is the loudest part. Leaving it out would make an
  // instrument channel with no inserts read as an empty chain, which is the
  // one thing a summary must never say about a channel that plays something.
  const devices = [
    ...(rack.instrument
      ? [{ key: 'instrument', family: 'instrument', label: rack.instrument.label }]
      : []),
    ...rack.effects.map((e) => ({
      key: e.id,
      family: effectSpec(e.kind)?.group ?? 'utility',
      label: (effectSpec(e.kind)?.label ?? e.kind) + (e.bypass ? ' (bypassed)' : ''),
    })),
  ];
  const hidden = Math.max(0, devices.length - MAX_DOTS);
  const summary =
    devices.length === 0 ? 'nothing inserted' : devices.map((d) => d.label).join(' · ');

  return (
    <button
      className={`strip-chain${devices.length === 0 ? ' empty' : ''}`}
      data-testid={`chain-${rack.name}`}
      title={`${rack.name} — ${summary}. Press to open the channel end to end.`}
      aria-label={`${rack.name} chain: ${summary}. Opens the channel end to end.`}
      onClick={() => openChannelView(rack.id)}
    >
      {devices.length === 0 ? (
        <>
          <Icon name="plus" size={11} />
          <span className="chain-empty-label">Insert</span>
        </>
      ) : (
        <>
          <span className="chain-dots">
            {devices.slice(0, MAX_DOTS).map((d) => (
              <span key={d.key} className={`chain-dot fam-${d.family}`} />
            ))}
          </span>
          {hidden > 0 && <span className="chain-n">+{hidden}</span>}
        </>
      )}
    </button>
  );
});
