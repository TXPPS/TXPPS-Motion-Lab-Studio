import { useState } from 'react';
import { useUiStore } from '../../state/uiStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { TransportBar } from '../transport/TransportBar';
import { BottomEditor } from './BottomEditor';

export function DesktopLayout() {
  const panelBrowser = useUiStore((s) => s.panelBrowser);
  const panelInspector = useUiStore((s) => s.panelInspector);
  const panelEditor = useUiStore((s) => s.panelEditor);
  const [editorHeight, setEditorHeight] = useState(240);

  return (
    <>
      <TransportBar />
      <div className="app-main">
        {panelBrowser && (
          <aside className="side-panel left" data-testid="browser-side">
            <div className="panel-title">Browser</div>
            <BrowserPanel />
          </aside>
        )}
        <div className="center-col">
          <Arrangement />
          {panelEditor && <BottomEditor height={editorHeight} onResize={setEditorHeight} />}
        </div>
        {panelInspector && (
          <aside className="side-panel right" data-testid="inspector-side">
            <div className="panel-title">Inspector</div>
            <Inspector />
          </aside>
        )}
      </div>
    </>
  );
}
