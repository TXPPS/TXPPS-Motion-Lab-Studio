import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useViewport } from '../../hooks/useViewport';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../pianoroll/PianoRoll';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { Icon } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';

type Combo = 'mixer' | 'piano' | 'synth';

const COMBOS: { id: Combo; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'piano', label: 'Piano Roll' },
  { id: 'synth', label: 'Instrument' },
];

/**
 * Tablet: the arrangement is primary, paired with exactly one bottom panel.
 * Side panels are drawers (one at a time) rather than persistent columns,
 * so browser + inspector + arrangement + editor never compete for width.
 *
 * Full screen removes the forced split: maximizing the editor gives a true
 * single-editor workflow (the combo bar stays, so Mixer/Piano/Instrument
 * switch while full screen); maximizing the arrangement hides the bottom
 * panel. The split restores exactly when full screen exits.
 */
export function TabletLayout() {
  const [combo, setCombo] = useState<Combo>('mixer');
  const [drawer, setDrawer] = useState<null | 'browser' | 'inspector'>(null);
  const { height } = useViewport();
  const maximized = useWorkspaceStore((s) => s.maximized);
  // Browser/inspector full screen only exists on desktop; tablet treats
  // those as the normal layout (its drawers already overlay everything).
  const maxi = maximized === 'arrange' || maximized === 'editor' ? maximized : null;
  // On short tablet landscape the bottom panel starts smaller so the
  // arrangement keeps a usable number of visible lanes.
  const defaultBottom = height < 820 ? 32 : 40;

  const editor = (
    <div className="editor-panel" data-testid="bottom-editor">
      <div className="editor-body">
        {combo === 'mixer' && <Mixer touch />}
        {combo === 'piano' && <PianoRoll />}
        {combo === 'synth' && <SynthPanel />}
      </div>
    </div>
  );

  return (
    <>
      <TransportBar />
      <div className="arr-toolbar" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <button className="btn" onClick={() => setDrawer('browser')} data-testid="tablet-browser">
          <Icon name="folder" size={13} /> Browser
        </button>
        <div className="seg" role="group" aria-label="Bottom panel" style={{ marginLeft: 4 }}>
          {COMBOS.map((c) => (
            <button
              key={c.id}
              className={combo === c.id ? 'on' : ''}
              aria-pressed={combo === c.id}
              onClick={() => setCombo(c.id)}
              data-testid={`combo-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <MaximizeButton pane="editor" label="editor" />
        <span className="spacer" style={{ flex: '1 1 auto' }} />
        <button
          className="btn"
          onClick={() => setDrawer('inspector')}
          data-testid="tablet-inspector"
        >
          <Icon name="wrench" size={13} /> Inspector
        </button>
      </div>

      <div className="workspace" data-testid="workspace">
        {maxi === 'editor' ? (
          <div className="pane pane-maxi" data-testid="maxi-editor">
            {editor}
          </div>
        ) : maxi === 'arrange' ? (
          <div className="pane pane-maxi" data-testid="maxi-arrange">
            <Arrangement />
          </div>
        ) : (
          <Group
            orientation="vertical"
            id="pane-tablet-stack"
            style={{ width: '100%', height: '100%' }}
          >
            <Panel id="pane-arrangement" minSize="160px" className="pane">
              <Arrangement />
            </Panel>
            <Separator className="resize-handle v" />
            <Panel
              id="pane-bottom"
              defaultSize={`${defaultBottom}%`}
              minSize="140px"
              maxSize="62%"
              className="pane"
            >
              {editor}
            </Panel>
          </Group>
        )}

        {drawer && (
          <>
            <div className="drawer-overlay" onClick={() => setDrawer(null)} />
            <aside className={`drawer side-panel ${drawer === 'browser' ? 'left' : 'right'}`}>
              <div className="panel-title">
                {drawer === 'browser' ? 'Browser' : 'Inspector'}
                <span className="spacer" style={{ flex: '1 1 auto' }} />
                <button
                  className="icon-btn"
                  onClick={() => setDrawer(null)}
                  aria-label="Close panel"
                >
                  <Icon name="x" size={15} />
                </button>
              </div>
              {drawer === 'browser' ? <BrowserPanel /> : <Inspector />}
            </aside>
          </>
        )}
      </div>
    </>
  );
}
