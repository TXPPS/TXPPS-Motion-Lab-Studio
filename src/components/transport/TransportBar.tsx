import { useCallback, useEffect, useRef, useState } from 'react';
import { clickGain, engine } from '../../audio/engine';
import { projectBeatToSec, tempoMapOf } from '../../model/music';
import { barToBeat, beatToBar, formatBBT, formatClock, parseBBT } from '../../model/tempo';
import { nextMarker, prevMarker } from '../../model/arrangement';
import { useProjectStore } from '../../state/projectStore';
import { useTransportStore } from '../../state/transportStore';
import { useUiStore } from '../../state/uiStore';
import { usePrefsStore } from '../../state/prefsStore';
import { Icon } from '../common/Icon';
import { Meter } from '../common/widgets';
import { RecordButton } from '../recording/RecordControls';

export function AudioStatusChip({ compact }: { compact?: boolean }) {
  const audioState = useTransportStore((s) => s.audioState);
  const sampleRate = useTransportStore((s) => s.sampleRate);
  const pdcSamples = useTransportStore((s) => s.pdcSamples);
  const cls =
    audioState === 'running'
      ? 'ok'
      : audioState === 'error'
        ? 'err'
        : audioState === 'uninitialized'
          ? ''
          : 'warn';
  /**
   * Latency, shown only when there is some.
   *
   * In milliseconds rather than samples: it is a number a musician judges
   * against their own playing, and 4 ms means something where 192 samples means
   * something only once you have divided it by a rate you would then have to go
   * and read. The sample count is in the tooltip for whoever wants it.
   *
   * Zero is not displayed. A permanent "0 ms" is a light that is always on,
   * which is a light nobody reads — and this one has to be noticed on the day
   * it stops saying zero.
   */
  const latency =
    pdcSamples > 0 && sampleRate ? `${((pdcSamples / sampleRate) * 1000).toFixed(1)} ms` : null;
  const full =
    audioState === 'running'
      ? `Audio Running${sampleRate ? ` · ${(sampleRate / 1000).toFixed(1)}k` : ''}${
          latency ? ` · ${latency}` : ''
        }`
      : audioState === 'uninitialized'
        ? 'Start Audio'
        : audioState === 'starting'
          ? 'Starting…'
          : audioState === 'suspended'
            ? 'Audio Suspended — tap'
            : audioState === 'interrupted'
              ? 'Interrupted — tap'
              : 'Audio Error — retry';
  /**
   * On the phone bar the chip is a lamp, and a word only while the word is an
   * instruction. Once audio is running the colour says everything the label
   * did, and the pixels are worth more to the position readout beside it —
   * but "audio has not started" is a thing the user must act on, so that state
   * keeps a word they can read rather than an abbreviation clipped to "STA…".
   */
  const short =
    audioState === 'running' || audioState === 'starting'
      ? null
      : audioState === 'error'
        ? 'Retry'
        : 'Start';
  const label = compact ? short : full;
  return (
    <button
      className={`chip audio-chip ${cls}`}
      onClick={() => void engine.start()}
      title={
        latency
          ? `${full} — ${pdcSamples} samples of plug-in delay compensation on every channel`
          : full
      }
      aria-label={full}
      data-testid="audio-chip"
      data-audio-state={audioState}
      data-pdc-samples={pdcSamples}
    >
      <span className="dot" />
      {label && <span className="chip-label">{label}</span>}
    </button>
  );
}

/**
 * The main position readout.
 *
 * Written straight into the DOM from the engine's animation frame rather than
 * through React state: at 60 fps a re-rendering transport would re-render the
 * whole bar (and everything selecting from the same store) sixty times a
 * second for two changing strings.
 */
function PositionDisplay({ compact }: { compact?: boolean }) {
  const bbtRef = useRef<HTMLSpanElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const [editing, setEditing] = useState(false);
  const primary = usePrefsStore((s) => s.primaryTimeDisplay);

  useEffect(() => {
    if (editing) return;
    const write = () => {
      const project = useProjectStore.getState().project;
      const beat = engine.getPositionBeats();
      const map = tempoMapOf(project);
      if (bbtRef.current) bbtRef.current.textContent = formatBBT(map, beat);
      if (clockRef.current)
        clockRef.current.textContent = formatClock(projectBeatToSec(project, beat));
    };
    write();
    return engine.onFrame(write);
  }, [editing]);

  const jump = (text: string) => {
    const project = useProjectStore.getState().project;
    const beat = parseBBT(tempoMapOf(project), text);
    if (beat !== null) engine.seek(Math.max(0, beat));
  };

  return (
    <>
      <button
        className={`t-cell pos${primary === 'bbt' ? ' primary' : ''}`}
        onClick={() => setEditing(true)}
        title="Position in bars · beats · ticks — click to type a position"
        data-testid="pos-cell"
      >
        {editing ? (
          <input
            className="t-pos-input"
            autoFocus
            defaultValue={formatBBT(
              tempoMapOf(useProjectStore.getState().project),
              engine.getPositionBeats(),
            )}
            onBlur={(e) => {
              jump(e.target.value);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-label="Position in bars, beats and ticks"
          />
        ) : (
          <span className="v" ref={bbtRef} data-testid="pos-display">
            1.1.000
          </span>
        )}
        {/* The compact bar has room for the reading, not for its full name;
            a label sliced through its first letter is worse than a short
            one. */}
        <span className="l">{compact ? 'Bars' : 'Bars · Beats'}</span>
      </button>
      {!compact && (
        <div
          className={`t-cell time${primary === 'clock' ? ' primary' : ''}`}
          title="Elapsed song time"
        >
          <span className="v" ref={clockRef} data-testid="clock-display">
            0:00.000
          </span>
          <span className="l">Time</span>
        </div>
      )}
    </>
  );
}

/**
 * Performance meter: how much of each animation frame the app is using.
 *
 * Web Audio renders on its own thread, so this is not "DSP load" — it is the
 * honest thing a browser can measure, which is whether the UI is keeping up.
 * Audio dropouts show up here as long frames long before they are audible.
 */
function PerformanceMeter() {
  const barRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const sources = useTransportStore((s) => s.activeSources);

  useEffect(() => {
    let smoothed = 0;
    let frames = 0;
    return engine.onFrame((dt) => {
      // 16.7 ms is one frame's budget; anything past it is a dropped frame.
      const load = Math.min(1.5, dt / 0.0167);
      smoothed += (load - smoothed) * 0.08;
      if (++frames % 10) return;
      const pct = Math.round(smoothed * 100);
      if (barRef.current) {
        barRef.current.style.width = `${Math.min(100, pct)}%`;
        barRef.current.dataset.level = pct > 95 ? 'hot' : pct > 70 ? 'warm' : 'ok';
      }
      if (textRef.current) textRef.current.textContent = `${pct}%`;
    });
  }, []);

  return (
    <div className="t-perf" title={`UI frame load · ${sources} active audio sources`}>
      <div className="t-perf-bar">
        <span ref={barRef} data-level="ok" />
      </div>
      <span className="t-perf-text" ref={textRef}>
        0%
      </span>
      <span className="t-perf-src" data-testid="perf-sources">
        {sources}
      </span>
    </div>
  );
}

/**
 * Click levels the menu steps through, linear like everything else that moves
 * a gain here. 70% is the schema's default and the level every project that
 * never touched this control is already carrying.
 */
const CLICK_LEVELS = [0, 0.25, 0.5, 0.7, 1, 1.4];

function nextClickLevel(current: number): number {
  const next = CLICK_LEVELS.find((v) => v > current + 1e-6);
  return next ?? CLICK_LEVELS[0];
}

function clickLevelLabel(level: number): string {
  return level <= 0 ? 'silent' : `${Math.round(level * 100)}%`;
}

/** Tap tempo: four taps set the tempo, and it keeps averaging while you tap. */
function useTapTempo(): () => void {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = performance.now();
    const list = taps.current;
    // A gap longer than two seconds starts a new count rather than averaging
    // in a tap from a minute ago.
    if (list.length && now - list[list.length - 1] > 2000) list.length = 0;
    list.push(now);
    if (list.length > 8) list.shift();
    if (list.length < 2) return;
    const spans = list.slice(1).map((t, i) => t - list[i]);
    const mean = spans.reduce((a, b) => a + b, 0) / spans.length;
    if (mean > 100) useProjectStore.getState().setBpm(Math.round((60000 / mean) * 10) / 10);
  }, []);
}

/**
 * Transport. The compact variant used on phones carries a deliberately reduced
 * control set (transport buttons, position, tempo, audio state); metronome,
 * time signature and master volume move into the Mix workspace and the overflow
 * menu rather than being squeezed until they overlap.
 */
export function TransportBar({ compact }: { compact?: boolean }) {
  const playState = useTransportStore((s) => s.playState);
  const project = useProjectStore((s) => s.project);
  const { bpm, timeSig, loop, metronome } = project;
  const setBpm = useProjectStore((s) => s.setBpm);
  const setTimeSig = useProjectStore((s) => s.setTimeSig);
  const setLoop = useProjectStore((s) => s.setLoop);
  const setMetronome = useProjectStore((s) => s.setMetronome);
  const setMasterVolume = useProjectStore((s) => s.setMasterVolume);
  const tap = useTapTempo();

  const playing = playState === 'playing';
  const masterVolume = project.master?.volume ?? project.masterVolume;
  const countIn = project.countIn ?? 1;
  const preRoll = project.preRoll ?? 0;
  const punch = project.punch?.enabled === true;
  const clickLevel = clickGain(project);
  const clickRecordOnly = project.clickRecordOnly === true;

  /** Move the playhead by whole bars, honouring the signature map. */
  const nudgeBars = (delta: number) => {
    const map = tempoMapOf(project);
    const bar = Math.floor(beatToBar(map, engine.getPositionBeats()) + 1e-6);
    engine.seek(Math.max(0, barToBeat(map, Math.max(0, bar + delta))));
  };

  const gotoMarker = (dir: 1 | -1) => {
    const markers = project.markers ?? [];
    const at = engine.getPositionBeats();
    const target = dir === 1 ? nextMarker(markers, at) : prevMarker(markers, at);
    if (target) engine.seek(target.beat);
    else if (dir === -1) engine.returnToStart();
  };

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
        {
          label: `${punch ? 'Disable' : 'Enable'} punch in/out`,
          action: () =>
            useProjectStore.getState().update((d) => {
              d.punch = {
                enabled: !punch,
                start: d.punch?.start ?? d.loop.start,
                end: d.punch?.end ?? d.loop.end,
              };
            }),
        },
        {
          label: `Count-in: ${countIn === 0 ? 'off' : `${countIn} bar${countIn === 1 ? '' : 's'}`}`,
          action: () =>
            useProjectStore.getState().update((d) => {
              d.countIn = ((d.countIn ?? 1) + 1) % 5;
            }),
        },
        {
          // A count-in is a click; a pre-roll is the song. Both are wanted, and
          // for different reasons, so both are here rather than one standing in
          // for the other.
          label: `Pre-roll: ${preRoll === 0 ? 'off' : `${preRoll} bar${preRoll === 1 ? '' : 's'}`}`,
          action: () =>
            useProjectStore.getState().update((d) => {
              d.preRoll = ((d.preRoll ?? 0) + 1) % 5;
            }),
        },
        {
          // The click's level belongs with the count-in and the pre-roll, not
          // in Preferences: it is saved in the song, it is decided while
          // tracking, and it is a different number for a loud drummer than for
          // a quiet vocal — which is a property of the session, not of the
          // person using the app.
          label: `Click level: ${clickLevelLabel(clickLevel)}`,
          testId: 'menu-click-level',
          action: () =>
            useProjectStore.getState().update((d) => {
              d.clickLevel = nextClickLevel(clickGain(d));
            }),
        },
        {
          label: clickRecordOnly ? 'Click: while recording only' : 'Click: whenever it is on',
          testId: 'menu-click-record-only',
          action: () =>
            useProjectStore.getState().update((d) => {
              d.clickRecordOnly = d.clickRecordOnly !== true;
            }),
        },
        {
          label: 'Set the punch range from the loop',
          disabled: !(loop.end > loop.start),
          action: () =>
            useProjectStore.getState().update((d) => {
              d.punch = { enabled: true, start: d.loop.start, end: d.loop.end };
            }),
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
          title="Return to start (Home or Enter)"
          aria-label="Return to start"
          data-testid="btn-rts"
        >
          <Icon name="skipback" size={16} />
        </button>
        {!compact && (
          <>
            <button
              className="t-btn"
              onClick={() => nudgeBars(-1)}
              onContextMenu={(e) => {
                e.preventDefault();
                gotoMarker(-1);
              }}
              title="Back one bar — right-click for the previous marker"
              aria-label="Back one bar"
              data-testid="btn-rewind"
            >
              <Icon name="rewind" size={15} />
            </button>
            <button
              className="t-btn"
              onClick={() => nudgeBars(1)}
              onContextMenu={(e) => {
                e.preventDefault();
                gotoMarker(1);
              }}
              title="Forward one bar — right-click for the next marker"
              aria-label="Forward one bar"
              data-testid="btn-forward"
            >
              <Icon name="forward" size={15} />
            </button>
          </>
        )}
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
            className={`t-btn${punch ? ' warm-on' : ''}`}
            onClick={() =>
              useProjectStore.getState().update((d) => {
                d.punch = {
                  enabled: !punch,
                  start: d.punch?.start ?? d.loop.start,
                  end: d.punch?.end ?? d.loop.end,
                };
              })
            }
            title={
              punch
                ? `Punch in/out over bars ${(project.punch?.start ?? 0) / 4 + 1} to ${(project.punch?.end ?? 0) / 4 + 1} — right-click the transport to set it from the loop`
                : 'Punch in/out over the loop range'
            }
            aria-label="Punch in and out"
            aria-pressed={punch}
            data-testid="btn-punch"
          >
            <Icon name="punch" size={15} />
          </button>
        )}
        {!compact && (
          <button
            className={`t-btn${metronome ? ' metro-on' : ''}`}
            onClick={() => setMetronome(!metronome)}
            onContextMenu={(e) => {
              e.preventDefault();
              useProjectStore.getState().update((d) => {
                d.countIn = ((d.countIn ?? 1) + 1) % 5;
              });
            }}
            title={`Metronome — right-click to change the count-in (${countIn === 0 ? 'off' : `${countIn} bar`})`}
            aria-label="Metronome"
            aria-pressed={metronome}
            data-testid="btn-metronome"
          >
            <Icon name="metronome" size={15} />
            {countIn > 0 && <span className="t-badge">{countIn}</span>}
          </button>
        )}
      </div>

      <div className="t-display">
        <PositionDisplay compact={compact} />
        <div className="t-cell tempo">
          <input
            type="number"
            min={20}
            max={999}
            step={0.1}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value) || bpm)}
            aria-label="Tempo in beats per minute"
            data-testid="bpm-input"
          />
          <span className="l">BPM</span>
        </div>
        {!compact && (
          <button className="t-tap" onClick={tap} title="Tap tempo" data-testid="btn-tap">
            TAP
          </button>
        )}
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
              {['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '5/8', '6/8', '7/8', '9/8', '12/8'].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </select>
            <span className="l">Sig</span>
          </div>
        )}
      </div>

      {!compact && <PerformanceMeter />}

      {!compact && (
        <div className="t-master">
          <Icon name="output" size={14} />
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
      {!compact && (
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
