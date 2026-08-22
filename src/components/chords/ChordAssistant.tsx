/**
 * Chord Assistant.
 *
 * Three things a songwriter actually asks for: read the chords out of what I
 * played, tell me what could come next and why, and lay a known progression
 * down so I can get on with the melody. Every suggestion carries its reason,
 * because a suggestion you cannot reason about is a slot machine.
 */
import { useMemo, useState } from 'react';
import { engine } from '../../audio/engine';
import {
  PROGRESSIONS,
  chordLabelOf,
  detectChords,
  followChords,
  progressionToChords,
  suggestChords,
  type FollowMode,
} from '../../model/chordAssistant';
import { chordAt } from '../../model/arrangement';
import { buildChord } from '../../model/chords';
import { KEY_NAMES, SCALES } from '../../model/scales';
import { projectEndBeat, useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Icon } from '../common/Icon';

const FOLLOW_MODES: { id: FollowMode; label: string; blurb: string }[] = [
  { id: 'nearest', label: 'Nearest tone', blurb: 'Move each note to the closest chord tone' },
  { id: 'chordTone', label: 'Keep what fits', blurb: 'Only move notes that are not chord tones' },
  { id: 'scale', label: 'Scale only', blurb: 'Only correct notes outside the key' },
  { id: 'bass', label: 'Root', blurb: 'Put everything on the root — for a bass part' },
];

export function ChordAssistant() {
  const project = useProjectStore((s) => s.project);
  const editClipId = useUiStore((s) => s.editClipId);
  const selectedTrackId = useUiStore((s) => s.selectedTrackId);
  const [tonic, setTonic] = useState(0);
  const [scaleId, setScaleId] = useState('major');
  const [follow, setFollow] = useState<FollowMode>('nearest');

  const chords = project.chords ?? [];
  const playhead = engine.getPositionBeats();
  const current = chordAt(chords, playhead);
  const last = chords[chords.length - 1];

  const suggestions = useMemo(
    () =>
      suggestChords(tonic, scaleId, last ? { root: last.root, quality: last.quality } : undefined),
    [tonic, scaleId, last],
  );

  const clip = project.clips.find((c) => c.id === editClipId && c.type === 'midi');

  /** Read the chords out of the selected clip, or out of everything playing. */
  const detectFromProject = () => {
    const source =
      clip && clip.type === 'midi'
        ? { notes: clip.notes, origin: clip.start, length: clip.length }
        : {
            // Drum parts are pitched material only by accident of the MIDI
            // note numbers a kit uses; feeding them to a harmonic analyser
            // turns a kick and a hat into a chord tone.
            notes: project.clips
              .filter((c) => {
                if (c.type !== 'midi' || c.muted) return false;
                const track = project.tracks.find((t) => t.id === c.trackId);
                return track?.type !== 'drum';
              })
              .flatMap((c) =>
                c.type === 'midi' ? c.notes.map((n) => ({ ...n, start: n.start + c.start })) : [],
              ),
            origin: 0,
            length: projectEndBeat(project),
          };
    if (source.notes.length === 0) {
      useUiStore.getState().toast('error', 'No MIDI notes to read chords from.');
      return;
    }
    const found = detectChords(source.notes, {
      lengthBeats: source.length,
      originBeat: source.origin,
      resolution: 2,
    });
    if (found.length === 0) {
      useUiStore.getState().toast('error', 'Nothing that reads as a chord.');
      return;
    }
    useProjectStore.getState().update((d) => {
      d.chords = found.map((c, i) => ({
        id: `det-${i}`,
        beat: c.beat,
        root: c.root,
        quality: c.quality,
      }));
    });
    useWorkspaceStore.getState().setSizes({ showChords: true });
    useUiStore.getState().toast('info', `Found ${found.length} chords.`);
  };

  const place = (root: number, quality: string) => {
    const beat = last ? last.beat + 4 : Math.max(0, Math.round(playhead));
    useProjectStore.getState().setChord(beat, root, quality);
    useWorkspaceStore.getState().setSizes({ showChords: true });
  };

  const audition = (root: number, quality: string) => {
    if (!selectedTrackId) return;
    const pitches = buildChord(48 + root, quality);
    for (const p of pitches) engine.liveNoteOn(selectedTrackId, p, 90);
    window.setTimeout(() => {
      for (const p of pitches) engine.liveNoteOff(selectedTrackId, p);
    }, 700);
  };

  const applyFollow = () => {
    if (!clip || clip.type !== 'midi') {
      useUiStore.getState().toast('error', 'Open a MIDI clip in the editor first.');
      return;
    }
    if (chords.length === 0) {
      useUiStore.getState().toast('error', 'The chord track is empty.');
      return;
    }
    const next = followChords(clip.notes, chords, follow, {
      originBeat: clip.start,
      tonic,
      scaleId,
    });
    useProjectStore.getState().transformNotes(clip.id, next);
    useUiStore.getState().toast('info', `${clip.name} now follows the chord track.`);
  };

  return (
    <div className="chord-assistant" data-testid="chord-assistant">
      <div className="ca-key">
        <label>
          <span className="k">Key</span>
          <select value={tonic} onChange={(e) => setTonic(Number(e.target.value))} aria-label="Key">
            {KEY_NAMES.map((n, i) => (
              <option key={n} value={i}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="k">Scale</span>
          <select value={scaleId} onChange={(e) => setScaleId(e.target.value)} aria-label="Scale">
            {SCALES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={detectFromProject} data-testid="detect-chords">
          <Icon name="wand" size={13} /> Detect
        </button>
      </div>

      <div className="ca-now">
        <span className="t-label">At the playhead</span>
        <span className="ca-chord">
          {current ? chordLabelOf(current.root, current.quality) : '—'}
        </span>
        {last && (
          <span className="hint">
            Last written: {chordLabelOf(last.root, last.quality)} at beat {last.beat.toFixed(0)}
          </span>
        )}
      </div>

      <div className="ca-section">
        <span className="t-label">What could come next</span>
        <div className="ca-suggestions">
          {suggestions.slice(0, 8).map((s) => (
            <button
              key={`${s.root}-${s.quality}-${s.numeral}`}
              className="ca-sugg"
              style={{ ['--strength' as string]: String(s.strength) }}
              onClick={() => place(s.root, s.quality)}
              onPointerEnter={() => audition(s.root, s.quality)}
              title={s.reason}
              data-testid={`suggest-${s.label}`}
            >
              <span className="ca-label">{s.label}</span>
              <span className="ca-numeral">{s.numeral}</span>
              <span className="ca-reason">{s.reason}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ca-section">
        <span className="t-label">Known progressions</span>
        <div className="ca-progressions">
          {PROGRESSIONS.map((p) => (
            <button
              key={p.id}
              className="ca-prog"
              title={p.blurb}
              onClick={() => {
                const start = Math.max(0, Math.round(engine.getPositionBeats()));
                for (const e of progressionToChords(p, tonic, start)) {
                  useProjectStore.getState().setChord(e.beat, e.root, e.quality);
                }
                useWorkspaceStore.getState().setSizes({ showChords: true });
              }}
              data-testid={`progression-${p.id}`}
            >
              <span className="ca-prog-name">{p.name}</span>
              <span className="ca-prog-blurb">{p.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="ca-section">
        <span className="t-label">Make a clip follow the chords</span>
        <div className="ca-follow">
          <select
            value={follow}
            onChange={(e) => setFollow(e.target.value as FollowMode)}
            aria-label="Follow mode"
            title={FOLLOW_MODES.find((m) => m.id === follow)?.blurb}
          >
            {FOLLOW_MODES.map((m) => (
              <option key={m.id} value={m.id} title={m.blurb}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            className="btn"
            onClick={applyFollow}
            disabled={!clip}
            data-testid="follow-chords"
          >
            Apply to {clip ? clip.name : 'the open clip'}
          </button>
        </div>
        <p className="hint">Rhythm is never changed — only which notes are played.</p>
      </div>
    </div>
  );
}
