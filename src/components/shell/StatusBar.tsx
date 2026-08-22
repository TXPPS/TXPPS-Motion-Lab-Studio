import { useEffect, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';
import {
  lockState,
  onLockChange,
  onRemoteSave,
  takeOver,
  type LockState,
} from '../../persistence/sessionLock';
import { GIT_COMMIT } from '../../diagnostics/report';
import { Icon } from '../common/Icon';
import { useViewport } from '../../hooks/useViewport';

/**
 * Whether this tab owns the project.
 *
 * A read-only tab is not broken and is not locked out of editing — it simply
 * cannot save over the tab that got there first, and it has to say so, because
 * silently discarding an afternoon's work is the worst thing this application
 * could do.
 */
function useSessionLock(): LockState {
  const [state, setState] = useState<LockState>(lockState());
  useEffect(() => {
    const stopLock = onLockChange(setState);
    const stopSave = onRemoteSave(() => {
      useUiStore
        .getState()
        .toast('error', 'The other tab just saved this project. Reload to see its version.');
    });
    return () => {
      stopLock();
      stopSave();
    };
  }, []);
  return state;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function StatusBar() {
  const audioState = useTransportStore((s) => s.audioState);
  const activeSources = useTransportStore((s) => s.activeSources);
  const sampleRate = useTransportStore((s) => s.sampleRate);
  const trackCount = useProjectStore((s) => s.project.tracks.length);
  const clipCount = useProjectStore((s) => s.project.clips.length);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const dirty = useProjectStore((s) => s.dirty);
  const online = useOnline();
  const lock = useSessionLock();
  // A phone's status bar is 360px and holds six items that refuse to shrink,
  // so the last three were cut off with nothing to scroll to. Two of them mean
  // nothing on a phone — the deployed commit and the live source count are
  // things you read at a desk — and the rest give way in order of how much
  // they matter.
  const phone = useViewport().layout === 'phone';

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="sb-item">
        <span
          className="dot"
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background:
              audioState === 'running'
                ? 'var(--accent)'
                : audioState === 'error'
                  ? 'var(--danger)'
                  : 'var(--text-faint)',
          }}
        />
        Audio: {audioState}
        {sampleRate ? ` · ${(sampleRate / 1000).toFixed(1)}kHz` : ''}
      </span>
      {!phone && <span className="sb-item">Sources: {activeSources}</span>}
      <span className="sb-item shrink">
        {trackCount} tracks · {clipCount} clips
      </span>
      <span className="spacer" />
      {lock === 'readonly' && (
        <button
          className="sb-item sb-readonly"
          title="Another tab has this project open, so this one is not autosaving. Take over to make this tab the writer; the other tab keeps working, read-only."
          onClick={() => void takeOver()}
          data-testid="take-over"
        >
          <Icon name="lock" size={11} /> Read-only — take over
        </button>
      )}
      <span className="sb-item">{online ? 'Online' : 'Offline'}</span>
      <span className="sb-item shrink">
        {dirty
          ? 'Unsaved'
          : lastSavedAt
            ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
            : '—'}
      </span>
      {!phone && (
        <span className="sb-item mono" title="Deployed git commit">
          {GIT_COMMIT}
        </span>
      )}
    </footer>
  );
}
