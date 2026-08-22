/**
 * Macro knobs.
 *
 * Eight assignable controls per track, each wired to any number of the track's
 * own parameters over its own range and in its own direction — one "Intensity"
 * knob that opens a filter, adds drive and pulls a reverb back. A macro writes
 * the real parameters, so it needs no support from the engine, works under
 * automation, and renders in an offline bounce like anything else.
 */
import { useState } from 'react';
import { MAX_MACROS, describeMacro, targetNorm } from '../../model/macros';
import { findAutoParam, listAutoParams } from '../../model/paramRegistry';
import type { Track } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { usePointerDrag } from '../../hooks/usePointerDrag';
import { clamp } from '../../model/music';
import { Icon } from '../common/Icon';

function MacroKnob({
  value,
  onChange,
  label,
  size = 48,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  size?: number;
}) {
  const onPointerDown = usePointerDrag<number>({
    onStart: () => value,
    onMove: (_dx, dy, e, start) => onChange(clamp(start - dy / (e.shiftKey ? 900 : 140), 0, 1)),
  });
  const r = size / 2;
  const angle = -135 + value * 270;
  const point = (a: number, radius: number) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `${(r + Math.cos(rad) * radius).toFixed(2)} ${(r + Math.sin(rad) * radius).toFixed(2)}`;
  };
  const track = r - 3;
  return (
    <div
      className="knob macro-knob"
      style={{ width: size, height: size }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onChange(0)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.01 : 0.05;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          onChange(clamp(value + step, 0, 1));
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          onChange(clamp(value - step, 0, 1));
        }
      }}
      tabIndex={0}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.round(value * 100) / 100}
      aria-valuetext={`${Math.round(value * 100)}%`}
    >
      <svg width={size} height={size} aria-hidden>
        <path
          d={`M ${point(-135, track)} A ${track} ${track} 0 1 1 ${point(135, track)}`}
          fill="none"
          stroke="var(--bg-deep)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d={`M ${point(-135, track)} A ${track} ${track} 0 ${angle > 45 ? 1 : 0} 1 ${point(
            angle,
            track,
          )}`}
          fill="none"
          stroke="var(--warm)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx={r} cy={r} r={r - 9} fill="var(--bg-raised)" stroke="var(--border-strong)" />
        <line
          x1={point(angle, r - 16).split(' ')[0]}
          y1={point(angle, r - 16).split(' ')[1]}
          x2={point(angle, r - 10).split(' ')[0]}
          y2={point(angle, r - 10).split(' ')[1]}
          stroke="var(--text)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function MacroPanel({ track }: { track: Track }) {
  const project = useProjectStore((s) => s.project);
  const store = useProjectStore;
  const [openId, setOpenId] = useState<string | null>(null);
  const macros = track.macros ?? [];

  const assignMenu = (macroId: string, x: number, y: number) => {
    const params = listAutoParams(track, project);
    const macro = macros.find((m) => m.id === macroId);
    useUiStore.getState().showMenu({
      x,
      y,
      items: params.slice(0, 40).map((p) => ({
        label: `${macro?.targets.some((t) => t.paramId === p.id) ? '● ' : ''}${p.name}`,
        action: () =>
          macro?.targets.some((t) => t.paramId === p.id)
            ? store.getState().removeMacroTarget(track.id, macroId, p.id)
            : store.getState().assignMacroTarget(track.id, macroId, p.id),
      })),
    });
  };

  return (
    <div className="macro-panel" data-testid={`macros-${track.id}`}>
      <div className="ps-title">Macros</div>
      {macros.length === 0 && (
        <div className="hint">
          One control, several parameters. Add a macro, then assign what it should move.
        </div>
      )}

      <div className="macro-grid">
        {macros.map((macro) => (
          <div key={macro.id} className={`macro${openId === macro.id ? ' open' : ''}`}>
            <MacroKnob
              value={macro.value}
              label={macro.name}
              onChange={(v) => store.getState().setMacroValue(track.id, macro.id, v)}
            />
            <button
              className="macro-name"
              title={describeMacro(macro, track, project)}
              onClick={() =>
                useUiStore.getState().showDialog({
                  kind: 'prompt',
                  title: 'Rename macro',
                  initialValue: macro.name,
                  onSubmit: (v) => v && store.getState().renameMacro(track.id, macro.id, v),
                })
              }
            >
              {macro.name}
            </button>
            <span className="macro-count">{macro.targets.length || '–'}</span>
            <div className="macro-actions">
              <button
                className="icon-btn"
                title="Assign parameters"
                aria-label={`Assign parameters to ${macro.name}`}
                onClick={(e) => assignMenu(macro.id, e.clientX, e.clientY)}
              >
                <Icon name="link" size={12} />
              </button>
              <button
                className="icon-btn"
                title={openId === macro.id ? 'Hide ranges' : 'Show ranges'}
                aria-label={`Ranges for ${macro.name}`}
                aria-expanded={openId === macro.id}
                disabled={macro.targets.length === 0}
                onClick={() => setOpenId(openId === macro.id ? null : macro.id)}
              >
                <Icon name="sliders" size={12} />
              </button>
              <button
                className="icon-btn"
                title="Remove macro"
                aria-label={`Remove ${macro.name}`}
                onClick={() => store.getState().removeMacro(track.id, macro.id)}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>

            {openId === macro.id && (
              <div className="macro-targets">
                {macro.targets.map((t) => {
                  const desc = findAutoParam(track, project, t.paramId);
                  return (
                    <div key={t.paramId} className="macro-target">
                      <span className="k" title={t.paramId}>
                        {desc?.name ?? t.paramId}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={t.from}
                        aria-label={`${desc?.name ?? t.paramId} at macro minimum`}
                        onChange={(e) =>
                          store
                            .getState()
                            .setMacroTargetRange(
                              track.id,
                              macro.id,
                              t.paramId,
                              Number(e.target.value),
                              t.to,
                            )
                        }
                      />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={t.to}
                        aria-label={`${desc?.name ?? t.paramId} at macro maximum`}
                        onChange={(e) =>
                          store
                            .getState()
                            .setMacroTargetRange(
                              track.id,
                              macro.id,
                              t.paramId,
                              t.from,
                              Number(e.target.value),
                            )
                        }
                      />
                      <span className="v t-num">
                        {desc
                          ? desc.format(
                              desc.min + (desc.max - desc.min) * targetNorm(t, macro.value),
                            )
                          : ''}
                      </span>
                      <button
                        className="icon-btn"
                        aria-label={`Unassign ${desc?.name ?? t.paramId}`}
                        onClick={() =>
                          store.getState().removeMacroTarget(track.id, macro.id, t.paramId)
                        }
                      >
                        <Icon name="x" size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        className="btn"
        disabled={macros.length >= MAX_MACROS}
        onClick={() => store.getState().addMacro(track.id)}
        data-testid={`add-macro-${track.id}`}
      >
        <Icon name="plus" size={13} /> Macro
      </button>
    </div>
  );
}
