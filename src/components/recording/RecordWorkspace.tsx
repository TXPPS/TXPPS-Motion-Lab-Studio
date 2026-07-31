import { useEffect } from 'react';
import { audioInput } from '../../audio/inputManager';
import { recordTargetTrack } from '../../audio/recordingController';
import { useInputStore } from '../../state/inputStore';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';
import {
  InputMeter,
  RecordButton,
  RecordingBanner,
  TakeReview,
  TrackInputControls,
} from './RecordControls';
import { RecoveryPanel } from './RecoveryPanel';

/**
 * Phone Record workspace.
 *
 * One track at a time, oversized controls, and no desktop mixer — the phone
 * recording flow is selection → arm → monitor → record → review, top to bottom.
 */
export function RecordWorkspace() {
  const tracks = useProjectStore((s) => s.project.tracks);
  const addTrack = useProjectStore((s) => s.addTrack);
  const selectTrack = useUiStore((s) => s.selectTrack);
  const selectedId = useUiStore((s) => s.selectedTrackId);
  const phase = useInputStore((s) => s.phase);

  const audioTracks = tracks.filter((t) => t.type === 'audio');
  const target = recordTargetTrack();
  const activeId = target?.id ?? selectedId;

  useEffect(() => {
    void audioInput.probePermission();
  }, []);

  useEffect(() => {
    // Make sure something sensible is selected when entering the workspace.
    if (!audioTracks.some((t) => t.id === activeId) && audioTracks[0]) {
      selectTrack(audioTracks[0].id);
    }
  }, [audioTracks, activeId, selectTrack]);

  if (audioTracks.length === 0) {
    return (
      <div className="record-page" data-testid="record-workspace">
        <div className="rec-empty">
          <Icon name="record" size={26} />
          <div>No audio track to record onto.</div>
          <button
            className="btn primary"
            onClick={() => selectTrack(addTrack('audio'))}
            data-testid="add-audio-track"
          >
            Add audio track
          </button>
        </div>
      </div>
    );
  }

  const busy = phase === 'recording' || phase === 'countIn';

  return (
    <div className="record-page" data-testid="record-workspace">
      <RecordingBanner />

      <div className="rec-track-picker">
        <label className="k">Track</label>
        <select
          value={activeId ?? ''}
          disabled={busy}
          aria-label="Recording track"
          data-testid="record-track-select"
          onChange={(e) => selectTrack(e.target.value)}
        >
          {audioTracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {activeId && (
        <div className="rec-panel">
          <TrackInputControls trackId={activeId} />
        </div>
      )}

      <div className="rec-big">
        <InputMeter trackId={activeId ?? null} tall />
        <RecordButton />
      </div>

      <TakeReview />
      <RecoveryPanel />
    </div>
  );
}
