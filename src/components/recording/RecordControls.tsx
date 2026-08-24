import { useEffect } from 'react';
import { engine } from '../../audio/engine';
import { audioInput, DEFAULT_INPUT } from '../../audio/inputManager';
import { recording } from '../../audio/recordingController';
import { getCountInBars, recordTargetTrack, setCountInBars } from '../../audio/takePlan';
import { recorderSupported } from '../../audio/recorder';
import { useInputStore, permissionLabel } from '../../state/inputStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

/** Live input level meter, driven by the engine frame loop (no React churn). */
export function InputMeter({ trackId, tall }: { trackId: string | null; tall?: boolean }) {
  useEffect(() => {
    if (!trackId) return;
    const el = document.querySelector<HTMLElement>(`[data-input-meter="${trackId}"] .im-fill`);
    if (!el) return;
    return engine.onFrame(() => {
      const level = engine.inputLevel(trackId);
      el.style.transform = `scaleX(${Math.min(1, level * 1.6)})`;
      el.dataset.hot = level > 0.92 ? 'true' : 'false';
    });
  }, [trackId]);

  return (
    <div
      className={`input-meter${tall ? ' tall' : ''}`}
      data-input-meter={trackId ?? ''}
      data-testid="input-meter"
      aria-hidden="true"
    >
      <div className="im-fill" />
    </div>
  );
}

/**
 * Record button + count-in state, used by the desktop and phone transports.
 * `big` is the phone workspace's primary control and carries a text label.
 */
export function RecordButton({ compact, big }: { compact?: boolean; big?: boolean }) {
  const phase = useInputStore((s) => s.phase);
  const seconds = useInputStore((s) => s.recordSeconds);
  const countIn = useInputStore((s) => s.countInBeatsLeft);
  // MIDI recording needs no MediaRecorder and no microphone, so an armed
  // instrument track makes the button live even where audio capture is not
  // available at all.
  const midiArmed = useProjectStore((s) =>
    s.project.tracks.some((t) => t.armed && (t.type === 'instrument' || t.type === 'drum')),
  );
  const supported = recorderSupported() || midiArmed;

  const isRecording = phase === 'recording';
  const isCountIn = phase === 'countIn';
  const busy = phase === 'arming' || phase === 'finalizing';

  const onClick = () => {
    if (isRecording || isCountIn) void recording.stop();
    else if (!busy) void recording.start();
  };

  const label = isRecording
    ? `Stop recording (${seconds.toFixed(1)}s elapsed)`
    : isCountIn
      ? `Count-in, ${countIn} beats remaining — click to cancel`
      : supported
        ? midiArmed
          ? 'Record MIDI'
          : 'Record'
        : 'Audio recording is not supported in this browser — arm an instrument track to record MIDI';

  return (
    <button
      className={`t-btn rec${isRecording ? ' rec-on' : ''}${isCountIn ? ' rec-count' : ''}`}
      onClick={onClick}
      disabled={!supported || busy}
      title={label}
      aria-label={label}
      aria-pressed={isRecording}
      data-testid="btn-record"
      data-phase={phase}
    >
      {isCountIn ? (
        <span className="count-in-num">{countIn}</span>
      ) : (
        <Icon name="record" size={big ? 22 : 16} />
      )}
      {/* The oversized phone control carries a word: a bare dot on a 66px
          button reads as decoration rather than the primary action. */}
      {big && !isCountIn && (
        <span className="rec-word">{isRecording ? 'Stop' : busy ? 'Please wait' : 'Record'}</span>
      )}
      {big && isCountIn && <span className="rec-word">Cancel</span>}
      {!compact && isRecording && <span className="rec-time">{seconds.toFixed(1)}s</span>}
    </button>
  );
}

/**
 * Per-track input selection, arm and monitor. Rendered in the desktop inspector
 * and in the phone Record workspace.
 */
export function TrackInputControls({ trackId }: { trackId: string }) {
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === trackId));
  const setTrack = useProjectStore((s) => s.setTrack);
  const permission = useInputStore((s) => s.permission);
  const devices = useInputStore((s) => s.devices);
  const lastError = useInputStore((s) => s.lastError);
  const phase = useInputStore((s) => s.phase);

  useEffect(() => {
    void audioInput.probePermission();
  }, []);

  if (!track || track.type !== 'audio') {
    return <div className="hint">Select an audio track to record onto.</div>;
  }

  const deviceId = track.inputDeviceId || DEFAULT_INPUT;
  const monitoring = engine.isMonitoring(trackId);
  const granted = permission === 'granted';
  const busy = phase === 'recording' || phase === 'countIn';

  const requestAccess = async () => {
    const ok = await audioInput.requestPermission();
    if (!ok) {
      useUiStore
        .getState()
        .toast('error', useInputStore.getState().lastError ?? 'Microphone access was not granted.');
    }
  };

  const toggleMonitor = async () => {
    if (monitoring) {
      engine.stopMonitoring(trackId);
      setTrack(trackId, { monitoring: false });
      return;
    }
    if (!granted && !(await audioInput.requestPermission())) {
      useUiStore.getState().toast('error', 'Microphone access is required to monitor input.');
      return;
    }
    const ok = await engine.startMonitoring(trackId, deviceId);
    setTrack(trackId, { monitoring: ok });
    if (!ok) {
      useUiStore
        .getState()
        .toast('error', useInputStore.getState().lastError ?? 'Could not open the input.');
    } else {
      useUiStore
        .getState()
        .toast('info', 'Monitoring on — use headphones to avoid feedback into the microphone.');
    }
  };

  return (
    <div className="rec-controls" data-testid="track-input-controls">
      <div className="ps-title">Input</div>

      {permission !== 'granted' && (
        <div className="rec-permission" data-testid="permission-state">
          <div className="hint">Microphone: {permissionLabel(permission)}</div>
          {permission === 'denied' ? (
            <div className="hint warn-text">
              Access was blocked. Enable the microphone for this site in your browser settings, then
              reload.
            </div>
          ) : permission === 'unavailable' ? (
            <div className="hint warn-text">
              This browser cannot capture audio input on this connection.
            </div>
          ) : (
            <button className="btn primary" onClick={requestAccess} data-testid="request-mic">
              Allow microphone
            </button>
          )}
          {lastError && <div className="hint warn-text">{lastError}</div>}
        </div>
      )}

      <label className="insp-row">
        <span className="k">Device</span>
        <select
          value={deviceId}
          disabled={busy}
          aria-label="Audio input device"
          data-testid="input-device"
          onChange={(e) => {
            const next = e.target.value;
            if (monitoring) engine.stopMonitoring(trackId);
            setTrack(trackId, { inputDeviceId: next });
            if (monitoring) void engine.startMonitoring(trackId, next);
          }}
        >
          <option value={DEFAULT_INPUT}>Default input</option>
          {devices
            .filter((d) => d.deviceId !== DEFAULT_INPUT)
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
        </select>
      </label>

      <div className="rec-buttons">
        <button
          className={`btn${track.armed ? ' armed' : ''}`}
          onClick={() => setTrack(trackId, { armed: !track.armed })}
          disabled={busy}
          aria-pressed={track.armed}
          title="Record arm"
          data-testid="arm-track"
        >
          <span className="arm-dot" aria-hidden />
          {track.armed ? 'Armed' : 'Arm'}
        </button>
        <button
          className={`btn${monitoring ? ' monitoring' : ''}`}
          onClick={() => void toggleMonitor()}
          aria-pressed={monitoring}
          title="Input monitoring"
          data-testid="monitor-track"
        >
          <Icon name="wave" size={13} />
          {monitoring ? 'Monitoring' : 'Monitor'}
        </button>
      </div>

      <InputMeter trackId={monitoring ? trackId : null} />

      <label className="insp-row">
        <span className="k">Count-in</span>
        <select
          defaultValue={String(getCountInBars())}
          aria-label="Count-in bars"
          data-testid="count-in-bars"
          onChange={(e) => setCountInBars(Number(e.target.value))}
        >
          <option value="0">Off</option>
          <option value="1">1 bar</option>
          <option value="2">2 bars</option>
        </select>
      </label>
    </div>
  );
}

/** Banner shown while a take is being captured or counted in. */
export function RecordingBanner() {
  const phase = useInputStore((s) => s.phase);
  const seconds = useInputStore((s) => s.recordSeconds);
  const countIn = useInputStore((s) => s.countInBeatsLeft);
  const error = useInputStore((s) => s.lastRecordError);
  const trackId = useInputStore((s) => s.recordTrackId);
  const trackName = useProjectStore(
    (s) => s.project.tracks.find((t) => t.id === trackId)?.name ?? '',
  );

  if (phase === 'idle' && !error) return null;
  if (phase === 'idle' && error) {
    return (
      <div className="rec-banner error" role="status" data-testid="record-banner">
        <Icon name="x" size={13} /> {error}
        <button
          className="icon-btn"
          aria-label="Dismiss"
          onClick={() => useInputStore.getState().set({ lastRecordError: null })}
        >
          <Icon name="x" size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`rec-banner${phase === 'recording' ? ' live' : ''}`}
      role="status"
      aria-live="polite"
      data-testid="record-banner"
    >
      <span className="rec-dot" aria-hidden />
      {phase === 'countIn'
        ? `Count-in — ${countIn}`
        : phase === 'recording'
          ? `Recording ${trackName} · ${seconds.toFixed(1)}s`
          : phase === 'arming'
            ? 'Opening input…'
            : 'Finishing take…'}
      <button className="btn danger" onClick={() => recording.cancel()} data-testid="cancel-record">
        Cancel
      </button>
    </div>
  );
}

/** Compact "what did I just record" review shown after a take. */
export function TakeReview() {
  const take = useInputStore((s) => s.lastTake);
  const phase = useInputStore((s) => s.phase);
  const store = useProjectStore;
  if (!take || phase !== 'idle') return null;

  return (
    <div className="take-review" data-testid="take-review">
      <div className="tr-title">Last take</div>
      <div className="tr-meta">
        {take.name} · {take.durationSec.toFixed(1)}s · {(take.bytes / 1024).toFixed(0)} KB
      </div>
      <div className="tr-actions">
        <button
          className="btn"
          onClick={() => {
            engine.seek(
              store.getState().project.clips.find((c) => c.id === take.clipId)?.start ?? 0,
            );
            void engine.play();
          }}
          data-testid="play-take"
        >
          <Icon name="play" size={12} /> Play
        </button>
        <button
          className="btn"
          onClick={() =>
            useUiStore.getState().showDialog({
              kind: 'prompt',
              title: 'Rename take',
              initialValue: take.name,
              confirmLabel: 'Rename',
              onSubmit: (v) => v && store.getState().setClip(take.clipId, { name: v }),
            })
          }
        >
          Rename
        </button>
        <button
          className="btn danger"
          onClick={() => {
            store.getState().deleteClip(take.clipId);
            useInputStore.getState().set({ lastTake: null });
          }}
          data-testid="delete-take"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** True when a recordable audio track exists — gates the record affordances. */
export function useHasRecordTarget(): boolean {
  const tracks = useProjectStore((s) => s.project.tracks);
  return tracks.some((t) => t.type === 'audio');
}

export { recordTargetTrack };
