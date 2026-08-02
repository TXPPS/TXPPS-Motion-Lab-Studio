import { useEffect, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { GIT_COMMIT } from '../../diagnostics/report';

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
      <span className="sb-item">Sources: {activeSources}</span>
      <span className="sb-item">
        {trackCount} tracks · {clipCount} clips
      </span>
      <span className="spacer" />
      <span className="sb-item">{online ? 'Online' : 'Offline'}</span>
      <span className="sb-item">
        {dirty
          ? 'Unsaved'
          : lastSavedAt
            ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
            : '—'}
      </span>
      <span className="sb-item mono" title="Deployed git commit">
        {GIT_COMMIT}
      </span>
    </footer>
  );
}
