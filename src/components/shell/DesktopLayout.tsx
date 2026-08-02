import { Group, Panel, Separator } from 'react-resizable-panels';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { TransportBar } from '../transport/TransportBar';
import { BottomEditor } from './BottomEditor';
import { MaximizeButton } from './MaximizeButton';

/**
 * Desktop workstation. Minimums are expressed in pixels so the arrangement
 * always keeps a usable central width — the side panels stop shrinking (and can
 * be collapsed from the project bar) before the centre becomes unusable.
 *
 * Any pane can go full screen (DAW-style): the docked layout's sizes and
 * visibility are left untouched while maximized, so restoring re-mounts the
 * exact previous arrangement of panels.
 */
export function DesktopLayout() {
  const showBrowser = useWorkspaceStore((s) => s.showBrowser);
  const showInspector = useWorkspaceStore((s) => s.showInspector);
  const showEditor = useWorkspaceStore((s) => s.showEditor);
  const browserSize = useWorkspaceStore((s) => s.browserSize);
  const inspectorSize = useWorkspaceStore((s) => s.inspectorSize);
  const editorSize = useWorkspaceStore((s) => s.editorSize);
  const maximized = useWorkspaceStore((s) => s.maximized);
  const setSizes = useWorkspaceStore((s) => s.setSizes);

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
                <div className="panel-title">
                  Browser
                  <span className="spacer" style={{ flex: '1 1 auto' }} />
                  <MaximizeButton pane="browser" label="browser" />
                </div>
                <BrowserPanel />
              </aside>
            )}
            {maximized === 'inspector' && (
              <aside className="side-panel maxi-panel" aria-label="Inspector">
                <div className="panel-title">
                  Inspector
                  <span className="spacer" style={{ flex: '1 1 auto' }} />
                  <MaximizeButton pane="inspector" label="inspector" />
                </div>
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
        <Group orientation="horizontal" id="pane-main" style={{ width: '100%', height: '100%' }}>
          {showBrowser && (
            <>
              <Panel
                id="pane-browser"
                defaultSize={`${browserSize}%`}
                minSize="180px"
                maxSize="34%"
                className="pane"
                onResize={(size) => setSizes({ browserSize: size.asPercentage })}
              >
                <aside className="side-panel left" aria-label="Browser" data-testid="browser-side">
                  <div className="panel-title">
                    Browser
                    <span className="spacer" style={{ flex: '1 1 auto' }} />
                    <MaximizeButton pane="browser" label="browser" />
                  </div>
                  <BrowserPanel />
                </aside>
              </Panel>
              <Separator className="resize-handle h" />
            </>
          )}

          <Panel id="pane-center" minSize="320px" className="pane">
            <Group
              orientation="vertical"
              id="pane-center-stack"
              style={{ width: '100%', height: '100%' }}
            >
              <Panel id="pane-arrangement" minSize="180px" className="pane">
                <Arrangement />
              </Panel>
              {showEditor && (
                <>
                  <Separator className="resize-handle v" />
                  <Panel
                    id="pane-editor"
                    defaultSize={`${editorSize}%`}
                    minSize="150px"
                    maxSize="68%"
                    className="pane"
                    onResize={(size) => setSizes({ editorSize: size.asPercentage })}
                  >
                    <BottomEditor />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>

          {showInspector && (
            <>
              <Separator className="resize-handle h" />
              <Panel
                id="pane-inspector"
                defaultSize={`${inspectorSize}%`}
                minSize="190px"
                maxSize="34%"
                className="pane"
                onResize={(size) => setSizes({ inspectorSize: size.asPercentage })}
              >
                <aside
                  className="side-panel right"
                  aria-label="Inspector"
                  data-testid="inspector-side"
                >
                  <div className="panel-title">
                    Inspector
                    <span className="spacer" style={{ flex: '1 1 auto' }} />
                    <MaximizeButton pane="inspector" label="inspector" />
                  </div>
                  <Inspector />
                </aside>
              </Panel>
            </>
          )}
        </Group>
      </div>
    </>
  );
}
