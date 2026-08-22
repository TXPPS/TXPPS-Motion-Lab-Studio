/**
 * Instruments and effects browser.
 *
 * The reference browses instruments and effects as content: you find one, hear
 * what it is, and drag it onto a track. Here they are grouped exactly as the
 * insert picker groups them, searchable by name and by blurb, and each row does
 * the same thing on click as a drag would — a browser that can only be used by
 * dragging is a browser half the people cannot use.
 */
import { EFFECT_GROUPS, EFFECT_GROUP_LABELS, effectsInGroup } from '../../model/effects';
import { CHAIN_PRESETS, presetsFor } from '../../model/effectPresets';
import { SYNTH_PRESETS } from '../../model/presets';
import { NOTE_FX_SPECS } from '../../model/noteFx';
import type { EffectKind, NoteFxKind } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon, type IconName } from '../common/Icon';
import { matches } from './browserShared';

function Row({
  icon,
  title,
  subtitle,
  badge,
  onAdd,
  testId,
  dragType,
  dragValue,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  badge?: string;
  onAdd: () => void;
  testId?: string;
  dragType?: string;
  dragValue?: string;
}) {
  return (
    <div
      className="li"
      role="button"
      tabIndex={0}
      draggable={!!dragType}
      onDragStart={(e) => {
        if (!dragType || !dragValue) return;
        e.dataTransfer.setData(dragType, dragValue);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onAdd}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onAdd();
        }
      }}
      data-testid={testId}
      title={subtitle}
    >
      <span className="li-icon">
        <Icon name={icon} size={14} />
      </span>
      <span className="li-main">
        <span className="li-title">{title}</span>
        {subtitle && <span className="li-sub">{subtitle}</span>}
      </span>
      {badge && <span className="li-badge">{badge}</span>}
      <Icon name="plus" size={14} />
    </div>
  );
}

/** The selected track, or null when nothing is selected. */
function useTarget() {
  const id = useUiStore((s) => s.selectedTrackId);
  const track = useProjectStore((s) => s.project.tracks.find((t) => t.id === id) ?? null);
  return track;
}

export function InstrumentsTab({ query }: { query: string }) {
  const track = useTarget();
  const store = useProjectStore;

  const addInstrumentTrack = (preset: string) => {
    const id = store.getState().addTrack('instrument');
    store.getState().applyPreset(id, preset);
    store.getState().setTrack(id, { name: preset });
    useUiStore.getState().selectTrack(id);
  };

  return (
    <div className="browser-list">
      <div className="browser-group">Synth presets</div>
      {SYNTH_PRESETS.filter((p) => matches(query, p.presetName)).map((p) => (
        <Row
          key={p.presetName}
          icon="synth"
          title={p.presetName}
          subtitle={
            track && (track.type === 'instrument' || track.type === 'drum')
              ? `Click to load onto ${track.name}`
              : 'Click to make a new instrument track'
          }
          testId={`browser-instrument-${p.presetName}`}
          onAdd={() => {
            if (track && (track.type === 'instrument' || track.type === 'drum')) {
              store.getState().applyPreset(track.id, p.presetName);
            } else {
              addInstrumentTrack(p.presetName);
            }
          }}
        />
      ))}

      <div className="browser-group">Samplers</div>
      <Row
        icon="sampler"
        title="Quick Sampler"
        subtitle="One sample across the keyboard, trimmed and tuned"
        onAdd={() => {
          const id = store.getState().addTrack('instrument');
          store.getState().setInstrument(id, 'quick');
          useUiStore.getState().selectTrack(id);
        }}
      />
      <Row
        icon="grid"
        title="Drum Rack"
        subtitle="Up to 104 MIDI-addressable pads"
        onAdd={() => {
          const id = store.getState().addTrack('drum');
          store.getState().setInstrument(id, 'drum');
          useUiStore.getState().selectTrack(id);
        }}
      />
      <Row
        icon="layers"
        title="Multisample"
        subtitle="Key zones, velocity layers and round robins"
        onAdd={() => {
          const id = store.getState().addTrack('instrument');
          store.getState().setInstrument(id, 'multi');
          useUiStore.getState().selectTrack(id);
        }}
      />

      <div className="browser-group">Note effects</div>
      {NOTE_FX_SPECS.filter((s) => matches(query, `${s.label} ${s.blurb}`)).map((s) => (
        <Row
          key={s.kind}
          icon="note"
          title={s.label}
          subtitle={s.blurb}
          testId={`browser-notefx-${s.kind}`}
          onAdd={() => {
            if (!track || (track.type !== 'instrument' && track.type !== 'drum')) {
              useUiStore.getState().toast('error', 'Select an instrument track first.');
              return;
            }
            store.getState().addNoteFx(track.id, s.kind as NoteFxKind);
          }}
        />
      ))}
    </div>
  );
}

export function EffectsTab({ query }: { query: string }) {
  const track = useTarget();
  const store = useProjectStore;

  const addTo = (kind: EffectKind, params?: Record<string, number>) => {
    if (!track) {
      useUiStore.getState().toast('error', 'Select a track first.');
      return;
    }
    const id = store.getState().addEffect(track.id, kind);
    if (!id) {
      useUiStore.getState().toast('error', 'This track has no free insert slots.');
      return;
    }
    for (const [k, v] of Object.entries(params ?? {})) {
      store.getState().setEffectParam(track.id, id, k, v);
    }
  };

  const chains = CHAIN_PRESETS.filter((c) => matches(query, `${c.name} ${c.blurb}`));
  const groups = EFFECT_GROUPS.map((group) => ({
    group,
    list: effectsInGroup(group).filter((s) => matches(query, `${s.label} ${s.blurb}`)),
  })).filter((g) => g.list.length > 0);

  // Every group returning nothing used to render an empty panel with no
  // explanation — the projects tab already says so, one directory over.
  if (chains.length === 0 && groups.length === 0) {
    return (
      <div className="browser-list">
        <div className="empty-state">
          <Icon name="sliders" size={26} className="es-icon" />
          <div className="es-title">Nothing matches “{query}”</div>
          <p className="es-body">Try a shorter word, or clear the search to see all 27 effects.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="browser-list">
      {chains.length > 0 && <div className="browser-group">Chains</div>}
      {chains.map((c) => (
        <Row
          key={c.id}
          icon="layers"
          title={c.name}
          subtitle={c.blurb}
          badge={`${c.steps.length}`}
          testId={`browser-chain-${c.id}`}
          onAdd={() => {
            for (const step of c.steps) addTo(step.kind, step.params);
          }}
        />
      ))}

      {groups.map(({ group, list }) => {
        return (
          <div key={group}>
            <div className="browser-group">{EFFECT_GROUP_LABELS[group]}</div>
            {list.map((s) => {
              const presets = presetsFor(s.kind);
              return (
                <Row
                  key={s.kind}
                  icon="sliders"
                  title={s.label}
                  subtitle={s.blurb}
                  badge={presets.length ? `${presets.length}` : undefined}
                  testId={`browser-effect-${s.kind}`}
                  onAdd={() => addTo(s.kind)}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
