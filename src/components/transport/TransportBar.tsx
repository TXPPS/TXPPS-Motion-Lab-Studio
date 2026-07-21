import { engine } from '../../audio/engine';
import { beatsToSeconds, formatPosition, formatTime } from '../../model/music';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { Icon } from '../common/Icon';
import { Meter } from '../common/widgets';

export function AudioStatusChip() {
  const audioState = useTransportStore((s) => s.audioState);
  const sampleRate = useTransportStore((s) => s.sampleRate);
  const cls =
    audioState === 'running'
      ? 'ok'
      : audioState === 'error'
        ? 'err'
        : audioState === 'uninitialized'
          ? ''
          : 'warn';
  const label =
    audioState === 'running'
      ? `Audio Running${sampleRate ? ` · ${(sampleRate / 1000).toFixed(1)}k` : ''}`
      : audioState === 'uninitialized'
        ? 'Start Audio'
        : audioState === 'starting'
          ? 'Starting…'
          : audioState === 'suspended'
            ? 'Audio Suspended — tap'
            : audioState === 'interrupted'
              ? 'Interrupted — tap'
              : 'Audio Error — retry';
  return (
    <button
      className={`chip audio-chip ${cls}`}
      onClick={() => void engine.start()}
      title="Audio engine state — click to start/resume"
      data-testid="audio-chip"
      data-audio-state={audioState}
    >
      <span className="dot" />
      {label}
    </button>
  );
}

export function TransportBar({ compact }: { compact?: boolean }) {
  const playState = useTransportStore((s) => s.playState);
  const positionBeats = useTransportStore((s) => s.positionBeats);
  const bpm = useProjectStore((s) => s.project.bpm);
  const timeSig = useProjectStore((s) => s.project.timeSig);
  const loop = useProjectStore((s) => s.project.loop);
  const metronome = useProjectStore((s) => s.project.metronome);
  const masterVolume = useProjectStore((s) => s.project.masterVolume);
  const setBpm = useProjectStore((s) => s.setBpm);
  const setTimeSig = useProjectStore((s) => s.setTimeSig);
  const setLoop = useProjectStore((s) => s.setLoop);
  const setMetronome = useProjectStore((s) => s.setMetronome);
  const setMasterVolume = useProjectStore((s) => s.setMasterVolume);

  const playing = playState === 'playing';

  return (
    <div className={`transport${compact ? ' compact' : ''}`} data-testid="transport">
      <div className="t-btns">
        <button
          className="t-btn"
          onClick={() => engine.returnToStart()}
          title="Return to start"
          aria-label="Return to start"
          data-testid="btn-rts"
        >
          <Icon name="skipback" size={16} />
        </button>
        <button
          className={`t-btn${playing ? ' play-on' : ''}`}
          onClick={() => void engine.play()}
          title="Play (Space)"
          aria-label="Play"
          data-testid="btn-play"
        >
          <Icon name="play" size={18} />
        </button>
        <button
          className="t-btn"
          onClick={() => engine.stop()}
          title="Stop (Space) — press twice to return to start"
          aria-label="Stop"
          data-testid="btn-stop"
        >
          <Icon name="stop" size={16} />
        </button>
        <button
          className={`t-btn${loop.enabled ? ' loop-on' : ''}`}
          onClick={() => setLoop({ enabled: !loop.enabled })}
          title="Toggle loop"
          aria-label="Loop"
          aria-pressed={loop.enabled}
          data-testid="btn-loop"
        >
          <Icon name="loop" size={15} />
        </button>
        {!compact && (
          <button
            className={`t-btn${metronome ? ' metro-on' : ''}`}
            onClick={() => setMetronome(!metronome)}
            title="Metronome"
            aria-label="Metronome"
            aria-pressed={metronome}
            data-testid="btn-metronome"
          >
            <Icon name="metronome" size={15} />
          </button>
        )}
      </div>

      <div className="t-display">
        <div className="t-cell">
          <span className="v" data-testid="pos-display">
            {formatPosition(positionBeats, timeSig)}
          </span>
          <span className="l">Bar.Beat</span>
        </div>
        <div className="t-cell">
          <span className="v">{formatTime(beatsToSeconds(positionBeats, bpm))}</span>
          <span className="l">Time</span>
        </div>
        <div className="t-cell">
          <input
            type="number"
            min={30}
            max={300}
            step={1}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value) || bpm)}
            aria-label="Tempo (BPM)"
            data-testid="bpm-input"
          />
          <span className="l">BPM</span>
        </div>
        {!compact && (
          <div className="t-cell">
            <select
              value={`${timeSig.num}/${timeSig.den}`}
              onChange={(e) => {
                const [n, d] = e.target.value.split('/').map(Number);
                setTimeSig(n, d);
              }}
              aria-label="Time signature"
            >
              {['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="l">Sig</span>
          </div>
        )}
      </div>

      {!compact && (
        <div className="t-master">
          <Icon name="wave" size={14} />
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={masterVolume}
            onChange={(e) => setMasterVolume(Number(e.target.value))}
            aria-label="Master volume"
            data-testid="master-volume"
          />
          <Meter meterId="master" height={36} />
        </div>
      )}

      <div className="spacer" style={{ flex: 1 }} />
      <AudioStatusChip />
    </div>
  );
}
