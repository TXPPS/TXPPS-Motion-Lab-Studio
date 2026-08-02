import { engine } from '../../audio/engine';
import { beatsToSeconds, formatPosition, formatTime } from '../../model/music';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { Meter } from '../common/widgets';
import { RecordButton } from '../recording/RecordControls';

export function AudioStatusChip({ compact }: { compact?: boolean }) {
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
  const full =
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
  const short = audioState === 'running' ? 'ON' : audioState === 'error' ? 'ERR' : 'START';
  return (
    <button
      className={`chip audio-chip ${cls}`}
      onClick={() => void engine.start()}
      title={full}
      aria-label={full}
      data-testid="audio-chip"
      data-audio-state={audioState}
    >
      <span className="dot" />
      <span className="chip-label">{compact ? short : full}</span>
    </button>
  );
}

/**
 * Transport. The compact variant used on phones carries a deliberately reduced
 * control set (transport buttons, position, tempo, audio state); metronome,
 * time signature and master volume move into the Mix workspace and the overflow
 * menu rather than being squeezed until they overlap.
 */
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

  const moreMenu = (x: number, y: number) =>
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        {
          label: `${metronome ? 'Disable' : 'Enable'} metronome`,
          action: () => setMetronome(!metronome),
        },
        {
          label: `${loop.enabled ? 'Disable' : 'Enable'} loop`,
          action: () => setLoop({ enabled: !loop.enabled }),
        },
        { label: 'Return to start', action: () => engine.returnToStart() },
        { label: 'Panic — stop all audio', danger: true, action: () => engine.panic() },
      ],
    });

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
          aria-pressed={playing}
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
        <RecordButton compact={compact} />
        {!compact && (
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
        )}
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
        <div className="t-cell pos">
          <span className="v" data-testid="pos-display">
            {formatPosition(positionBeats, timeSig)}
          </span>
          <span className="l">Bar.Beat</span>
        </div>
        {!compact && (
          <div className="t-cell time">
            <span className="v">{formatTime(beatsToSeconds(positionBeats, bpm))}</span>
            <span className="l">Time</span>
          </div>
        )}
        <div className="t-cell tempo">
          <input
            type="number"
            min={30}
            max={300}
            step={1}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value) || bpm)}
            aria-label="Tempo in beats per minute"
            data-testid="bpm-input"
          />
          <span className="l">BPM</span>
        </div>
        {!compact && (
          <div className="t-cell sig">
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
          <Meter meterId="master" />
        </div>
      )}

      <span className="spacer" />
      <AudioStatusChip compact={compact} />
      {compact && (
        <button
          className="icon-btn"
          onClick={(e) => moreMenu(e.clientX, e.clientY)}
          title="More transport options"
          aria-label="More transport options"
          data-testid="transport-more"
        >
          <Icon name="dots" size={16} />
        </button>
      )}
    </div>
  );
}
