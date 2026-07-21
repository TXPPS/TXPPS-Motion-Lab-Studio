import { useState } from 'react';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../pianoroll/PianoRoll';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { Icon } from '../common/Icon';

type Combo = 'arr-mixer' | 'arr-piano' | 'arr-synth' | 'browse-insp';

const COMBOS: { id: Combo; label: string }[] = [
  { id: 'arr-mixer', label: 'Arrange + Mix' },
  { id: 'arr-piano', label: 'Arrange + Piano' },
  { id: 'arr-synth', label: 'Instrument' },
  { id: 'browse-insp', label: 'Browse + Edit' },
];

export function TabletLayout() {
  const [combo, setCombo] = useState<Combo>('arr-mixer');
  const [drawer, setDrawer] = useState<null | 'browser' | 'inspector'>(null);

  const bottom =
    combo === 'arr-mixer' ? (
      <Mixer faderHeight={110} />
    ) : combo === 'arr-piano' ? (
      <PianoRoll />
    ) : (
      <SynthPanel />
    );

  return (
    <>
      <TransportBar />
      <div className="arr-toolbar" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <button className="btn" onClick={() => setDrawer('browser')} data-testid="tablet-browser">
          <Icon name="folder" size={13} /> Browser
        </button>
        <div className="seg" role="group" aria-label="View combination" style={{ marginLeft: 4 }}>
          {COMBOS.map((c) => (
            <button
              key={c.id}
              className={combo === c.id ? 'on' : ''}
              onClick={() => setCombo(c.id)}
              data-testid={`combo-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button
          className="btn"
          onClick={() => setDrawer('inspector')}
          data-testid="tablet-inspector"
        >
          <Icon name="wrench" size={13} /> Inspector
        </button>
      </div>

      <div className="app-main">
        {combo === 'browse-insp' ? (
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <aside className="side-panel left" style={{ width: '45%' }}>
              <div className="panel-title">Browser</div>
              <BrowserPanel />
            </aside>
            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
              <Inspector />
            </div>
          </div>
        ) : (
          <div className="center-col">
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
              <Arrangement />
            </div>
            <div
              className="editor-panel"
              style={{
                height: combo === 'arr-synth' ? 'auto' : '46%',
                flex: combo === 'arr-synth' ? '0 0 auto' : undefined,
              }}
            >
              <div className="editor-body">{bottom}</div>
            </div>
          </div>
        )}

        {drawer && (
          <>
            <div className="drawer-overlay" onClick={() => setDrawer(null)} />
            <aside className={`drawer side-panel ${drawer === 'browser' ? 'left' : 'right'}`}>
              <div className="panel-title">
                {drawer === 'browser' ? 'Browser' : 'Inspector'}
                <span className="spacer" style={{ flex: 1 }} />
                <button className="icon-btn" onClick={() => setDrawer(null)} aria-label="Close">
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
