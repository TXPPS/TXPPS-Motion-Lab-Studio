import { useEffect } from 'react';
import { useUiStore } from '../../state/uiStore';
import { Icon, type IconName } from './Icon';

export const WELCOME_SEEN_KEY = 'txpps-motionlab-welcome-v1';

/**
 * First-run welcome: a compact orientation card, shown once (localStorage)
 * and reopenable from the overflow menu. Never auto-opens under automation
 * (navigator.webdriver) or on QA fixture routes.
 */
export function maybeShowWelcome(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (localStorage.getItem(WELCOME_SEEN_KEY)) return;
    if (typeof navigator !== 'undefined' && navigator.webdriver) return;
    if (window.location.hash.includes('qa')) return;
    useUiStore.getState().set({ welcomeOpen: true });
  } catch {
    /* storage blocked — skip the welcome rather than risk a boot error */
  }
}

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'play',
    title: 'Hear it now',
    body: 'Press Play — the demo project is ready. Space starts and stops the transport.',
  },
  {
    icon: 'grid',
    title: 'Arrange',
    body: 'Drag clips on the timeline, right-click for edit menus, and use the snap controls in the toolbar.',
  },
  {
    icon: 'piano',
    title: 'Play instruments',
    body: 'Open the Synth tab: on-screen keys, drum pads, samplers and racks. A–L keys play the armed track.',
  },
  {
    icon: 'record',
    title: 'Record & import',
    body: 'Arm an audio track to record from your microphone, or drop audio files straight onto the timeline.',
  },
  {
    icon: 'save',
    title: 'Your work stays here',
    body: 'Projects autosave to this browser (with a backup of the previous save). Export your mix as WAV anytime.',
  },
];

export function WelcomeSheet() {
  const open = useUiStore((s) => s.welcomeOpen);
  const close = () => {
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, String(Date.now()));
    } catch {
      /* storage blocked — the sheet simply shows again next boot */
    }
    useUiStore.getState().set({ welcomeOpen: false });
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay sc-center"
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="welcome-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to MotionLab Studio"
        data-testid="welcome-sheet"
      >
        <div className="welcome-head">
          <Icon name="logo" size={26} />
          <div>
            <div className="welcome-title">Welcome to MotionLab Studio</div>
            <div className="hint">A complete DAW in your browser — nothing to install.</div>
          </div>
        </div>
        <div className="welcome-grid">
          {STEPS.map((s) => (
            <div key={s.title} className="welcome-step">
              <Icon name={s.icon} size={16} />
              <div>
                <div className="welcome-step-title">{s.title}</div>
                <div className="welcome-step-body">{s.body}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="welcome-actions">
          <button
            className="btn"
            onClick={() => {
              close();
              useUiStore.getState().set({ shortcutsOpen: true });
            }}
          >
            Keyboard shortcuts
          </button>
          <button className="btn primary" onClick={close} data-testid="welcome-start">
            Start making music
          </button>
        </div>
      </div>
    </div>
  );
}
