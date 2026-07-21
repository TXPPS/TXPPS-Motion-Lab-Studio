import { useEffect, useState } from 'react';
import { useUiStore } from '../state/uiStore';

export type Layout = 'desktop' | 'tablet' | 'phone';

function compute(width: number): Layout {
  if (width < 700) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

export function useViewport(): { layout: Layout; width: number; height: number } {
  const forced = useUiStore((s) => s.forcedLayout);
  const [size, setSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return {
    layout: forced === 'phone' ? 'phone' : compute(size.width),
    width: size.width,
    height: size.height,
  };
}
