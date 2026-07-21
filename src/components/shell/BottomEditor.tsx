import { useRef } from 'react';
import { useUiStore, type EditorTab } from '../../state/uiStore';
import { Mixer } from '../mixer/Mixer';
import { PianoRoll } from '../pianoroll/PianoRoll';
import { SynthPanel } from '../synth/SynthPanel';
import { DiagnosticsPanel } from '../diagnostics/DiagnosticsPanel';
import { Icon } from '../common/Icon';

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'piano', label: 'Piano Roll' },
  { id: 'synth', label: 'Synth' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export function BottomEditor({
  height,
  onResize,
}: {
  height: number;
  onResize: (h: number) => void;
}) {
  const tab = useUiStore((s) => s.editorTab);
  const startRef = useRef<{ y: number; h: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    startRef.current = { y: e.clientY, h: height };
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!startRef.current) return;
      const dy = startRef.current.y - ev.clientY;
      onResize(Math.max(150, Math.min(window.innerHeight * 0.7, startRef.current.h + dy)));
    };
    const up = () => {
      startRef.current = null;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="editor-panel" style={{ height }} data-testid="bottom-editor">
      <div className="editor-resize" onPointerDown={onPointerDown} title="Drag to resize" />
      <div className="editor-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? ' on' : ''}`}
            onClick={() => useUiStore.getState().set({ editorTab: t.id })}
            data-testid={`editor-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
        <div className="tab-actions">
          <button
            className="icon-btn"
            onClick={() => useUiStore.getState().set({ panelEditor: false })}
            title="Hide editor"
            aria-label="Hide editor"
          >
            <Icon name="chevron-down" size={15} />
          </button>
        </div>
      </div>
      <div className="editor-body">
        {tab === 'mixer' && <Mixer />}
        {tab === 'piano' && <PianoRoll />}
        {tab === 'synth' && <SynthPanel />}
        {tab === 'diagnostics' && <DiagnosticsPanel />}
      </div>
    </div>
  );
}
