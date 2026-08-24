/**
 * Audio and MIDI setup — Directive 09 §2.4.
 *
 * The device settings were scattered: the input device lived in the track
 * inspector, the MIDI device in the instrument panel, and neither was in
 * preferences at all. A musician sitting down with a new interface had nowhere
 * to go.
 *
 * Every row says whether it takes effect now or needs the engine restarting,
 * and where the browser simply will not do the thing — choosing an output on
 * anything but Chromium, setting a buffer size anywhere — it says that instead
 * of offering a control that does nothing.
 */
import { useEffect, useState } from 'react';
import { engine } from '../../audio/engine';
import { audioInput } from '../../audio/inputManager';
import { midi } from '../../audio/midi';
import { useInputStore, permissionLabel } from '../../state/inputStore';
import { usePrefsStore, RATES } from '../../state/prefsStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span>{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

/** Milliseconds, to one decimal — the resolution a player can actually feel. */
function ms(seconds: number): string {
  return `${(seconds * 1000).toFixed(1)} ms`;
}

export function AudioSetup() {
  const prefs = usePrefsStore();
  const set = usePrefsStore((s) => s.set);
  const devices = useInputStore((s) => s.devices);
  const permission = useInputStore((s) => s.permission);
  const sampleRate = useTransportStore((s) => s.sampleRate);
  const audioState = useTransportStore((s) => s.audioState);
  const midiInputs = useTransportStore((s) => s.midiInputs);
  const midiSelectedId = useTransportStore((s) => s.midiSelectedId);
  const midiSupported = useTransportStore((s) => s.midiSupported);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    void audioInput.probePermission();
  }, []);

  const latency = engine.latency();
  const canChooseOutput = engine.canChooseOutput();
  // The engine has to be rebuilt for these two, so the sheet has to say so
  // rather than let a user change a number and wonder why nothing moved.
  const pendingRestart =
    audioState === 'running' && prefs.sampleRate > 0 && sampleRate !== prefs.sampleRate;

  const restart = async () => {
    setRestarting(true);
    const ok = await engine.restart();
    // The readouts below re-render off `audioState`, which the restart moves
    // through 'uninitialized' and back to 'running' — no local counter needed.
    setRestarting(false);
    useUiStore
      .getState()
      .toast(ok ? 'info' : 'error', ok ? 'Audio engine restarted.' : 'The engine did not restart.');
  };

  return (
    <>
      <Row label="Microphone" hint="Requested only when you arm or monitor a track">
        <span className="t-num" data-testid="mic-permission">
          {permissionLabel(permission)}
        </span>
      </Row>

      <Row label="Default input" hint="What a new audio track starts on">
        <select
          value={prefs.defaultInputDeviceId}
          aria-label="Default audio input"
          data-testid="pref-input-device"
          onChange={(e) => set({ defaultInputDeviceId: e.target.value })}
        >
          <option value="">System default</option>
          {devices
            .filter((d) => d.deviceId !== 'default')
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
        </select>
      </Row>

      <Row
        label="Output"
        hint={
          canChooseOutput
            ? 'Takes effect on the next engine start'
            : 'This browser leaves the output to the operating system'
        }
      >
        {canChooseOutput ? (
          <select
            value={prefs.outputDeviceId}
            aria-label="Audio output"
            data-testid="pref-output-device"
            onChange={(e) => set({ outputDeviceId: e.target.value })}
          >
            <option value="">System default</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="t-num">system default</span>
        )}
      </Row>

      <Row label="Sample rate" hint="Chosen when the engine starts; the device may refuse it">
        <select
          value={String(prefs.sampleRate)}
          aria-label="Sample rate"
          data-testid="pref-sample-rate"
          onChange={(e) => set({ sampleRate: Number(e.target.value) })}
        >
          {RATES.map((r) => (
            <option key={r} value={String(r)}>
              {r === 0 ? 'Browser default' : `${(r / 1000).toFixed(1)} kHz`}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Latency" hint="Web Audio has no buffer size; this is the nearest thing it offers">
        <select
          value={prefs.latencyHint}
          aria-label="Latency preference"
          data-testid="pref-latency-hint"
          onChange={(e) => set({ latencyHint: e.target.value as typeof prefs.latencyHint })}
        >
          <option value="interactive">Lowest — for playing in</option>
          <option value="balanced">Balanced</option>
          <option value="playback">Most robust — for mixing</option>
        </select>
      </Row>

      <Row label="Running at" hint="What the engine actually got, not what was asked for">
        <span className="t-num" data-testid="engine-readout">
          {audioState === 'running' && sampleRate
            ? `${(sampleRate / 1000).toFixed(1)} kHz`
            : 'not started'}
          {latency && latency.total > 0 ? ` · ${ms(latency.total)} round trip` : ''}
        </span>
      </Row>

      {latency && latency.total > 0 && (
        <Row label="Where the latency is" hint="Graph buffering, then the device after it">
          <span className="t-num" data-testid="latency-breakdown">
            {ms(latency.base)} engine
            {latency.output > 0 ? ` · ${ms(latency.output)} output` : ' · output not reported'}
          </span>
        </Row>
      )}

      <Row
        label="Engine"
        hint={
          pendingRestart
            ? 'The sample rate you chose needs a restart to take effect'
            : 'Rebuilds the audio graph from the project'
        }
      >
        <button
          className={`btn${pendingRestart ? ' primary' : ''}`}
          onClick={() => void restart()}
          disabled={restarting}
          data-testid="restart-engine"
        >
          {restarting ? 'Restarting…' : 'Restart audio engine'}
        </button>
      </Row>

      <Row label="MIDI input" hint={midiSupported ? undefined : 'This browser has no Web MIDI'}>
        {midiSupported ? (
          <select
            value={midiSelectedId ?? ''}
            aria-label="MIDI input device"
            data-testid="pref-midi-device"
            onChange={(e) => midi.select(e.target.value || null)}
          >
            <option value="">All inputs</option>
            {midiInputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="t-num">unavailable</span>
        )}
      </Row>
    </>
  );
}
