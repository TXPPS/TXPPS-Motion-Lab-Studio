import { Group, Panel, Separator } from 'react-resizable-panels';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { TransportBar } from '../transport/TransportBar';
import { BottomEditor } from './BottomEditor';

/**
 * Desktop workstation. Minimums are expressed in pixels so the arrangement
 * always keeps a usable central width — the side panels stop shrinking (and can
 * be collapsed from the project bar) before the centre becomes unusable.
 */
export function DesktopLayout() {
  const showBrowser = useWorkspaceStore((s) => s.showBrowser);
  const showInspector = useWorkspaceStore((s) => s.showInspector);
  const showEditor = useWorkspaceStore((s) => s.showEditor);
  const browserSize = useWorkspaceStore((s) => s.browserSize);
  const inspectorSize = useWorkspaceStore((s) => s.inspectorSize);
  const editorSize = useWorkspaceStore((s) => s.editorSize);
  const setSizes = useWorkspaceStore((s) => s.setSizes);

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
                <aside className="side-panel left" data-testid="browser-side">
                  <div className="panel-title">Browser</div>
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
                <aside className="side-panel right" data-testid="inspector-side">
                  <div className="panel-title">Inspector</div>
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
