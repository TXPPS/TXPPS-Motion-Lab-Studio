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

/**
 * Phone: exactly one primary workspace is mounted at a time, above a compact
 * transport and a persistent bottom navigation. No desktop panel splitting, and
 * the browser/inspector never appear alongside another mode.
 */
export function PhoneLayout() {
  const mode = useUiStore((s) => s.phoneMode);

  return (
    <>
      <TransportBar compact />
      <div
        className="workspace phone-main"
        data-testid={`phone-mode-${mode}`}
        data-phone-mode={mode}
      >
        {mode === 'arrange' && <Arrangement />}
        {mode === 'perform' && <SynthPanel performMode />}
        {mode === 'edit' && <PianoRoll />}
        {mode === 'mix' && <Mixer touch />}
        {mode === 'browse' && (
          <div className="browse-page">
            <div className="panel-title">Projects &amp; Library</div>
            <BrowserPanel />
            <div className="panel-title">Inspector</div>
            <Inspector />
          </div>
        )}
      </div>
    </>
  );
}

/** Rendered by the app shell as the bottom-most row, so it owns the safe area. */
export function PhoneNav() {
  const mode = useUiStore((s) => s.phoneMode);
  return (
    <nav className="bottomnav" data-testid="bottomnav" aria-label="Workspace">
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
  );
}
