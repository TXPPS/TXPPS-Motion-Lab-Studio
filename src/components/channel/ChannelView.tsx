/**
 * One channel, laid out the way landscape is shaped.
 *
 * Directive item 12: the quick EQ and compression strip leaves the mixer's
 * track area and becomes a sub-view of the editor — a long horizontal rack
 * giving a quick visual of everything, with editable controls.
 *
 * It was a band *inside* the console, taking 116 px out of the mixer pane, and
 * the height it took came off the strips. That is what "a permanent tenant of
 * the track area" means, and it is half of why the console cannot fit itself in
 * landscape: measured on a tablet, a strip has 131 px and the device rack's own
 * touch floor is 140. `docs/design/channel-strip.md` carries the arithmetic and
 * the argument.
 *
 * The shape is the fix. A console strip is narrow and tall because its job is
 * comparing twenty channels; a channel's chain is never compared across
 * channels, so it goes on the axis a landscape screen actually has. Everything
 * here reads left to right in signal order — in, notes, instrument, inserts,
 * sends — and the output is a separate column pinned to the right, so the rail
 * can grow to any length without ever taking a pixel from the fader.
 */
import { memo } from 'react';
import { resolveChannels } from '../../model/mixerGraph';
import { MASTER_ID, type Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';
import { NoteFxSlots } from '../mixer/NoteFxSlots';
import { channelRack } from '../mixer/DeviceRack';
import { DeviceRail } from './DeviceRail';
import { MasterView } from './MasterView';
import { OutColumn, Section } from './parts';
import { OutputRoute, SendKnobs } from './Routing';

export const ChannelView = memo(function ChannelView({ track }: { track: Track }) {
  const store = useProjectStore;
  const project = useProjectStore((s) => s.project);
  const state = resolveChannels(project).get(track.id);
  const rack = channelRack(project, track.id);
  const trim = track.inputGainDb ?? 0;

  // Two lists, kept apart on purpose — see `Routing.tsx`. A bus is routed into
  // and an FX return is sent to, and merging them is what let the output menu
  // offer an FX return as a destination.
  const buses = project.tracks.filter((t) => t.type === 'bus' && t.id !== track.id);
  const sendTargets = project.tracks.filter(
    (t) => (t.type === 'fx' || t.type === 'bus') && t.id !== track.id,
  );
  const vcas = project.tracks.filter((t) => t.type === 'vca');

  if (!rack) return null;

  return (
    <div
      className="channel-view"
      style={{ ['--strip-color' as string]: track.color }}
      data-testid="channel-view"
      role="group"
      aria-label={`${track.name} channel`}
    >
      <header className="chn-head">
        <Icon name="mixer" size={12} />
        <span className="chn-name" title={track.name}>
          {track.name}
        </span>
        {state && !state.audible && (
          <span className="chn-silent" data-testid="channel-silent">
            silent
          </span>
        )}
      </header>

      <div className="chn-rail" data-testid="channel-rail">
        <Section title="In" testId="channel-input">
          <div className="chn-input">
            <button
              className={`in-flag${track.phaseInvert ? ' on' : ''}`}
              title="Invert polarity"
              aria-pressed={track.phaseInvert === true}
              aria-label={`Invert polarity on ${track.name}`}
              data-testid="channel-polarity"
              onClick={() =>
                store.getState().setTrack(track.id, { phaseInvert: !track.phaseInvert })
              }
            >
              Ø
            </button>
            <button
              className={`in-flag${track.monoSum ? ' on' : ''}`}
              title="Sum this channel to mono"
              aria-pressed={track.monoSum === true}
              aria-label={`Sum ${track.name} to mono`}
              data-testid="channel-mono"
              onClick={() => store.getState().setTrack(track.id, { monoSum: !track.monoSum })}
            >
              M
            </button>
            <label className="chn-trim">
              <input
                type="range"
                min={-24}
                max={24}
                step={0.5}
                value={trim}
                aria-label={`${track.name} input trim`}
                data-testid="channel-trim"
                onChange={(e) =>
                  store.getState().setTrack(track.id, { inputGainDb: Number(e.target.value) })
                }
              />
              <span className="t-num">
                {trim > 0 ? '+' : ''}
                {trim.toFixed(1)} dB
              </span>
            </label>
          </div>
        </Section>

        {/* Signal order, and it is the reason these are in this sequence: what a
            clip writes goes through the MIDI chain, into the instrument, and out
            through the inserts. A bus receives no notes and gets neither. */}
        {rack.noteFx && (
          <Section title="MIDI FX" testId="channel-notefx">
            <div className="chn-notefx">
              <NoteFxSlots host={rack.noteFx} />
            </div>
          </Section>
        )}

        {rack.instrument && (
          <Section title="Instrument" testId="channel-instrument">
            <button
              className={`chn-instrument${rack.instrument.frozen ? ' frozen' : ''}`}
              data-testid="channel-instrument-open"
              aria-label={`${rack.instrument.label} on ${track.name}`}
              title={
                rack.instrument.frozen
                  ? `${rack.instrument.label} — frozen, playing a render`
                  : `${rack.instrument.label} — press to edit`
              }
              onClick={rack.instrument.open}
            >
              <Icon name={rack.instrument.frozen ? 'freeze' : 'piano'} size={12} />
              <span>{rack.instrument.label}</span>
            </button>
          </Section>
        )}

        <DeviceRail rack={rack} />

        <Section title="Sends" testId="channel-sends-section">
          <SendKnobs track={track} targets={sendTargets} />
        </Section>
      </div>

      <OutColumn
        meterId={track.id}
        label={track.name}
        pan={track.pan}
        volume={track.volume}
        onPan={(v) => store.getState().setTrack(track.id, { pan: v })}
        onVolume={(v) => store.getState().setTrack(track.id, { volume: v })}
        route={<OutputRoute track={track} buses={buses} vcas={vcas} />}
      />
    </div>
  );
});

/**
 * The editor body: whichever channel is selected, or a prompt to pick one.
 *
 * A prompt rather than nothing, unlike the band this replaces. That one
 * rendered `null` when no channel was selected because it was stealing height
 * from the console and an empty band was worse than none — here the surface
 * *is* the tab, so rendering nothing would look like an editor that failed to
 * load.
 */
export function ChannelEditor() {
  const id = useUiStore((s) => s.selectedTrackId);
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === id));
  // The master is not a member of `project.tracks`, and the console's shortest
  // tiers now send its chain here like any other. Answered before the track
  // lookup because that lookup returns `undefined` for it, which would draw the
  // "no channel selected" prompt over a channel that is selected.
  if (id === MASTER_ID) return <MasterView />;
  if (!track || track.type === 'folder' || track.type === 'vca') {
    return (
      <div className="channel-view empty" data-testid="channel-view-empty">
        <div className="empty-state">
          <Icon name="mixer" size={26} className="es-icon" />
          <div className="es-title">No channel selected</div>
          <p className="es-body">
            Pick a track in the arrangement or a strip in the mixer, and its whole channel — input,
            MIDI effects, instrument, inserts, sends and output — appears here on one line.
          </p>
          <button
            className="btn"
            data-testid="channel-goto-mixer"
            onClick={() => {
              useWorkspaceStore.getState().reveal('editor');
              useUiStore.getState().set({ editorTab: 'mixer', phoneMode: 'mix' });
            }}
          >
            Open the mixer
          </button>
        </div>
      </div>
    );
  }
  return <ChannelView track={track} />;
}
