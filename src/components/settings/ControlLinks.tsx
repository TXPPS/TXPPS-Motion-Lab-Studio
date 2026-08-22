/**
 * Control Link — the list of hardware bindings, and the way to make one.
 *
 * Learning is the whole interaction: pick what should move, then move the
 * control. Typing a CC number is the fallback path in every product that has
 * this, and it is the path nobody uses, so it is not offered here.
 */
import { useEffect, useState } from 'react';
import { beginLearn, cancelLearn } from '../../audio/controlLink';
import { midi } from '../../audio/midi';
import {
  describeSource,
  describeTarget,
  targetExists,
  type ControlMode,
  type ControlTarget,
  type TransportCommand,
} from '../../model/controlLink';
import { listAutoParams } from '../../model/paramRegistry';
import { isAudioTrackType } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { Icon } from '../common/Icon';

const TRANSPORT_COMMANDS: { id: TransportCommand; label: string }[] = [
  { id: 'playStop', label: 'Play / Stop' },
  { id: 'play', label: 'Play' },
  { id: 'stop', label: 'Stop' },
  { id: 'record', label: 'Record' },
  { id: 'loop', label: 'Loop' },
  { id: 'metronome', label: 'Metronome' },
  { id: 'rewind', label: 'Back one bar' },
  { id: 'forward', label: 'Forward one bar' },
];

const MODES: { id: ControlMode; label: string; hint: string }[] = [
  { id: 'absolute', label: 'Absolute', hint: 'A fader or knob that sends its position' },
  { id: 'relative', label: 'Relative', hint: 'An endless encoder that sends a direction' },
  { id: 'toggle', label: 'Toggle', hint: 'A button that flips between the ends' },
];

/** The target chooser's three families, kept flat so one select can hold them. */
type TargetChoice = { value: string; label: string; target: ControlTarget };

export function ControlLinks() {
  const project = useProjectStore((s) => s.project);
  const links = project.controlLinks ?? [];
  const [pending, setPending] = useState<ControlTarget | null>(null);
  const [choice, setChoice] = useState('transport:playStop');

  // Learning holds a module-level handler; leaving the panel must release it,
  // or the next control the user plays is silently swallowed.
  useEffect(() => () => cancelLearn(), []);

  const choices: TargetChoice[] = [];
  for (const c of TRANSPORT_COMMANDS) {
    choices.push({
      value: `transport:${c.id}`,
      label: `Transport · ${c.label}`,
      target: { kind: 'transport', command: c.id },
    });
  }
  choices.push({
    value: 'master:volume',
    label: 'Master · Volume',
    target: { kind: 'master', param: 'volume' },
  });
  choices.push({
    value: 'master:tempo',
    label: 'Master · Tempo',
    target: { kind: 'master', param: 'tempo' },
  });
  for (const track of project.tracks) {
    for (const macro of track.macros ?? []) {
      choices.push({
        value: `macro:${track.id}:${macro.id}`,
        label: `${track.name} · ${macro.name}`,
        target: { kind: 'macro', trackId: track.id, macroId: macro.id },
      });
    }
    if (!isAudioTrackType(track.type)) continue;
    for (const param of listAutoParams(track, project)) {
      choices.push({
        value: `param:${track.id}:${param.id}`,
        label: `${track.name} · ${param.name}`,
        target: { kind: 'param', trackId: track.id, paramId: param.id },
      });
    }
  }

  const learn = () => {
    const found = choices.find((c) => c.value === choice);
    if (!found) return;
    if (!midi.supported) return;
    setPending(found.target);
    void midi.enable();
    beginLearn((source) => {
      useProjectStore.getState().addControlLink(source, found.target);
      setPending(null);
    });
  };

  const stopLearning = () => {
    cancelLearn();
    setPending(null);
  };

  return (
    <div className="ctl-links" data-testid="control-links">
      {!midi.supported && (
        <p className="hint">
          This browser has no Web MIDI, so there is nothing to bind. Chrome and Edge do.
        </p>
      )}

      <div className="ctl-learn">
        <select
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          aria-label="What the control should move"
          data-testid="control-target"
        >
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {pending ? (
          <button className="btn danger" onClick={stopLearning} data-testid="control-learn-cancel">
            Move a control… (cancel)
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={learn}
            disabled={!midi.supported}
            data-testid="control-learn"
          >
            Learn
          </button>
        )}
      </div>

      {links.length === 0 ? (
        <p className="hint">No bindings yet.</p>
      ) : (
        <ul className="ctl-list">
          {links.map((link) => {
            const alive = targetExists(link.target, project);
            return (
              <li key={link.id} className={`ctl-row${alive ? '' : ' broken'}`}>
                <span className="ctl-src">{describeSource(link.source)}</span>
                <Icon name="chevron-right" size={13} />
                <span
                  className="ctl-tgt"
                  title={alive ? undefined : 'This target no longer exists'}
                >
                  {describeTarget(link.target, project)}
                </span>
                <select
                  className="mini"
                  value={link.mode}
                  aria-label={`Mode for ${describeSource(link.source)}`}
                  onChange={(e) =>
                    useProjectStore
                      .getState()
                      .updateControlLink(link.id, { mode: e.target.value as ControlMode })
                  }
                >
                  {MODES.map((m) => (
                    <option key={m.id} value={m.id} title={m.hint}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <button
                  className={`th-mini${link.invert ? ' on' : ''}`}
                  aria-pressed={link.invert}
                  aria-label={`Invert ${describeSource(link.source)}`}
                  title="Invert the direction"
                  onClick={() =>
                    useProjectStore.getState().updateControlLink(link.id, { invert: !link.invert })
                  }
                >
                  <Icon name="phase" size={13} />
                </button>
                <button
                  className="th-mini"
                  aria-label={`Remove ${describeSource(link.source)}`}
                  onClick={() => useProjectStore.getState().removeControlLink(link.id)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {links.length > 0 && (
        <button
          className="btn"
          onClick={() => useProjectStore.getState().clearControlLinks()}
          data-testid="control-clear"
        >
          Remove every binding
        </button>
      )}
    </div>
  );
}
