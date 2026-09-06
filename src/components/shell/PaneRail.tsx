/**
 * A collapsed pane, drawn as a rail.
 *
 * Collapse used to be `showEditor: false` — the pane unmounted and the only way
 * back was the top bar's toggle or an F-key. That is a control that does nothing
 * on the form factor with no keyboard and no top-bar toggles, and the pane it
 * hid had no route at all on a phone.
 *
 * So a collapsed pane keeps a strip on screen carrying the one command that
 * matters: expand it again. The strip is `RAIL_PX` (44) on its constrained axis
 * because that is WCAG 2.5.8's minimum and the button fills it — a narrower rail
 * would be a pane you can collapse with a finger and never re-open with one.
 *
 * The label is written along the rail on a vertical one (a browser or inspector
 * column) and across it on a horizontal one, so the rail says which pane it is
 * rather than being an anonymous 44 px strip.
 */
import { PANE_LIMITS, useWorkspaceStore, type PaneId } from '../../state/workspaceStore';
import { Icon, type IconName } from '../common/Icon';

const ICON_OF: Record<PaneId, IconName> = {
  browser: 'panel-left',
  inspector: 'panel-right',
  editor: 'panel-bottom',
};

export function PaneRail({ id, label }: { id: PaneId; label: string }) {
  const axis = PANE_LIMITS[id].axis;
  return (
    <div
      className={`pane-rail pane-rail-${axis}`}
      data-testid={`rail-${id}`}
      data-pane={id}
      role="region"
      aria-label={`${label} (collapsed)`}
    >
      <button
        className="rail-expand"
        onClick={() => useWorkspaceStore.getState().toggleCollapsed(id)}
        title={`Expand ${label.toLowerCase()}`}
        aria-label={`Expand ${label.toLowerCase()}`}
        aria-expanded={false}
        data-testid={`rail-expand-${id}`}
      >
        <Icon name={ICON_OF[id]} size={15} />
        <span className="rail-label">{label}</span>
      </button>
    </div>
  );
}

/**
 * The control that collapses a pane, for the pane's own title row.
 *
 * Beside the maximise button rather than replacing the old hide chevron: hiding
 * a pane and collapsing it are different intentions — one says "not part of this
 * layout", the other "not right now, and give me the space back" — and a product
 * that offers only the first makes every temporary need permanent.
 */
/**
 * Which way the chevron points: toward the edge the pane collapses INTO.
 *
 * A browser on the left folds left and an inspector on the right folds right, so
 * one rule keyed on the axis would have sent the inspector's arrow back across
 * the workspace — an arrow that points at where the pane is not going is worse
 * than no arrow, because it is read.
 */
const FOLD_TOWARD: Record<PaneId, IconName> = {
  browser: 'chevron-left',
  inspector: 'chevron-right',
  editor: 'chevron-down',
};
const UNFOLD_TOWARD: Record<PaneId, IconName> = {
  browser: 'chevron-right',
  inspector: 'chevron-left',
  editor: 'chevron-up',
};

export function CollapseButton({ id, label }: { id: PaneId; label: string }) {
  const collapsed = useWorkspaceStore((s) => s.panes[id].collapsed);
  return (
    <button
      className="icon-btn"
      onClick={() => useWorkspaceStore.getState().toggleCollapsed(id)}
      title={collapsed ? `Expand ${label}` : `Collapse ${label} to a rail`}
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-expanded={!collapsed}
      data-testid={`collapse-${id}`}
    >
      <Icon name={collapsed ? UNFOLD_TOWARD[id] : FOLD_TOWARD[id]} size={15} />
    </button>
  );
}
