/**
 * Global tracks: markers, arranger sections, chords and tempo.
 *
 * These describe the *song*, not any instrument, so they live above the track
 * list and share the timeline's scroll and zoom. Each lane is one row of fixed
 * height with a header on the left, mirroring the track/lane geometry exactly —
 * anything that maps X to a beat uses the same `pxPerBeat` the lanes use, so a
 * marker can never drift from the clip it marks.
 */
import { memo } from 'react';
import { engine } from '../../audio/engine';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { chordQuality, CHORD_QUALITIES } from '../../model/chords';
import { clamp, snapBeat, tempoMapOf } from '../../model/music';
import { barToBeat, beatToBar, bpmAt } from '../../model/tempo';
import type { ArrangerSection, ChordEvent, Marker } from '../../model/arrangement';
import type { ProjectData } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon, type IconName } from '../common/Icon';

export const GLOBAL_LANE_H = 20;

const PITCH_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** "Gm7", "C/E" — the way a chart writes it. */
export function chordLabel(c: ChordEvent): string {
  const q = chordQuality(c.quality);
  const short: Record<string, string> = {
    maj: '',
    min: 'm',
    dim: '°',
    aug: '+',
    sus2: 'sus2',
    sus4: 'sus4',
    '6': '6',
    min6: 'm6',
    '7': '7',
    maj7: 'maj7',
    min7: 'm7',
    '9': '9',
    '11': '11',
    '13': '13',
  };
  const suffix = short[c.quality] ?? q?.label ?? '';
  const bass = c.bass !== undefined && c.bass !== c.root ? `/${PITCH_NAMES[c.bass]}` : '';
  return `${PITCH_NAMES[c.root]}${suffix}${bass}`;
}

interface LaneProps {
  pxPerBeat: number;
  snap: number;
  timelineW: number;
  project: ProjectData;
}

/** Shared lane frame: a fixed-height row that owns the timeline width. */
function Lane({
  kind,
  children,
  onPointerDown,
  onDoubleClick,
  title,
  timelineW,
}: {
  kind: string;
  children: React.ReactNode;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  title: string;
  timelineW: number;
}) {
  return (
    <div
      className={`gt-lane gt-${kind}`}
      style={{ width: timelineW, height: GLOBAL_LANE_H }}
      data-testid={`global-lane-${kind}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={title}
    >
      {children}
    </div>
  );
}

const beatAtEvent = (
  e: { clientX: number; currentTarget: EventTarget | null },
  pxPerBeat: number,
) => {
  const el = e.currentTarget as HTMLElement | null;
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  return Math.max(0, (e.clientX - rect.left) / pxPerBeat);
};

// ------------------------------------------------------------------ markers

export const MarkerLane = memo(function MarkerLane({
  pxPerBeat,
  snap,
  timelineW,
  project,
}: LaneProps) {
  const markers = project.markers ?? [];
  const store = useProjectStore;

  const dragMarker = usePointerDrag<{ id: string; start: number }>({
    onStart: (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.markerId!;
      store.getState().beginGesture();
      return { id, start: markers.find((m) => m.id === id)?.beat ?? 0 };
    },
    onMove: (dx, _dy, _ev, s) => {
      store
        .getState()
        .setMarker(s.id, { beat: snapBeat(Math.max(0, s.start + dx / pxPerBeat), snap) });
    },
    onEnd: () => store.getState().endGesture(),
  });

  const menu = (m: Marker, x: number, y: number) => {
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        { label: 'Go to marker', action: () => engine.seek(m.beat) },
        {
          label: 'Rename…',
          action: () =>
            useUiStore.getState().showDialog({
              kind: 'prompt',
              title: 'Rename marker',
              initialValue: m.name,
              onSubmit: (name) => store.getState().setMarker(m.id, { name }),
            }),
        },
        {
          label: 'Loop this section',
          action: () => {
            const next = (project.markers ?? []).find((x2) => x2.beat > m.beat + 1e-6);
            store.getState().setLoop({
              enabled: true,
              start: m.beat,
              end: next ? next.beat : m.beat + 16,
            });
          },
        },
        { label: 'Delete', danger: true, action: () => store.getState().removeMarker(m.id) },
      ],
    });
  };

  return (
    <Lane
      kind="markers"
      timelineW={timelineW}
      title="Markers — double-click to add, drag to move"
      onDoubleClick={(e) => {
        const beat = snapBeat(beatAtEvent(e, pxPerBeat), snap);
        store.getState().addMarker(beat);
      }}
    >
      {markers.map((m) => (
        <button
          key={m.id}
          className="gt-marker"
          data-marker-id={m.id}
          style={{ left: m.beat * pxPerBeat, ['--mk-color' as string]: m.color ?? 'var(--warm)' }}
          onPointerDown={dragMarker}
          onClick={() => engine.seek(m.beat)}
          onContextMenu={(e) => {
            e.preventDefault();
            menu(m, e.clientX, e.clientY);
          }}
          title={`${m.name} — click to go, right-click for options`}
        >
          <span className="gt-marker-flag" />
          <span className="gt-marker-name">{m.name}</span>
        </button>
      ))}
    </Lane>
  );
});

// ----------------------------------------------------------------- sections

export const SectionLane = memo(function SectionLane({
  pxPerBeat,
  snap,
  timelineW,
  project,
}: LaneProps) {
  const sections = project.sections ?? [];
  const store = useProjectStore;

  const dragEdge = usePointerDrag<{ id: string; start: number; length: number }>({
    onStart: (e) => {
      const id = (e.currentTarget as HTMLElement).dataset.sectionId!;
      const sec = sections.find((s) => s.id === id);
      store.getState().beginGesture();
      return { id, start: sec?.start ?? 0, length: sec?.length ?? 4 };
    },
    onMove: (dx, _dy, _ev, s) => {
      const length = Math.max(1, snapBeat(s.length + dx / pxPerBeat, Math.max(snap, 1)));
      store.getState().setSection(s.id, { length });
    },
    onEnd: () => store.getState().endGesture(),
  });

  const menu = (sec: ArrangerSection, index: number, x: number, y: number) => {
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        {
          label: 'Loop this section',
          action: () =>
            store
              .getState()
              .setLoop({ enabled: true, start: sec.start, end: sec.start + sec.length }),
        },
        {
          label: 'Rename…',
          action: () =>
            useUiStore.getState().showDialog({
              kind: 'prompt',
              title: 'Rename section',
              initialValue: sec.name,
              onSubmit: (name) => store.getState().setSection(sec.id, { name }),
            }),
        },
        {
          label: 'Move earlier',
          disabled: index === 0,
          action: () => store.getState().moveSection(sec.id, index - 1),
        },
        {
          label: 'Move later',
          disabled: index === sections.length - 1,
          action: () => store.getState().moveSection(sec.id, index + 1),
        },
        {
          label: 'Delete section',
          danger: true,
          action: () => store.getState().removeSection(sec.id),
        },
      ],
    });
  };

  return (
    <Lane
      kind="sections"
      timelineW={timelineW}
      title="Arranger — double-click to add a section, drag its right edge to resize"
      onDoubleClick={(e) => {
        const map = tempoMapOf(project);
        const beat = beatAtEvent(e, pxPerBeat);
        // A new section snaps to whole bars: song sections are bar-aligned by
        // definition, whatever the grid is set to.
        const bar = Math.floor(beatToBar(map, beat));
        const start = barToBeat(map, bar);
        store.getState().addSection(start, barToBeat(map, bar + 8) - start);
      }}
    >
      {sections.map((sec, i) => (
        <div
          key={sec.id}
          className="gt-section"
          style={{
            left: sec.start * pxPerBeat,
            width: Math.max(8, sec.length * pxPerBeat),
            ['--sec-color' as string]: sec.color,
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            menu(sec, i, e.clientX, e.clientY);
          }}
          title={`${sec.name} — right-click to reorder or loop`}
        >
          <span className="gt-section-name">{sec.name}</span>
          <span
            className="gt-section-edge"
            data-section-id={sec.id}
            onPointerDown={dragEdge}
            aria-hidden
          />
        </div>
      ))}
    </Lane>
  );
});

// ------------------------------------------------------------------- chords

export const ChordLane = memo(function ChordLane({
  pxPerBeat,
  snap,
  timelineW,
  project,
}: LaneProps) {
  const chords = project.chords ?? [];
  const store = useProjectStore;

  /**
   * Two steps rather than one 168-item list: root first, then quality. The
   * second menu opens where the first one was, so it reads as one gesture.
   */
  const pickQuality = (beat: number, root: number, x: number, y: number) => {
    useUiStore.getState().showMenu({
      x,
      y,
      items: CHORD_QUALITIES.map((q) => ({
        label: `${PITCH_NAMES[root]}${q.id === 'maj' ? '' : q.id}  ·  ${q.label}`,
        action: () => store.getState().setChord(beat, root, q.id),
      })),
    });
  };

  const pick = (beat: number, x: number, y: number, existing?: ChordEvent) => {
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        ...PITCH_NAMES.map((name, root) => ({
          label: name,
          action: () => pickQuality(beat, root, x, y),
        })),
        ...(existing
          ? [
              {
                label: 'Remove chord',
                danger: true,
                action: () => store.getState().removeChord(existing.id),
              },
            ]
          : []),
      ],
    });
  };

  return (
    <Lane
      kind="chords"
      timelineW={timelineW}
      title="Chord track — double-click to place a chord"
      onDoubleClick={(e) => {
        const beat = snapBeat(beatAtEvent(e, pxPerBeat), Math.max(snap, 1));
        pick(beat, e.clientX, e.clientY);
      }}
    >
      {chords.map((c, i) => {
        const next = chords[i + 1];
        const width = Math.max(14, ((next ? next.beat : c.beat + 4) - c.beat) * pxPerBeat - 2);
        return (
          <button
            key={c.id}
            className="gt-chord"
            style={{ left: c.beat * pxPerBeat, width }}
            onContextMenu={(e) => {
              e.preventDefault();
              pick(c.beat, e.clientX, e.clientY, c);
            }}
            onClick={(e) => pick(c.beat, e.clientX, e.clientY, c)}
            title={`${chordLabel(c)} — click to change`}
          >
            {chordLabel(c)}
          </button>
        );
      })}
    </Lane>
  );
});

// -------------------------------------------------------------------- tempo

export const TempoLane = memo(function TempoLane({
  pxPerBeat,
  snap,
  timelineW,
  project,
}: LaneProps) {
  const map = tempoMapOf(project);
  const store = useProjectStore;

  const dragTempo = usePointerDrag<{ id: string; bpm: number; beat: number; locked: boolean }>({
    onStart: (e) => {
      const el = e.currentTarget as HTMLElement;
      const id = el.dataset.tempoId!;
      const ev = map.tempos.find((t) => t.id === id);
      store.getState().beginGesture();
      return { id, bpm: ev?.bpm ?? 120, beat: ev?.beat ?? 0, locked: (ev?.beat ?? 0) === 0 };
    },
    onMove: (dx, dy, ev, s) => {
      // Vertical drags change the tempo; horizontal drags move the event. The
      // first event is the song's starting tempo and cannot be moved off zero.
      if (Math.abs(dy) >= Math.abs(dx) || s.locked) {
        const fine = ev.shiftKey ? 0.1 : 1;
        store.getState().setTempoEvent(s.beat, clamp(s.bpm - (dy / 4) * fine, 20, 999));
      } else {
        store.getState().moveTempoEvent(s.id, snapBeat(Math.max(0, s.beat + dx / pxPerBeat), snap));
      }
    },
    onEnd: () => store.getState().endGesture(),
  });

  const menu = (id: string, beat: number, x: number, y: number) => {
    const ev = map.tempos.find((t) => t.id === id);
    useUiStore.getState().showMenu({
      x,
      y,
      items: [
        {
          label: 'Set tempo…',
          action: () =>
            useUiStore.getState().showDialog({
              kind: 'prompt',
              title: 'Tempo (BPM)',
              initialValue: String(Math.round((ev?.bpm ?? 120) * 10) / 10),
              onSubmit: (v) => {
                const n = Number(v);
                if (Number.isFinite(n)) store.getState().setTempoEvent(beat, n);
              },
            }),
        },
        {
          label: ev?.curve === 'ramp' ? 'Make it a jump' : 'Ramp to the next tempo',
          action: () =>
            store
              .getState()
              .setTempoEvent(beat, ev?.bpm ?? 120, ev?.curve === 'ramp' ? 'jump' : 'ramp'),
        },
        {
          label: 'Delete tempo change',
          danger: true,
          disabled: beat === 0,
          action: () => store.getState().removeTempoEvent(id),
        },
      ],
    });
  };

  return (
    <Lane
      kind="tempo"
      timelineW={timelineW}
      title="Tempo track — double-click to add a tempo change, drag up/down to set it"
      onDoubleClick={(e) => {
        const beat = snapBeat(beatAtEvent(e, pxPerBeat), Math.max(snap, 1));
        store.getState().setTempoEvent(beat, Math.round(bpmAt(map, beat)));
      }}
    >
      {map.tempos.map((ev) => (
        <button
          key={ev.id}
          className={`gt-tempo${ev.curve === 'ramp' ? ' ramp' : ''}`}
          data-tempo-id={ev.id}
          style={{ left: ev.beat * pxPerBeat }}
          onPointerDown={dragTempo}
          onContextMenu={(e) => {
            e.preventDefault();
            menu(ev.id, ev.beat, e.clientX, e.clientY);
          }}
          title={`${ev.bpm.toFixed(1)} BPM${ev.curve === 'ramp' ? ' — ramps to the next change' : ''}`}
        >
          {ev.bpm.toFixed(ev.bpm % 1 === 0 ? 0 : 1)}
        </button>
      ))}
      {map.sigs.map((sg) => (
        <span
          key={sg.id}
          className="gt-sig"
          style={{ left: barToBeat(map, sg.bar) * pxPerBeat }}
          title={`Time signature ${sg.num}/${sg.den} from bar ${sg.bar + 1}`}
        >
          {sg.num}/{sg.den}
        </span>
      ))}
    </Lane>
  );
});

// ------------------------------------------------------------------ headers

const LANE_META: {
  key: 'showMarkers' | 'showSections' | 'showChords' | 'showTempoLane';
  kind: string;
  label: string;
  icon: IconName;
}[] = [
  { key: 'showMarkers', kind: 'markers', label: 'Markers', icon: 'marker' },
  { key: 'showSections', kind: 'sections', label: 'Arranger', icon: 'section' },
  { key: 'showChords', kind: 'chords', label: 'Chords', icon: 'chord' },
  { key: 'showTempoLane', kind: 'tempo', label: 'Tempo', icon: 'tempo' },
];

/** Left-column headers, one per visible global lane. */
export function GlobalTrackHeaders() {
  const layout = useWorkspaceStore();
  return (
    <>
      {LANE_META.filter((m) => layout[m.key]).map((m) => (
        <div
          key={m.kind}
          className="gt-header"
          style={{ height: GLOBAL_LANE_H }}
          data-testid={`global-header-${m.kind}`}
        >
          <Icon name={m.icon} size={11} />
          <span>{m.label}</span>
          <button
            className="gt-hide"
            title={`Hide the ${m.label.toLowerCase()} track`}
            aria-label={`Hide the ${m.label.toLowerCase()} track`}
            onClick={() => useWorkspaceStore.getState().toggle(m.key)}
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      ))}
    </>
  );
}

/** The lanes themselves, in the same order as the headers. */
export function GlobalTrackLanes(props: LaneProps) {
  const layout = useWorkspaceStore();
  return (
    <>
      {layout.showMarkers && <MarkerLane {...props} />}
      {layout.showSections && <SectionLane {...props} />}
      {layout.showChords && <ChordLane {...props} />}
      {layout.showTempoLane && <TempoLane {...props} />}
    </>
  );
}

/** Menu items for the arrangement toolbar's "global tracks" button. */
export function globalTrackMenuItems() {
  const layout = useWorkspaceStore.getState();
  return LANE_META.map((m) => ({
    label: `${layout[m.key] ? 'Hide' : 'Show'} ${m.label}`,
    action: () => useWorkspaceStore.getState().toggle(m.key),
  }));
}
