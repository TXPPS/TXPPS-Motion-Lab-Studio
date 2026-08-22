/**
 * Groove.
 *
 * The model could already lift a feel off one performance and put it on
 * another; nothing in the product could ask it to. This is the ask: a list of
 * grooves, a strength, and the two verbs — extract, apply.
 */
import { useState } from 'react';
import {
  BUILTIN_GROOVES,
  grooveBeatsPerBar,
  grooveFromNotes,
  type Groove,
} from '../../model/groove';
import type { MidiClip } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { Icon } from '../common/Icon';

const RESOLUTIONS = [
  { value: 2, label: '1/8' },
  { value: 4, label: '1/16' },
];

/**
 * A groove drawn as what it is: a row of slots, each pushed off the grid line
 * and weighted. Reading a swing off numbers is possible; seeing it is quicker.
 */
function GrooveCurve({ groove }: { groove: Groove }) {
  const slots = groove.offsets.length;
  if (slots === 0) return null;
  const w = 100 / slots;
  return (
    <svg className="grv-curve" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden>
      {groove.offsets.map((offset, i) => {
        const x = i * w + w / 2;
        // A quarter of a slot is as late as anything musical ever plays.
        const shift = Math.max(-1, Math.min(1, offset * groove.resolution * 4)) * (w / 2);
        const height = Math.max(2, Math.min(1.6, groove.velocities[i] ?? 1) * 12);
        return (
          <g key={i}>
            <line x1={x} y1={2} x2={x} y2={24} stroke="var(--border)" strokeWidth="0.4" />
            <line
              x1={x + shift}
              y1={24 - height}
              x2={x + shift}
              y2={24}
              stroke="var(--accent)"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

export function GroovePanel({ clip }: { clip: MidiClip }) {
  const saved = useProjectStore((s) => s.project.grooves);
  const [name, setName] = useState(BUILTIN_GROOVES[1].name);
  const [strength, setStrength] = useState(0.8);
  const [resolution, setResolution] = useState(4);

  const all: Groove[] = [...BUILTIN_GROOVES, ...(saved ?? [])];
  const groove = all.find((g) => g.name === name) ?? all[0];

  const extract = () => {
    if (clip.notes.length === 0) return;
    const lifted = grooveFromNotes(clip.notes, resolution, {
      name: `${clip.name} feel`,
      beatsPerBar: 4,
    });
    useProjectStore.getState().saveGroove(lifted);
    setName(lifted.name);
  };

  return (
    <div className="panel-section grv-panel" data-testid="groove-panel">
      <div className="ps-title">
        <span>Groove</span>
        <span className="hint">{grooveBeatsPerBar(groove).toFixed(0)}-beat bar</span>
      </div>

      <select
        value={groove.name}
        onChange={(e) => setName(e.target.value)}
        aria-label="Groove"
        data-testid="groove-select"
      >
        <optgroup label="Built in">
          {BUILTIN_GROOVES.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name}
            </option>
          ))}
        </optgroup>
        {(saved?.length ?? 0) > 0 && (
          <optgroup label="This song">
            {saved?.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <GrooveCurve groove={groove} />

      <div className="insp-row">
        <span className="k">Strength</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={strength}
          onChange={(e) => setStrength(Number(e.target.value))}
          aria-label="Groove strength"
        />
        <span className="v mono">{Math.round(strength * 100)}%</span>
      </div>

      <div className="insp-row">
        <button
          className="btn primary"
          disabled={clip.notes.length === 0}
          onClick={() => useProjectStore.getState().applyGrooveToClip(clip.id, groove, strength)}
          data-testid="groove-apply"
        >
          Apply to clip
        </button>
        <button
          className="btn"
          disabled={clip.notes.length === 0}
          onClick={extract}
          title="Read this clip's own feel into a groove"
          data-testid="groove-extract"
        >
          Extract
        </button>
      </div>

      <div className="insp-row">
        <span className="k">Extract at</span>
        <div className="seg">
          {RESOLUTIONS.map((r) => (
            <button
              key={r.value}
              className={resolution === r.value ? 'on' : ''}
              aria-pressed={resolution === r.value}
              onClick={() => setResolution(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {saved?.some((g) => g.name === groove.name) && (
          <button
            className="th-mini"
            aria-label={`Remove ${groove.name}`}
            onClick={() => {
              useProjectStore.getState().removeGroove(groove.name);
              setName(BUILTIN_GROOVES[0].name);
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
