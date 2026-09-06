import { useWorkspaceStore, type PhoneMode } from '../../state/workspaceStore';
import { EditorSurface } from './EditorSurface';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { RecordWorkspace } from '../recording/RecordWorkspace';
import { Icon, type IconName } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';

const NAV: { id: PhoneMode; label: string; icon: IconName }[] = [
  { id: 'arrange', label: 'Arrange', icon: 'wave' },
  { id: 'record', label: 'Record', icon: 'record' },
  { id: 'perform', label: 'Perform', icon: 'piano' },
  { id: 'edit', label: 'Edit', icon: 'note' },
  { id: 'mix', label: 'Mix', icon: 'mixer' },
  { id: 'browse', label: 'Browse', icon: 'folder' },
];

/**
 * What full screen means on a phone, and why the mapping is not the identity.
 *
 * A phone mode already fills the workspace, so "maximise the editor" cannot make
 * the editor bigger — what it can do is take away the two rows the phone spends
 * on chrome, the transport and the bottom navigation, which together are about
 * 100 px of an 844 px screen and the whole difference between four visible
 * lanes and six.
 *
 * So on a phone `maximized` means **immersive**: the mode's own surface, with
 * the transport and the navigation withdrawn. The way back is the rail — a strip
 * the surface keeps, carrying the restore control — for the same reason a
 * collapsed pane keeps one: a gesture that removes every route out of a state is
 * not a gesture, it is a trap, and a phone has no Escape key to rescue it.
 *
 * Which pane `maximized` names does not change the phone's picture, because a
 * phone shows one surface at a time either way. It is preserved rather than
 * cleared so that rotating a tablet into a phone and back does not lose it.
 */
const IMMERSIVE_RAIL_LABEL = 'Leave full screen';

export function PhoneLayout() {
  const mode = useWorkspaceStore((s) => s.phoneMode);
  const immersive = useWorkspaceStore((s) => s.maximized !== null);

  return (
    <>
      {!immersive && <TransportBar compact />}
      <div
        className={`workspace phone-main${immersive ? ' phone-immersive' : ''}`}
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
      {immersive && (
        <div className="phone-rail" data-testid="rail-immersive">
          <MaximizeButton pane="arrange" label={IMMERSIVE_RAIL_LABEL} />
        </div>
      )}
    </>
  );
}

/**
 * Rendered by the app shell as the bottom-most row, so it owns the safe area.
 *
 * Withdrawn while immersive, which is what makes full screen mean anything on a
 * phone — and the reason `PhoneLayout` draws a rail in its place rather than
 * simply taking the row away.
 */
export function PhoneNav() {
  const mode = useWorkspaceStore((s) => s.phoneMode);
  const immersive = useWorkspaceStore((s) => s.maximized !== null);
  if (immersive) return null;
  return (
    <nav className="bottomnav" data-testid="bottomnav" aria-label="Workspace">
      {NAV.map((n) => (
        <button
          key={n.id}
          className={mode === n.id ? 'on' : ''}
          onClick={() => useWorkspaceStore.getState().setPhoneMode(n.id)}
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
