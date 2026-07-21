import { useUiStore, type PhoneMode } from '../../state/uiStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../pianoroll/PianoRoll';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { Icon, type IconName } from '../common/Icon';

const NAV: { id: PhoneMode; label: string; icon: IconName }[] = [
  { id: 'arrange', label: 'Arrange', icon: 'wave' },
  { id: 'perform', label: 'Perform', icon: 'piano' },
  { id: 'edit', label: 'Edit', icon: 'note' },
  { id: 'mix', label: 'Mix', icon: 'mixer' },
  { id: 'browse', label: 'Browse', icon: 'folder' },
];

export function PhoneLayout() {
  const mode = useUiStore((s) => s.phoneMode);

  return (
    <>
      <TransportBar compact />
      <div className="phone-main" data-testid={`phone-mode-${mode}`}>
        {mode === 'arrange' && <Arrangement />}
        {mode === 'perform' && <SynthPanel performMode />}
        {mode === 'edit' && <PianoRoll />}
        {mode === 'mix' && (
          <div className="mix-page" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            <Mixer faderHeight={150} />
          </div>
        )}
        {mode === 'browse' && (
          <div className="browse-page">
            <div className="panel-title">Browser</div>
            <BrowserPanel />
            <div className="panel-title">Inspector</div>
            <Inspector />
          </div>
        )}
      </div>
      <nav className="bottomnav" data-testid="bottomnav">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={mode === n.id ? 'on' : ''}
            onClick={() => useUiStore.getState().set({ phoneMode: n.id })}
            data-testid={`nav-${n.id}`}
            aria-pressed={mode === n.id}
          >
            <Icon name={n.icon} size={19} />
            {n.label}
          </button>
        ))}
      </nav>
    </>
  );
}
