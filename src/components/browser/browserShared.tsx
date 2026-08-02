import { useEffect, useState } from 'react';
import { engine } from '../../audio/engine';
import { Icon } from '../common/Icon';

/** Case-insensitive substring match against several fields. */
export function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/**
 * Audition (preview) button for one media id. Auditioning replaces any running
 * preview, so tapping down a list never stacks sounds; the active row shows a
 * stop square. Ended previews clear themselves via a light poll while active.
 */
export function AuditionButton({
  mediaId,
  name,
  onPlay,
}: {
  mediaId: string;
  name: string;
  onPlay?: () => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (engine.auditioningId() !== mediaId) setActive(false);
    }, 250);
    return () => clearInterval(id);
  }, [active, mediaId]);

  return (
    <button
      className={`icon-btn audition${active ? ' on' : ''}`}
      title={active ? 'Stop preview' : 'Preview'}
      aria-label={`${active ? 'Stop preview of' : 'Preview'} ${name}`}
      data-testid={`audition-${mediaId}`}
      onClick={(e) => {
        e.stopPropagation();
        if (active) {
          engine.stopAudition();
          setActive(false);
        } else {
          onPlay?.();
          void engine.audition(mediaId).then((ok) => setActive(ok));
        }
      }}
    >
      <Icon name={active ? 'stop' : 'play'} size={12} />
    </button>
  );
}
