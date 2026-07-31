import { useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useViewport } from '../../hooks/useViewport';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../pianoroll/PianoRoll';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { Icon } from '../common/Icon';

type Combo = 'mixer' | 'piano' | 'synth';

const COMBOS: { id: Combo; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'piano', label: 'Piano Roll' },
  { id: 'synth', label: 'Instrument' },
];

/**
 * Tablet: the arrangement is always primary, paired with exactly one bottom
 * panel. Side panels are drawers (one at a time) rather than persistent columns,
 * so browser + inspector + arrangement + editor never compete for width.
 */
export function TabletLayout() {
  const [combo, setCombo] = useState<Combo>('mixer');
  const [drawer, setDrawer] = useState<null | 'browser' | 'inspector'>(null);
  const { height } = useViewport();
  // On short tablet landscape the bottom panel starts smaller so the
  // arrangement keeps a usable number of visible lanes.
  const defaultBottom = height < 820 ? 32 : 40;

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
            <div className="editor-panel" data-testid="bottom-editor">
              <div className="editor-body">
                {combo === 'mixer' && <Mixer touch />}
                {combo === 'piano' && <PianoRoll />}
                {combo === 'synth' && <SynthPanel />}
              </div>
            </div>
          </Panel>
        </Group>

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
