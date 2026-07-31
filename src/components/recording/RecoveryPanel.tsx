import { useEffect, useState } from 'react';
import {
  describeRecovery,
  discardAllRecoveries,
  discardRecovery,
  recoverTake,
  scanRecoveries,
} from '../../app/recoveryActions';
import type { RecoveryRecord } from '../../persistence/mediaStore';
import { useInputStore } from '../../state/inputStore';
import { useUiStore } from '../../state/uiStore';

/**
 * Interrupted takes waiting to be recovered or discarded.
 *
 * Rendered only when something is actually pending, so it never occupies space
 * in the normal case. Discarding is confirmed because the audio is gone for
 * good afterwards.
 */
export function RecoveryPanel() {
  const pending = useInputStore((s) => s.pendingRecoveries);
  const [recs, setRecs] = useState<RecoveryRecord[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pending > 0) void scanRecoveries().then(setRecs);
    else setRecs([]);
  }, [pending]);

  if (pending === 0 || recs.length === 0) return null;

  const confirmDiscard = (label: string, run: () => Promise<unknown>) => {
    useUiStore.getState().showDialog({
      kind: 'confirm',
      title: 'Discard recording?',
      message: `${label}\n\nThis permanently deletes the audio.`,
      confirmLabel: 'Discard',
      danger: true,
      onSubmit: () => {
        setBusy(true);
        void run().finally(() => setBusy(false));
      },
    });
  };

  return (
    <div className="recovery-panel" data-testid="recovery-panel">
      <div className="ps-title">
        Unfinished recordings ({recs.length})
      </div>
      <div className="hint">
        These takes were captured but never made it onto the timeline. Recovering adds one to the
        current project.
      </div>
      {recs.map((r) => (
        <div className="recovery-row" key={r.id} data-testid={`recovery-${r.id}`}>
          <div className="rr-meta" title={describeRecovery(r)}>
            {describeRecovery(r)}
          </div>
          <div className="rr-actions">
            <button
              className="btn primary"
              disabled={busy}
              data-testid={`recover-${r.id}`}
              onClick={() => {
                setBusy(true);
                void recoverTake(r)
                  .then(() => scanRecoveries().then(setRecs))
                  .finally(() => setBusy(false));
              }}
            >
              Recover
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                confirmDiscard(describeRecovery(r), () =>
                  discardRecovery(r).then(() => scanRecoveries().then(setRecs)),
                )
              }
            >
              Discard
            </button>
          </div>
        </div>
      ))}
      {recs.length > 1 && (
        <button
          className="btn danger"
          disabled={busy}
          onClick={() =>
            confirmDiscard(`All ${recs.length} unfinished recordings`, () =>
              discardAllRecoveries().then(() => setRecs([])),
            )
          }
        >
          Discard all
        </button>
      )}
    </div>
  );
}
