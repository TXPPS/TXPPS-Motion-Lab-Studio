import { useWorkspaceStore, type MaximizedPane } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';

/**
 * Full-screen toggle for a workspace pane. The same control renders the
 * restore state while its pane is maximized, so exiting full screen is always
 * one tap in the same place.
 */
export function MaximizeButton({
  pane,
  label,
}: {
  pane: Exclude<MaximizedPane, null>;
  label: string;
}) {
  const on = useWorkspaceStore((s) => s.maximized === pane);
  return (
    <button
      className={`icon-btn${on ? ' on' : ''}`}
      onClick={() => useWorkspaceStore.getState().setMaximized(pane)}
      title={on ? 'Exit full screen' : `Full screen ${label}`}
      aria-label={on ? `Exit full screen ${label}` : `Full screen ${label}`}
      aria-pressed={on}
      data-testid={`maximize-${pane}`}
    >
      <Icon name={on ? 'restore' : 'maximize'} size={14} />
    </button>
  );
}
