import { useEffect, useState } from 'react';
import { captureLayout, type LayoutSnapshot } from '../../diagnostics/layout';
import { useUiStore } from '../../state/uiStore';

/**
 * QA-only layout overlay. Enabled by the `#/qa` or `#/debug` hash routes and
 * never rendered in normal production use.
 */
export function LayoutDebugHud() {
  const enabled = useUiStore((s) => s.debugOverlay);
  const [snap, setSnap] = useState<LayoutSnapshot | null>(null);
  const [outline, setOutline] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSnap(null);
      return;
    }
    const tick = () => setSnap(captureLayout());
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [enabled]);

  useEffect(() => {
    document.body.classList.toggle('debug-outline', enabled && outline);
    return () => document.body.classList.remove('debug-outline');
  }, [enabled, outline]);

  if (!enabled || !snap) return null;
  const hRange = (snap.arrScrollW ?? 0) - (snap.arrClientW ?? 0);
  const vRange = (snap.arrScrollH ?? 0) - (snap.arrClientH ?? 0);
  const mRange = (snap.mixerScrollW ?? 0) - (snap.mixerClientW ?? 0);

  const row = (k: string, v: string | number, bad = false) => (
    <div className="hud-row" key={k}>
      <span className="k">{k}</span>
      <span className={bad ? 'bad' : ''}>{v}</span>
    </div>
  );

  return (
    <div className="debug-hud" data-testid="debug-hud">
      {row('viewport', `${snap.viewportW}x${snap.viewportH} @${snap.dpr}`)}
      {row('visual', `${snap.visualW ?? '-'}x${snap.visualH ?? '-'}`)}
      {row('breakpoint', snap.breakpoint)}
      {row('workspace', snap.workspace)}
      {row('doc overflow x', snap.docOverflowX, snap.docOverflowX > 0)}
      {row('doc overflow y', snap.docOverflowY, snap.docOverflowY > 0)}
      {row('arr scrollLeft', snap.arrScrollLeft ?? '-')}
      {row('arr scrollTop', snap.arrScrollTop ?? '-')}
      {row('arr h-range', hRange, hRange <= 0)}
      {row('arr v-range', vRange, vRange <= 0)}
      {row('timeline w', snap.arrScrollW ?? '-')}
      {row('mixer scrollLeft', snap.mixerScrollLeft ?? '-')}
      {row('mixer h-range', mRange)}
      {row('safe area', snap.safeArea)}
      {row(
        'overflowing',
        snap.overflowing.length === 0
          ? 'none'
          : snap.overflowing.map((o) => `${o.label}+${o.overhangPx}`).join(', '),
        snap.overflowing.length > 0,
      )}
      <div className="hud-row" style={{ marginTop: 6 }}>
        <button className="btn" style={{ height: 22 }} onClick={() => setOutline((v) => !v)}>
          {outline ? 'Hide' : 'Show'} boxes
        </button>
      </div>
    </div>
  );
}
