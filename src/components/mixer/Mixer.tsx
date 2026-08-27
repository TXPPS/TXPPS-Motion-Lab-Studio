/**
 * The console.
 *
 * One horizontal scroller holding a row of fixed-width strips, grouped the way
 * an engineer reads a desk: channels, then buses and FX returns, then VCAs,
 * then the master. Folder tracks own no channel — their fader acts on their
 * members — so they appear as group headers rather than as strips.
 *
 * A vertical wheel over the console is translated to horizontal scroll so mouse
 * users can pan the row; trackpads keep their native two-axis deltas.
 */
import { useEffect, useMemo, useRef } from 'react';
import { resolveChannels } from '../../model/mixerGraph';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import { ChannelStrip, MasterStrip } from './ChannelStrip';
import { CueBar } from './CueBar';
import { VcaStrip } from './VcaStrip';

export function Mixer({ touch }: { touch?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const tracks = project.tracks;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const monitorCueId = useUiStore((s) => s.monitorCueId);
  const states = useMemo(() => resolveChannels(project, monitorCueId), [project, monitorCueId]);

  const buses = tracks.filter((t) => t.type === 'bus');
  const fxChannels = tracks.filter((t) => t.type === 'fx');
  const vcas = tracks.filter((t) => t.type === 'vca');
  const channels = tracks.filter(
    (t) => t.type === 'audio' || t.type === 'instrument' || t.type === 'drum',
  );
  const sendTargets = [...buses, ...fxChannels];

  const nameOf = (id: string) =>
    id === 'master' ? 'Master' : (tracks.find((t) => t.id === id)?.name ?? 'Master');

  /** Which tracks feed a summing channel (output routing or an enabled send). */
  const feedsOf = (busId: string) =>
    tracks
      .filter(
        (t) =>
          t.id !== busId &&
          (t.output === busId ||
            (t.sends ?? []).some((s) => s.busId === busId && s.enabled && s.amount > 0)),
      )
      .map((t) => t.name);

  const strip = (t: Track) => (
    <ChannelStrip
      key={t.id}
      track={t}
      outputName={nameOf(t.output)}
      buses={sendTargets}
      feeds={t.type === 'bus' || t.type === 'fx' ? feedsOf(t.id) : undefined}
      state={states.get(t.id)}
      vcas={vcas}
    />
  );

  if (channels.length === 0 && sendTargets.length === 0) {
    return (
      <div className="mixer empty" data-testid="mixer" role="group" aria-label="Mixer">
        <div className="empty-state">
          <Icon name="mixer" size={30} className="es-icon" />
          <div className="es-title">Nothing to mix yet</div>
          <p className="es-body">
            Add a track in the arrangement and its channel appears here, with its inserts, sends,
            meter and routing.
          </p>
        </div>
        <MasterStrip />
      </div>
    );
  }

  return (
    <div className="mixer-wrap">
      <CueBar />
      <div
        ref={ref}
        className={`mixer${touch ? ' touch' : ''}`}
        data-testid="mixer"
        role="group"
        aria-label="Mixer"
      >
        {channels.map(strip)}
        {sendTargets.length > 0 && <div className="mixer-sep" aria-hidden />}
        {buses.map(strip)}
        {fxChannels.map(strip)}
        {vcas.length > 0 && <div className="mixer-sep" aria-hidden />}
        {vcas.map((v) => (
          <VcaStrip key={v.id} track={v} members={tracks.filter((t) => t.vcaId === v.id)} />
        ))}
        <div className="mixer-sep" aria-hidden />
        <MasterStrip />
        <button
          className="mixer-add"
          title="Add a bus, FX channel or VCA"
          onClick={(e) =>
            useUiStore.getState().showMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                {
                  label: 'Add bus',
                  action: () =>
                    useUiStore.getState().selectTrack(useProjectStore.getState().addTrack('bus')),
                },
                {
                  label: 'Add FX channel',
                  action: () =>
                    useUiStore.getState().selectTrack(useProjectStore.getState().addTrack('fx')),
                },
                { label: 'Add VCA fader', action: () => useProjectStore.getState().addVca() },
              ],
            })
          }
          data-testid="mixer-add"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
    </div>
  );
}
