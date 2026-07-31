import { useEffect, useRef, useState } from 'react';
import { engine } from '../../audio/engine';
import { getPeaksSync, isMissing, loadPeaks } from '../../audio/mediaLibrary';
import { sampleWindow } from '../../audio/peaks';
import type { PeakData } from '../../model/media';

interface WaveformProps {
  mediaId: string;
  /** seconds into the source where the visible window starts */
  offsetSec: number;
  /** seconds of source shown */
  durationSec: number;
  color: string;
  /** clip gain, scales the drawn envelope */
  gain: number;
  /** fade lengths in seconds, drawn as overlays */
  fadeIn: number;
  fadeOut: number;
}

/**
 * Clip waveform.
 *
 * Draws from the cached min/max envelope — never decodes, never walks raw
 * samples, and never creates per-sample DOM. One canvas per clip, redrawn only
 * when its own inputs or size change, which keeps hundreds of clips cheap.
 */
export function Waveform({
  mediaId,
  offsetSec,
  durationSec,
  color,
  gain,
  fadeIn,
  fadeOut,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<PeakData | null>(() => getPeaksSync(mediaId));
  const [missing, setMissing] = useState(() => isMissing(mediaId));

  // Resolve peaks lazily; recorded/imported media loads from IndexedDB.
  useEffect(() => {
    let cancelled = false;
    const have = getPeaksSync(mediaId);
    if (have) {
      setPeaks(have);
      setMissing(false);
      return;
    }
    const ctx = engine.context;
    if (!ctx) {
      setMissing(isMissing(mediaId));
      return;
    }
    void loadPeaks(mediaId, ctx).then((p) => {
      if (cancelled) return;
      setPeaks(p);
      setMissing(!p);
    });
    return () => {
      cancelled = true;
    };
  }, [mediaId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const w = Math.max(1, Math.floor(canvas.offsetWidth));
      const h = Math.max(1, Math.floor(canvas.offsetHeight));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);
      if (!peaks || durationSec <= 0) return;

      // One column per device pixel column is plenty; cap the work for wide clips.
      const cols = Math.min(w, 2000);
      const { min, max } = sampleWindow(peaks, offsetSec, offsetSec + durationSec, cols);
      const mid = h / 2;
      const scale = mid * 0.94 * Math.min(4, Math.max(0, gain));
      const colW = w / cols;

      ctx2d.fillStyle = color;
      ctx2d.globalAlpha = 0.9;
      for (let i = 0; i < cols; i++) {
        const hi = Math.min(mid, max[i] * scale);
        const lo = Math.max(-mid, min[i] * scale);
        const top = mid - hi;
        const height = Math.max(1, hi - lo);
        ctx2d.fillRect(i * colW, top, Math.max(1, colW), height);
      }

      // Fade overlays: shaded triangles showing the real ramp shape.
      ctx2d.globalAlpha = 1;
      const pxPerSec = w / durationSec;
      if (fadeIn > 0) {
        const fw = Math.min(w, fadeIn * pxPerSec);
        ctx2d.fillStyle = 'rgba(4, 8, 12, 0.55)';
        ctx2d.beginPath();
        ctx2d.moveTo(0, 0);
        ctx2d.lineTo(fw, 0);
        ctx2d.lineTo(0, h);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.strokeStyle = 'rgba(232, 228, 218, 0.65)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, h);
        ctx2d.lineTo(fw, 0);
        ctx2d.stroke();
      }
      if (fadeOut > 0) {
        const fw = Math.min(w, fadeOut * pxPerSec);
        ctx2d.fillStyle = 'rgba(4, 8, 12, 0.55)';
        ctx2d.beginPath();
        ctx2d.moveTo(w, 0);
        ctx2d.lineTo(w - fw, 0);
        ctx2d.lineTo(w, h);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.strokeStyle = 'rgba(232, 228, 218, 0.65)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(w - fw, 0);
        ctx2d.lineTo(w, h);
        ctx2d.stroke();
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [peaks, offsetSec, durationSec, color, gain, fadeIn, fadeOut]);

  if (missing) {
    return (
      <div className="clip-missing" data-testid="clip-missing" title="Audio media not found">
        media missing
      </div>
    );
  }
  return <canvas ref={canvasRef} className="clip-wave" />;
}
