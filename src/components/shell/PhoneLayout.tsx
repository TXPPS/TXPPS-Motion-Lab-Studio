import { useUiStore, type PhoneMode } from '../../state/uiStore';
import { EditorSurface } from './EditorSurface';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { RecordWorkspace } from '../recording/RecordWorkspace';
import { Icon, type IconName } from '../common/Icon';

const NAV: { id: PhoneMode; label: string; icon: IconName }[] = [
  { id: 'arrange', label: 'Arrange', icon: 'wave' },
  { id: 'record', label: 'Record', icon: 'record' },
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
        {mode === 'record' && <RecordWorkspace />}
        {mode === 'perform' && <SynthPanel performMode />}
        {/*
          Every editor, not only the piano roll.
          
          `app/editors.ts` declares eight and this mounted one, so the drum
          editor, the score, the audio editor, the chord assistant and
          diagnostics were on a desktop and on no phone — which Directive 11 §5
          calls a missing function rather than a layout difference. The strip is
          the desktop's own, scrolling sideways under a thumb; the shared thing
          is the registry rather than the widget.
        */}
        {mode === 'edit' && <EditorSurface exclude={['mixer', 'synth']} />}
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
