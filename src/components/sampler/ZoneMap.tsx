/**
 * The multisample's key and velocity map.
 *
 * A multisample is a two-dimensional instrument — a zone answers a rectangle of
 * keys and velocities — and a list of number pairs is the one presentation that
 * hides that. This is the rectangle, drawn.
 *
 * The selected zone gets its crossfade traced across the keys, taken from
 * `matchZones` itself: the linear taper through an overlap is the part no
 * number in the row can show, and asking the audio's own matcher for it means
 * the trace cannot claim a fade the voice does not apply.
 */
import { useMemo } from 'react';
import { midiToName } from '../../model/music';
import type { SampleZone } from '../../model/sampler';
import { zoneKeyProfile } from '../../model/synthFace';

const W = 512;
const H = 150;
const KEYS = 128;
/** Velocity the crossfade is traced at: the middle of the useful range. */
const TRACE_VELOCITY = 100;

const xOfKey = (key: number): number => (key / KEYS) * W;
const yOfVel = (vel: number): number => H - (vel / 127) * H;

/** C at every octave, which is where a keyboard is read from. */
const OCTAVE_KEYS = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120];
/** The black keys of one octave, for the ruler under the map. */
const BLACK = new Set([1, 3, 6, 8, 10]);

export function ZoneMap({
  zones,
  selectedId,
}: {
  zones: readonly SampleZone[];
  selectedId: string | null;
}) {
  const trace = useMemo(() => {
    const zone = zones.find((z) => z.id === selectedId);
    if (!zone) return null;
    const keys = Array.from({ length: KEYS }, (_, k) => k);
    const profile = zoneKeyProfile(zones, zone.id, TRACE_VELOCITY, keys);
    const top = yOfVel(zone.velHi);
    const bottom = yOfVel(zone.velLo);
    return profile
      .map(
        (g, k) =>
          `${k === 0 ? 'M' : 'L'} ${xOfKey(k + 0.5).toFixed(1)} ${(
            bottom -
            g * (bottom - top)
          ).toFixed(1)}`,
      )
      .join(' ');
  }, [zones, selectedId]);

  const selected = zones.find((z) => z.id === selectedId) ?? null;
  const label = `Key and velocity map, ${zones.length} zone${zones.length === 1 ? '' : 's'}${
    selected
      ? `. ${selected.name} covers ${midiToName(selected.keyLo)} to ${midiToName(
          selected.keyHi,
        )}, velocity ${selected.velLo} to ${selected.velHi}`
      : ''
  }`;

  return (
    <div className="ins-plot zone-map" data-testid="zone-map">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        {OCTAVE_KEYS.map((k) => (
          <line
            key={k}
            x1={xOfKey(k)}
            y1={0}
            x2={xOfKey(k)}
            y2={H}
            stroke="var(--grid-beat)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {[32, 64, 96].map((v) => (
          <line
            key={v}
            x1={0}
            y1={yOfVel(v)}
            x2={W}
            y2={yOfVel(v)}
            stroke="var(--grid-sub)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Zone mapping is data, and the data domain is blue (§2.1). */}
        {zones.map((z) => (
          <rect
            key={z.id}
            x={xOfKey(z.keyLo)}
            y={yOfVel(z.velHi)}
            width={Math.max(1.5, xOfKey(z.keyHi + 1) - xOfKey(z.keyLo))}
            height={Math.max(1.5, yOfVel(z.velLo) - yOfVel(z.velHi))}
            fill={z.id === selectedId ? 'var(--solo)' : 'var(--mute)'}
            opacity={z.muted ? 0.12 : z.id === selectedId ? 0.3 : 0.22}
            stroke={z.id === selectedId ? 'var(--solo-hi)' : 'var(--mute-line)'}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {trace && (
          <path
            d={trace}
            fill="none"
            stroke="var(--fx-eq)"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* A key ruler, so the horizontal axis is a keyboard rather than a number. */}
      <div className="zone-map-keys" aria-hidden="true">
        {Array.from({ length: KEYS }, (_, k) => (
          <span key={k} className={BLACK.has(k % 12) ? 'black' : 'white'} />
        ))}
      </div>
      <div className="zone-map-axis" aria-hidden="true">
        {OCTAVE_KEYS.map((k) => (
          <span key={k} className="t-num" style={{ left: `${(k / KEYS) * 100}%` }}>
            {midiToName(k)}
          </span>
        ))}
      </div>
    </div>
  );
}
