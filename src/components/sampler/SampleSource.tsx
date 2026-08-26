/**
 * The control that puts a sample in a sampler.
 *
 * One button per surface, opening one menu, because that is the shape the
 * device rack already proved: a menu is the one target that can be made 44 pt
 * on every form factor, and every command inside it is a full-width row that
 * can be too. The alternative — a row of small inline buttons, one per route —
 * is the reachability defect this fixes, rebuilt one panel over.
 *
 * It is drawn on every surface where a zone can be empty: the quick sampler
 * with and without a sample, each pad in the pad editor, and the zone list.
 * "The user can get to it from somewhere else" is what the old drop target
 * relied on, and the somewhere else was a panel the sampler never mentions.
 */
import { openSampleSourceMenu, type SampleDest } from '../../app/samplerImportActions';
import { Icon } from '../common/Icon';

export function SampleSourceButton({
  trackId,
  dest,
  label = 'Load sample',
  testId = 'smp-load',
  primary = false,
}: {
  trackId: string;
  dest: SampleDest;
  label?: string;
  testId?: string;
  primary?: boolean;
}) {
  return (
    <button
      className={`btn smp-load${primary ? ' primary' : ''}`}
      data-testid={testId}
      aria-haspopup="menu"
      title="Import an audio file, or pick one already in this project"
      onClick={(e) => {
        e.stopPropagation();
        // The menu is anchored to the button's own box rather than to the
        // pointer: a tap reports the finger's centre, which on a 44 pt target
        // can be 20 px from the edge the menu should line up with, and the
        // menu then covers the control that opened it.
        const box = e.currentTarget.getBoundingClientRect();
        openSampleSourceMenu(trackId, dest, box.left, box.bottom);
      }}
    >
      <Icon name="upload" size={13} />
      {label}
    </button>
  );
}
