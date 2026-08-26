/**
 * The Motion Wave face, fetched when a unit is actually opened.
 *
 * `MotionWaveFace` imports `motionwave/ui/render/facePanel`, which pulls in
 * every unit's artwork, the whole control-primitive set and the design system
 * behind them — 44 kB of the entry chunk, measured off the sourcemap, in a
 * bundle a musician waits for before they can do anything. None of it is
 * needed until a Motion Wave device is opened, and a session that never opens
 * one never needs any of it.
 *
 * Both call sites are already conditional — the inline rack renders this only
 * for a Motion Wave kind, and the floating window only for the same — so the
 * boundary is exactly where the code split wants to be.
 *
 * The fallback is a sized, empty panel rather than a spinner. A face arriving
 * into a collapsed box would reflow the rack under the pointer that opened it,
 * and the panel's height is fixed by the unit anyway.
 */
import { Suspense, lazy } from 'react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import type { Effect } from '../../model/types';

const Face = lazy(() => import('./MotionWaveFace').then((m) => ({ default: m.MotionWaveFace })));

export function MotionWaveFaceLazy({ trackId, effect }: { trackId: string; effect: Effect }) {
  return (
    /*
     * Its own boundary, inside the workspace's.
     *
     * A `lazy` import that cannot be fetched throws, and a throw with no nearer
     * boundary unmounts everything up to the workspace's — so one face chunk
     * failing on a flaky connection would take the whole console with it. The
     * insert is still on the channel and still making sound either way; what is
     * missing is its picture, and that is worth exactly one panel.
     */
    <ErrorBoundary label={`motion wave face (${effect.kind})`}>
      <Suspense fallback={<div className="mw-face-loading" aria-hidden="true" />}>
        <Face trackId={trackId} effect={effect} />
      </Suspense>
    </ErrorBoundary>
  );
}
