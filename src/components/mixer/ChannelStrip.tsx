/**
 * Channel strip.
 *
 * The reference's console shows a whole channel at a glance: what is coming in,
 * what is inserted, where it is going, and how loud it is — not just a fader.
 * This strip carries the same rows in the same order for every channel type, so
 * the eye can scan across the console horizontally and compare like with like:
 *
 *   name · input (trim / polarity / mono) · inserts · sends · pan
 *   fader + stereo meter with a printed dB scale · mute/solo/arm · readout
 *   output routing · group and VCA assignment
 *
 * Geometry is fixed by CSS grid rows; the fader row is the only flexible one and
 * the strip clips its own overflow, so no control can escape into a neighbour
 * however short the console panel gets.
 */
import { memo } from 'react';
import { formatDb, linToDb } from '../../model/music';
import { resolveChannels } from '../../model/mixerGraph';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Fader, PanKnob, PeakReadout, StereoMeter, panText } from '../common/widgets';
import { DeviceRack, masterRack, trackRack } from './DeviceRack';
import { cueSendOf, findCue } from '../../model/cueMix';

/** The cue being monitored, if any. Null means the main mix, which is the norm. */
function useCueMix() {
  const cueId = useUiStore((s) => s.monitorCueId);
  const cues = useProjectStore((s) => s.project.cueMixes);
  return findCue(cues, cueId);
}
import { Icon, type IconName } from '../common/Icon';
import { captureParamChange, captureParamRelease } from '../../app/automationActions';

const TYPE_ICON: Record<Track['type'], IconName> = {
  audio: 'wave',
  instrument: 'piano',
  drum: 'grid',
  bus: 'mixer',
  fx: 'zap',
  folder: 'folder',
  vca: 'vca',
};

/** Open the inspector on this track — where there is room to edit a chain. */
function focusTrack(id: string): void {
  useUiStore.getState().selectTrack(id);
  useUiStore.getState().set({ panelInspector: true, phoneMode: 'browse' });
}

/** Sends a strip shows before it summarises the rest. */
const MAX_SEND_ROWS = 3;

function SendRows({ track, busName }: { track: Track; busName: (id: string) => string }) {
  const sends = (track.sends ?? []).filter((s) => s.enabled);
  if (sends.length === 0) return null;
  return (
    <div className="strip-sends">
      {sends.slice(0, MAX_SEND_ROWS).map((s) => (
        <button
          key={s.busId}
          className="snd-row"
          onClick={() => focusTrack(track.id)}
          title={`Send to ${busName(s.busId)} · ${formatDb(s.amount)} dB${
            s.preFader ? ' (pre-fader)' : ''
          }`}
        >
          <span className="snd-name">{busName(s.busId)}</span>
          <span className="snd-val">{formatDb(s.amount)}</span>
        </button>
      ))}
      {/* The insert rack says how many it is hiding; a send row that silently
          dropped two of five was the one place a channel lied about itself. */}
      {sends.length > MAX_SEND_ROWS && (
        <button className="snd-row more" onClick={() => focusTrack(track.id)}>
          +{sends.length - MAX_SEND_ROWS} more
        </button>
      )}
    </div>
  );
}

export interface StripProps {
  track: Track;
  outputName: string;
  buses: Track[];
  /** For a bus or FX strip: names of the tracks routed or sending into it. */
  feeds?: string[];
  /** Resolved audibility, so a strip can show WHY it is silent. */
  state?: ReturnType<typeof resolveChannels> extends Map<string, infer V> ? V : never;
  vcas: Track[];
}

export const ChannelStrip = memo(function ChannelStrip({
  track,
  outputName,
  buses,
  feeds,
  state,
  vcas,
}: StripProps) {
  const selected = useUiStore((s) => s.selectedTrackId === track.id);
  const store = useProjectStore;
  const isSum = track.type === 'bus' || track.type === 'fx';
  const canRecord = track.type === 'audio' || track.type === 'instrument' || track.type === 'drum';
  const autoLanes = (track.automation ?? []).filter((l) => l.enabled && l.points.length > 0);
  const autoMode = track.automationMode ?? 'read';
  const trim = track.inputGainDb ?? 0;
  const vca = vcas.find((v) => v.id === track.vcaId);

  // While a cue mix is being monitored, the fader, pan and mute belong to the
  // cue: what you hear is what you are adjusting. Everything else on the strip
  // — inserts, sends, routing, arm — is the channel's and stays the channel's,
  // because a cue changes a balance, not a signal path.
  const cue = useCueMix();
  const send = cue ? cueSendOf(cue, track) : null;
  const level = send ? send.level : track.volume;
  const pan = send ? send.pan : track.pan;

  const silentBecause = state?.mutedByGroup
    ? 'silenced by its group'
    : state?.mutedBySolo
      ? 'silenced by another track’s solo'
      : null;

  return (
    <div
      className={`strip${selected ? ' selected' : ''}${isSum ? ' bus' : ''}${
        state && !state.audible ? ' silent' : ''
      }${cue ? ' in-cue' : ''}`}
      style={{ ['--strip-color' as string]: track.color }}
      role="group"
      aria-label={`${track.name} channel`}
      aria-current={selected || undefined}
      onPointerDown={() => useUiStore.getState().selectTrack(track.id)}
      data-testid={`strip-${track.name}`}
      data-strip="channel"
    >
      <div
        className="strip-name"
        title={silentBecause ? `${track.name} — ${silentBecause}` : track.name}
      >
        <Icon name={TYPE_ICON[track.type]} size={11} />
        {isSum && (
          <span
            className="strip-bus-tag"
            title={`${track.type === 'fx' ? 'FX channel' : 'Bus'} · fed by ${feeds?.length ?? 0} source${
              (feeds?.length ?? 0) === 1 ? '' : 's'
            }${feeds?.length ? `: ${feeds.join(', ')}` : ''}`}
          >
            {track.type === 'fx' ? 'FX' : 'BUS'}
            {feeds?.length ? ` ${feeds.length}` : ''}
          </span>
        )}
        <span className="strip-label" title={track.name}>
          {track.name}
        </span>
        {autoLanes.length > 0 && autoMode !== 'off' && (
          <span
            className="strip-auto-dot"
            title={`${autoLanes.length} automation lane${autoLanes.length === 1 ? '' : 's'} (${autoMode})`}
            data-testid={`strip-auto-${track.name}`}
          >
            A
          </span>
        )}
      </div>

      {/* Input stage. Trim is the number a compressor downstream actually sees,
          so it belongs at the top of the strip, not buried in a panel. */}
      <div className="strip-input">
        <button
          className={`in-trim${trim !== 0 ? ' set' : ''}`}
          title="Input trim — click to reset, drag to change"
          onDoubleClick={() => store.getState().setTrack(track.id, { inputGainDb: 0 })}
          onClick={() => focusTrack(track.id)}
          data-testid={`trim-${track.name}`}
        >
          {trim > 0 ? '+' : ''}
          {trim.toFixed(1)}
        </button>
        <button
          className={`in-flag${track.phaseInvert ? ' on' : ''}`}
          title="Invert polarity"
          aria-pressed={track.phaseInvert === true}
          aria-label={`Invert polarity on ${track.name}`}
          onClick={() => store.getState().setTrack(track.id, { phaseInvert: !track.phaseInvert })}
        >
          Ø
        </button>
        <button
          className={`in-flag${track.monoSum ? ' on' : ''}`}
          title="Sum this channel to mono"
          aria-pressed={track.monoSum === true}
          aria-label={`Sum ${track.name} to mono`}
          onClick={() => store.getState().setTrack(track.id, { monoSum: !track.monoSum })}
        >
          M
        </button>
      </div>

      <DeviceRack rack={trackRack(track)} />
      <SendRows track={track} busName={(id) => buses.find((b) => b.id === id)?.name ?? 'Bus'} />

      <div className="strip-pan">
        <PanKnob
          size={26}
          value={pan}
          onChange={(v) => {
            if (cue) {
              store.getState().setCueSend(cue.id, track.id, { pan: v });
              return;
            }
            store.getState().setTrack(track.id, { pan: v });
            captureParamChange(track.id, 'pan', v);
          }}
          onGestureStart={() => !cue && store.getState().beginGesture()}
          onGestureEnd={() => {
            if (cue) return;
            store.getState().endGesture();
            captureParamRelease(track.id, 'pan');
          }}
          label={cue ? `${track.name} pan in ${cue.name}` : `${track.name} pan`}
        />
        <span className="pan-val">{panText(pan)}</span>
      </div>

      <div className="strip-mid">
        <Fader
          value={level}
          label={cue ? `${track.name} level in ${cue.name}` : `${track.name} volume`}
          onGestureStart={() => !cue && store.getState().beginGesture()}
          onGestureEnd={() => {
            if (cue) return;
            store.getState().endGesture();
            captureParamRelease(track.id, 'volume');
          }}
          onChange={(v) => {
            if (cue) {
              store.getState().setCueSend(cue.id, track.id, { level: v });
              return;
            }
            store.getState().setTrack(track.id, { volume: v });
            captureParamChange(track.id, 'volume', v);
          }}
        />
        <StereoMeter meterId={track.id} scale label={`${track.name} level`} />
      </div>

      <div className="strip-btns">
        <button
          className={`th-mini${(send ? send.mute : track.mute) ? ' m-on' : ''}`}
          aria-pressed={send ? send.mute : track.mute}
          aria-label={cue ? `Mute ${track.name} in ${cue.name}` : `Mute ${track.name}`}
          title={silentBecause ? `Muted — ${silentBecause}` : 'Mute'}
          data-testid={`mix-mute-${track.name}`}
          onClick={() =>
            cue && send
              ? store.getState().setCueSend(cue.id, track.id, { mute: !send.mute })
              : store.getState().setTrack(track.id, { mute: !track.mute })
          }
        >
          M
        </button>
        <button
          className={`th-mini${track.solo ? ' s-on' : ''}`}
          aria-pressed={track.solo}
          aria-label={`Solo ${track.name}`}
          title="Solo — right-click for solo-safe"
          data-testid={`mix-solo-${track.name}`}
          onClick={() => store.getState().setTrack(track.id, { solo: !track.solo })}
          onContextMenu={(e) => {
            e.preventDefault();
            store.getState().setTrack(track.id, { soloSafe: !track.soloSafe });
          }}
        >
          {track.soloSafe ? 'S!' : 'S'}
        </button>
        {canRecord && (
          <button
            className={`th-mini${track.armed ? ' r-on' : ''}`}
            aria-pressed={track.armed}
            aria-label={`Record arm ${track.name}`}
            title="Record arm"
            onClick={() => store.getState().setTrack(track.id, { armed: !track.armed })}
          >
            <Icon name="record" size={9} />
          </button>
        )}
      </div>

      <div className="strip-readout">
        <span className="rd-db" data-testid={`db-${track.name}`}>
          {formatDb(level)}
        </span>
        <span className="rd-pk">
          <PeakReadout meterId={track.id} />
        </span>
      </div>

      <div className="strip-foot">
        {isSum ? (
          <div className="strip-route static">&rarr; MASTER</div>
        ) : buses.length > 0 ? (
          <select
            className="strip-route"
            value={track.output}
            aria-label={`${track.name} output`}
            onChange={(e) => store.getState().setTrack(track.id, { output: e.target.value })}
          >
            <option value="master">Master</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="strip-route static" title={outputName}>
            &rarr; {outputName}
          </div>
        )}
        {vcas.length > 0 && !isSum && (
          <select
            className="strip-vca"
            value={track.vcaId ?? ''}
            aria-label={`${track.name} VCA`}
            title={vca ? `Controlled by ${vca.name}` : 'No VCA'}
            onChange={(e) => store.getState().assignVca(track.id, e.target.value || undefined)}
          >
            <option value="">No VCA</option>
            {vcas.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
});

/** The master strip: the same rows, minus everything a master cannot have. */
export const MasterStrip = memo(function MasterStrip() {
  const master = useProjectStore((s) => s.project.master);
  const masterVolume = useProjectStore((s) => s.project.master?.volume ?? s.project.masterVolume);
  const store = useProjectStore;
  const fx = master?.effects ?? [];

  return (
    <div
      className="strip master"
      data-testid="strip-master"
      data-strip="master"
      style={{ ['--strip-color' as string]: 'var(--warm)' }}
    >
      <div className="strip-name">
        <Icon name="output" size={11} />
        <span className="strip-label">Master</span>
      </div>

      <div className="strip-input">
        <button
          className={`in-flag${master?.monoCheck ? ' on' : ''}`}
          title="Mono compatibility check (monitoring only — never printed to a bounce)"
          aria-pressed={master?.monoCheck === true}
          onClick={() => store.getState().setMaster({ monoCheck: !master?.monoCheck })}
          data-testid="master-mono"
        >
          MONO
        </button>
        <button
          className={`in-flag${master?.limiter === false ? '' : ' on'}`}
          title="Safety limiter on the output"
          aria-pressed={master?.limiter !== false}
          onClick={() => store.getState().setMaster({ limiter: master?.limiter === false })}
          data-testid="master-limiter"
        >
          LIM
        </button>
      </div>

      <DeviceRack rack={masterRack(fx)} />

      <div className="strip-pan">
        <PanKnob
          size={26}
          value={master?.pan ?? 0}
          onChange={(v) => store.getState().setMaster({ pan: v })}
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          label="Master pan"
        />
        <span className="pan-val">{panText(master?.pan ?? 0)}</span>
      </div>

      <div className="strip-mid">
        <Fader
          value={masterVolume}
          label="Master volume"
          onGestureStart={() => store.getState().beginGesture()}
          onGestureEnd={() => store.getState().endGesture()}
          onChange={(v) => store.getState().setMasterVolume(v)}
        />
        <StereoMeter meterId="master" scale label="Master level" />
      </div>

      <div className="strip-btns">
        <button
          className={`th-mini${master?.dim ? ' m-on' : ''}`}
          title="Dim the monitor output by 20 dB"
          aria-pressed={master?.dim === true}
          onClick={() => store.getState().setMaster({ dim: !master?.dim })}
        >
          DIM
        </button>
      </div>

      <div className="strip-readout">
        <span className="rd-db">{formatDb(masterVolume)}</span>
        <span className="rd-pk">
          <PeakReadout meterId="master" />
        </span>
      </div>

      <div className="strip-foot">
        <div className="strip-route static" title="Stereo output">
          OUT {linToDb(masterVolume) >= 0 ? '+' : ''}
          {linToDb(masterVolume).toFixed(1)}
        </div>
      </div>
    </div>
  );
});
