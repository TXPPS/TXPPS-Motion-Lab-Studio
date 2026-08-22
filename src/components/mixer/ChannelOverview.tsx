/**
 * Channel Overview.
 *
 * A console strip is 90 pixels wide, which is the right shape for comparing
 * twenty channels and the wrong shape for working on one. The overview lays the
 * selected channel out horizontally instead: input, the EQ curve, dynamics with
 * its live gain reduction, the rest of the chain, the sends, and the fader with
 * its meter — everything about one channel on one line, without opening a
 * panel or losing sight of the desk.
 */
import { memo } from 'react';
import { describeEffect, effectSpec } from '../../model/effects';
import { formatDb } from '../../model/music';
import { resolveChannels } from '../../model/mixerGraph';
import type { Effect, Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Fader, PanKnob, StereoMeter, panText } from '../common/widgets';
import { Icon } from '../common/Icon';
import { EffectVisual, faceKindOf } from './PluginFace';
import { trackChainHost, type ChainHost } from './InsertRack';

/** The first insert of a kind whose face is worth showing inline. */
function firstOfFace(effects: Effect[], face: string): Effect | undefined {
  return effects.find((e) => faceKindOf(e.kind) === face && !e.bypass);
}

function Section({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={`co-section${wide ? ' wide' : ''}`}>
      <span className="co-title">{title}</span>
      <div className="co-body">{children}</div>
    </div>
  );
}

export const ChannelOverview = memo(function ChannelOverview({ track }: { track: Track }) {
  const store = useProjectStore;
  const project = useProjectStore((s) => s.project);
  const state = resolveChannels(project).get(track.id);
  const effects = track.effects ?? [];
  const eq = firstOfFace(effects, 'eq');
  const dyn = firstOfFace(effects, 'comp') ?? firstOfFace(effects, 'gate');
  const rest = effects.filter((e) => e !== eq && e !== dyn);
  const sends = (track.sends ?? []).filter((s) => s.enabled);
  const busName = (id: string) => project.tracks.find((t) => t.id === id)?.name ?? 'Bus';
  const chain: ChainHost = trackChainHost(track);

  return (
    <div
      className="channel-overview"
      style={{ ['--strip-color' as string]: track.color }}
      data-testid="channel-overview"
    >
      <div className="co-name">
        <Icon name="mixer" size={12} />
        <span className="co-track">{track.name}</span>
        {state && !state.audible && <span className="co-silent">silent</span>}
      </div>

      <Section title="Input">
        <div className="co-input">
          <button
            className={`in-flag${track.phaseInvert ? ' on' : ''}`}
            title="Invert polarity"
            aria-pressed={track.phaseInvert === true}
            onClick={() => store.getState().setTrack(track.id, { phaseInvert: !track.phaseInvert })}
          >
            Ø
          </button>
          <button
            className={`in-flag${track.monoSum ? ' on' : ''}`}
            title="Sum to mono"
            aria-pressed={track.monoSum === true}
            onClick={() => store.getState().setTrack(track.id, { monoSum: !track.monoSum })}
          >
            M
          </button>
          <label className="co-trim">
            <input
              type="range"
              min={-24}
              max={24}
              step={0.5}
              value={track.inputGainDb ?? 0}
              aria-label={`${track.name} input trim`}
              onChange={(e) =>
                store.getState().setTrack(track.id, { inputGainDb: Number(e.target.value) })
              }
            />
            <span className="t-num">
              {(track.inputGainDb ?? 0) > 0 ? '+' : ''}
              {(track.inputGainDb ?? 0).toFixed(1)} dB
            </span>
          </label>
        </div>
      </Section>

      <Section title={eq ? (effectSpec(eq.kind)?.label ?? 'EQ') : 'EQ'} wide>
        {eq ? (
          <EffectVisual
            effect={eq}
            trackId={track.id}
            onParam={(key, v) => chain.setParam(eq.id, key, v)}
            onGestureStart={() => store.getState().beginGesture()}
            onGestureEnd={() => store.getState().endGesture()}
          />
        ) : (
          <button className="co-add" onClick={() => chain.add('eq8')}>
            <Icon name="plus" size={12} /> Add EQ
          </button>
        )}
      </Section>

      <Section title={dyn ? (effectSpec(dyn.kind)?.label ?? 'Dynamics') : 'Dynamics'}>
        {dyn ? (
          <EffectVisual
            effect={dyn}
            trackId={track.id}
            onParam={(key, v) => chain.setParam(dyn.id, key, v)}
            onGestureStart={() => store.getState().beginGesture()}
            onGestureEnd={() => store.getState().endGesture()}
          />
        ) : (
          <button className="co-add" onClick={() => chain.add('compressor')}>
            <Icon name="plus" size={12} /> Add compressor
          </button>
        )}
      </Section>

      <Section title="Chain">
        <div className="co-chain">
          {rest.map((e) => (
            <button
              key={e.id}
              className={`ins-slot${e.bypass ? ' bypassed' : ''}`}
              title={`${effectSpec(e.kind)?.label ?? e.kind} — ${describeEffect(e)}`}
              onClick={() => chain.setBypass(e.id, !e.bypass)}
            >
              <span className="ins-dot" />
              <span className="ins-name">{effectSpec(e.kind)?.label ?? e.kind}</span>
            </button>
          ))}
          {rest.length === 0 && <span className="hint">No other inserts</span>}
        </div>
      </Section>

      <Section title="Key">
        <div className="co-key">
          <select
            value={track.sidechainFrom ?? ''}
            aria-label={`${track.name} sidechain source`}
            title="Which channel keys this one's compressor, gate, de-esser and limiter — a kick keying a bass compressor is the classic case. The key is taken after that channel's fader, and the multiband is the one dynamics insert it does not reach."
            onChange={(e) =>
              store.getState().setTrack(track.id, { sidechainFrom: e.target.value || undefined })
            }
            data-testid={`sidechain-${track.name}`}
          >
            <option value="">Own signal</option>
            {project.tracks
              .filter((t) => t.id !== track.id && t.type !== 'folder' && t.type !== 'vca')
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
      </Section>

      <Section title="Sends">
        <div className="co-sends">
          {sends.map((s) => (
            <label key={s.busId} className="co-send">
              <span className="co-send-name">{busName(s.busId)}</span>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.01}
                value={s.amount}
                aria-label={`Send to ${busName(s.busId)}`}
                onChange={(e) =>
                  store
                    .getState()
                    .setSend(track.id, s.busId, { amount: Number(e.target.value), enabled: true })
                }
              />
              <span className="t-num">{formatDb(s.amount)}</span>
            </label>
          ))}
          {sends.length === 0 && <span className="hint">No active sends</span>}
        </div>
      </Section>

      <Section title="Output">
        <div className="co-out">
          <PanKnob
            size={30}
            value={track.pan}
            onChange={(v) => store.getState().setTrack(track.id, { pan: v })}
            onGestureStart={() => store.getState().beginGesture()}
            onGestureEnd={() => store.getState().endGesture()}
            label={`${track.name} pan`}
          />
          <span className="t-num">{panText(track.pan)}</span>
          <div className="co-fader">
            <Fader
              value={track.volume}
              label={`${track.name} volume`}
              onGestureStart={() => store.getState().beginGesture()}
              onGestureEnd={() => store.getState().endGesture()}
              onChange={(v) => store.getState().setTrack(track.id, { volume: v })}
            />
            <StereoMeter meterId={track.id} scale label={`${track.name} level`} />
          </div>
          <span className="t-num">{formatDb(track.volume)}</span>
        </div>
      </Section>
    </div>
  );
});

/** Renders the overview for whatever channel is selected, or a prompt. */
export function ChannelOverviewHost() {
  const id = useUiStore((s) => s.selectedTrackId);
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === id));
  // Nothing selected: take no room at all. A band of empty console saying
  // "select a channel" was costing a quarter of the mixer's height to tell
  // the user something clicking a strip already tells them — and the height
  // it took came off the strips, which is where the work happens.
  if (!track || track.type === 'folder' || track.type === 'vca') return null;
  return <ChannelOverview track={track} />;
}
