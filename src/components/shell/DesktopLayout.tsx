import { Group, Panel, Separator } from 'react-resizable-panels';
import { PANE_LIMITS, useWorkspaceStore, type PaneId } from '../../state/workspaceStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { TransportBar } from '../transport/TransportBar';
import { BottomEditor } from './BottomEditor';
import { MaximizeButton } from './MaximizeButton';
import { CollapseButton, PaneRail } from './PaneRail';

/**
 * Desktop workstation.
 *
 * **Minimums come from `PANE_LIMITS` rather than from literals in this JSX.**
 * They were written twice — `minSize="180px"` here and `10` in the store's
 * clamp — and the two could disagree: a browser the store clamped to 40 % was
 * pushed back to 34 by the panel library on the next resize, and the store wrote
 * 34 back over the preference. One table, read by both.
 *
 * Any pane can go full screen (DAW-style): the docked layout's sizes and
 * visibility are left untouched while maximized, so restoring re-mounts the
 * exact previous arrangement of panels. A collapsed pane keeps a rail on screen
 * — see `PaneRail` for why a hide is not a collapse.
 */

/** A pane's panel props, all four of them derived from the one table. */
function limitsOf(id: PaneId) {
  const l = PANE_LIMITS[id];
  return { minSize: `${l.minPx}px`, maxSize: `${l.maxPercent}%` };
}

/** The title row every side panel carries: name, maximise, collapse. */
function SideTitle({ id, label }: { id: PaneId; label: string }) {
  return (
    <div className="panel-title">
      {label}
      <span className="spacer" style={{ flex: '1 1 auto' }} />
      <MaximizeButton pane={id} label={label.toLowerCase()} />
      <CollapseButton id={id} label={label.toLowerCase()} />
    </div>
  );
}

export function DesktopLayout() {
  const panes = useWorkspaceStore((s) => s.panes);
  const maximized = useWorkspaceStore((s) => s.maximized);
  const setPaneSize = useWorkspaceStore((s) => s.setPaneSize);
  /*
   * The panel library reads `defaultSize` at mount and owns the size after
   * that, so a recall that only wrote the store left every divider exactly where
   * it was — measured, a workspace saved with the inspector at 486 px recalled
   * to the 190 px it happened to be sitting at. Keying the group on the epoch
   * remounts it, which makes each pane read its stored size as its default
   * again. The store captures and restores the scroll positions across it, the
   * same way it does for maximise.
   */
  const epoch = useWorkspaceStore((s) => s.layoutEpoch);

  if (maximized) {
    return (
      <>
        <TransportBar />
        <div className="workspace" data-testid="workspace">
          <div className="pane pane-maxi" data-testid={`maxi-${maximized}`}>
            {maximized === 'arrange' && <Arrangement />}
            {maximized === 'editor' && <BottomEditor />}
            {maximized === 'browser' && (
              <aside className="side-panel maxi-panel" aria-label="Browser">
                <SideTitle id="browser" label="Browser" />
                <BrowserPanel />
              </aside>
            )}
            {maximized === 'inspector' && (
              <aside className="side-panel maxi-panel" aria-label="Inspector">
                <SideTitle id="inspector" label="Inspector" />
                <Inspector />
              </aside>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <TransportBar />
      <div className="workspace" data-testid="workspace">
        <Group
          key={epoch}
          orientation="horizontal"
          id="pane-main"
          style={{ width: '100%', height: '100%' }}
        >
          {panes.browser.visible &&
            (panes.browser.collapsed ? (
              <PaneRail id="browser" label="Browser" />
            ) : (
              <>
                <Panel
                  id="pane-browser"
                  defaultSize={`${panes.browser.size}%`}
                  {...limitsOf('browser')}
                  className="pane"
                  onResize={(size) => setPaneSize('browser', size.asPercentage)}
                >
                  <aside
                    className="side-panel left"
                    aria-label="Browser"
                    data-testid="browser-side"
                  >
                    <SideTitle id="browser" label="Browser" />
                    <BrowserPanel />
                  </aside>
                </Panel>
                <Separator className="resize-handle h" />
              </>
            ))}

          <Panel id="pane-center" minSize="320px" className="pane">
            <Group
              orientation="vertical"
              id="pane-center-stack"
              style={{ width: '100%', height: '100%' }}
            >
              <Panel id="pane-arrangement" minSize="180px" className="pane">
                <Arrangement />
              </Panel>
              {panes.editor.visible &&
                (panes.editor.collapsed ? (
                  <PaneRail id="editor" label="Editor" />
                ) : (
                  <>
                    <Separator className="resize-handle v" />
                    <Panel
                      id="pane-editor"
                      defaultSize={`${panes.editor.size}%`}
                      {...limitsOf('editor')}
                      className="pane"
                      onResize={(size) => setPaneSize('editor', size.asPercentage)}
                    >
                      <BottomEditor />
                    </Panel>
                  </>
                ))}
            </Group>
          </Panel>

          {panes.inspector.visible &&
            (panes.inspector.collapsed ? (
              <PaneRail id="inspector" label="Inspector" />
            ) : (
              <>
                <Separator className="resize-handle h" />
                <Panel
                  id="pane-inspector"
                  defaultSize={`${panes.inspector.size}%`}
                  {...limitsOf('inspector')}
                  className="pane"
                  onResize={(size) => setPaneSize('inspector', size.asPercentage)}
                >
                  <aside
                    className="side-panel right"
                    aria-label="Inspector"
                    data-testid="inspector-side"
                  >
                    <SideTitle id="inspector" label="Inspector" />
                    <Inspector />
                  </aside>
                </Panel>
              </>
            ))}
        </Group>
      </div>
    </>
  );
}
