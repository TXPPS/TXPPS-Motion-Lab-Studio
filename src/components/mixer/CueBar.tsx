/**
 * The cue-mix bar above the console.
 *
 * Monitoring a cue is a mode, and a mode that is not obvious is a mode that
 * gets left on — so the bar changes colour, the strips change with it, and
 * getting back to the main mix is one click that is always in the same place.
 */
import { cueTouchedCount, findCue, MAX_CUE_MIXES } from '../../model/cueMix';
import { engine } from '../../audio/engine';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

export function CueBar() {
  const cues = useProjectStore((s) => s.project.cueMixes);
  const monitorCueId = useUiStore((s) => s.monitorCueId);
  const active = findCue(cues, monitorCueId);
  const list = cues ?? [];

  const monitor = (id: string | null) => {
    useUiStore.getState().set({ monitorCueId: id });
    engine.setMonitorCue(id);
  };

  const addCue = () => {
    const id = useProjectStore.getState().addCueMix();
    if (id) monitor(id);
  };

  if (list.length === 0) {
    return (
      <div className="cue-bar" data-testid="cue-bar">
        <span className="t-label">Cue mixes</span>
        <span className="hint">A separate headphone balance, off the same channels.</span>
        <span className="grow" />
        <button className="btn" onClick={addCue} data-testid="cue-add">
          <Icon name="headphones" size={13} /> Add a cue
        </button>
      </div>
    );
  }

  return (
    <div className={`cue-bar${active ? ' live' : ''}`} data-testid="cue-bar">
      <div className="seg" role="group" aria-label="Which mix the console shows">
        <button
          className={active ? '' : 'on'}
          aria-pressed={!active}
          onClick={() => monitor(null)}
          data-testid="cue-main"
        >
          Main
        </button>
        {list.map((c) => (
          <button
            key={c.id}
            className={active?.id === c.id ? 'on' : ''}
            aria-pressed={active?.id === c.id}
            onClick={() => monitor(c.id)}
            data-testid={`cue-${c.name}`}
            title={`${cueTouchedCount(c)} channel(s) differ from the main mix`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {active ? (
        <>
          <span className="cue-live">Monitoring {active.name}</span>
          <label className="cue-level">
            <span className="k">Level</span>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.01}
              value={active.level}
              aria-label={`${active.name} level`}
              onChange={(e) =>
                useProjectStore.getState().setCueMix(active.id, { level: Number(e.target.value) })
              }
            />
          </label>
          <button
            className={`th-mini${active.ignoreSolo ? ' on' : ''}`}
            aria-pressed={active.ignoreSolo}
            aria-label="Ignore the main mix's solo"
            title="A headphone mix that goes silent when the engineer solos is one nobody trusts"
            onClick={() =>
              useProjectStore.getState().setCueMix(active.id, { ignoreSolo: !active.ignoreSolo })
            }
          >
            S✕
          </button>
          <span className="grow" />
          <button
            className="btn"
            onClick={() => useProjectStore.getState().matchCueToMain(active.id)}
            title="Take every channel back to the main mix's balance"
            data-testid="cue-match"
          >
            Match main
          </button>
          <button
            className="th-mini"
            aria-label={`Rename ${active.name}`}
            onClick={() =>
              useUiStore.getState().showDialog({
                kind: 'prompt',
                title: 'Rename cue mix',
                initialValue: active.name,
                confirmLabel: 'Rename',
                onSubmit: (v) => v && useProjectStore.getState().renameCueMix(active.id, v),
              })
            }
          >
            <Icon name="pencil" size={13} />
          </button>
          <button
            className="th-mini"
            aria-label={`Delete ${active.name}`}
            onClick={() => {
              monitor(null);
              useProjectStore.getState().removeCueMix(active.id);
            }}
          >
            <Icon name="trash" size={13} />
          </button>
        </>
      ) : (
        <>
          <span className="grow" />
          <button
            className="btn"
            onClick={addCue}
            disabled={list.length >= MAX_CUE_MIXES}
            data-testid="cue-add"
          >
            <Icon name="plus" size={13} /> Cue
          </button>
        </>
      )}
    </div>
  );
}
