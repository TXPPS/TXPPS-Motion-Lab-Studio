/** Clip lifecycle, trimming, fades and comping. */
import { useProjectStore } from '../../../src/state/projectStore';
import type { AudioClip } from '../../../src/model/types';
import { clipNow, fakeMedia, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const audioClip = (id: string) => clipNow(id) as AudioClip;
const clipCount = () => useProjectStore.getState().project.clips.length;

export const clipRecipes = (h: Handles): Recipe[] => {
  // Handles that an `arrange` builds and the matching `run` then uses. Declared
  // per call because `projectRecipes` is rebuilt for every row against a fresh
  // project, so nothing here can leak between cases.
  let left = '';
  let right = '';
  let comp = '';

  /** An audio clip carrying two takes, which every comping row needs. */
  const comped = () => {
    const a = s().addAudioClip(h.audio.id, h.media.id, 60, 4, 'Take A', 2);
    const b = s().addAudioClip(h.audio.id, h.media.id, 60, 4, 'Take B', 2);
    const packed = s().packTakes([a, b]);
    if (!packed) throw new Error('packTakes refused two overlapping clips');
    comp = packed;
  };

  return [
    {
      id: 'store:projectStore.addAudioClip',
      undo: 'step',
      run: () => `clip ${s().addAudioClip(h.audio.id, h.media.id, 16, 4, 'Sweep', 2)}`,
    },
    {
      id: 'store:projectStore.addRecordedClip',
      undo: 'step',
      run: () => {
        const ref = fakeMedia('media-rec', 'Take 1');
        return `clip ${s().addRecordedClip({
          trackId: h.audio.id,
          mediaId: ref.id,
          start: 24,
          lengthBeats: 8,
          name: 'Take 1',
          sourceDuration: 4,
          mediaRef: ref,
        })}`;
      },
    },
    {
      id: 'store:projectStore.registerMedia',
      undo: 'step',
      run: () => {
        s().registerMedia(fakeMedia('media-reg', 'Registered'));
        return `${(useProjectStore.getState().project.media ?? []).length} media`;
      },
    },
    {
      id: 'store:projectStore.insertClips',
      undo: 'step',
      run: () => `pasted ${s().insertClips([{ ...clipNow(h.midi.id), start: 32 }]).length}`,
    },
    {
      id: 'store:projectStore.duplicateClips',
      undo: 'step',
      run: () => `copies ${s().duplicateClips([h.midi.id]).length}`,
    },
    {
      id: 'store:projectStore.trimClipStart',
      undo: 'none',
      // A drag on the clip's left edge. The gesture the drag opens is what
      // collapses the hundred writes it makes into one Ctrl+Z.
      run: () => {
        const was = clipNow(h.wav.id).start;
        s().trimClipStart(h.wav.id, was + 1);
        return `start ${was} -> ${clipNow(h.wav.id).start}`;
      },
    },
    {
      id: 'store:projectStore.trimClipEnd',
      undo: 'none',
      run: () => {
        const was = clipNow(h.wav.id).length;
        s().trimClipEnd(h.wav.id, was - 1);
        return `length ${was} -> ${clipNow(h.wav.id).length}`;
      },
    },
    {
      id: 'store:projectStore.setClipGain',
      undo: 'none',
      run: () => {
        s().setClipGain(h.wav.id, 0.33);
        return `gain ${audioClip(h.wav.id).gain}`;
      },
    },
    {
      id: 'store:projectStore.setClipFades',
      undo: 'none',
      // Dragging a fade handle. `setFadeShape` beside it *is* a step: picking
      // a curve is one decision, dragging its length is not.
      run: () => {
        s().setClipFades(h.wav.id, 0.25, 0.5);
        const c = audioClip(h.wav.id);
        return `fades ${c.fadeIn}/${c.fadeOut}`;
      },
    },
    {
      id: 'store:projectStore.setFadeShape',
      undo: 'step',
      arrange: () => s().setClipFades(h.wav.id, 0.25, 0.25),
      run: () => {
        s().setFadeShape(h.wav.id, 'in', 'equalPower');
        return `in shape ${audioClip(h.wav.id).fadeInShape}`;
      },
    },
    {
      id: 'store:projectStore.setClipView',
      undo: 'none',
      // A view flag: which take lanes are open under the clip. It is written
      // into the project so a reopened song looks the way it was left, but it
      // is not an edit, which is why it must not push an undo step.
      arrange: () => {
        comped();
        s().setClipView(comp, { takesOpen: false });
      },
      run: () => {
        s().setClipView(comp, { takesOpen: true });
        return `takesOpen ${audioClip(comp).takesOpen}`;
      },
    },
    {
      id: 'store:projectStore.slipClip',
      undo: 'none',
      // A drag: the surrounding gesture owns the undo step.
      run: () => {
        const was = audioClip(h.wav.id).offset;
        s().slipClip(h.wav.id, 0.1, 2);
        return `offset ${was} -> ${audioClip(h.wav.id).offset}`;
      },
    },
    {
      id: 'store:projectStore.healClips',
      undo: 'step',
      // Two halves of one split clip. Heal refuses anything else — same media,
      // abutting, and the right clip's offset exactly where the left one ends —
      // because joining two different takes would invent material.
      arrange: () => {
        left = s().addAudioClip(h.audio.id, h.media.id, 40, 4, 'Sweep', 2);
        right = s().splitClip(left, 42) ?? '';
      },
      run: () => `healed ${s().healClips([left, right])}`,
    },
    {
      id: 'store:projectStore.rippleDeleteClips',
      undo: 'step',
      run: () => {
        const was = clipCount();
        s().rippleDeleteClips([h.midi.id]);
        return `${was} -> ${clipCount()} clips`;
      },
    },
    {
      id: 'store:projectStore.createCrossfade',
      undo: 'step',
      // Overlapping already: the fixture's media is exactly as long as the
      // clip, so there is no trim headroom for the store to grow an overlap
      // out of and it would (correctly) refuse.
      arrange: () => {
        left = s().addAudioClip(h.audio.id, h.media.id, 48, 4, 'Sweep L', 2);
        right = s().addAudioClip(h.audio.id, h.media.id, 51, 4, 'Sweep R', 2);
      },
      run: () => `crossfade ${s().createCrossfade(left, right, 1, 'equalPower')}`,
    },
    {
      id: 'store:projectStore.packTakes',
      undo: 'step',
      arrange: () => {
        left = s().addAudioClip(h.audio.id, h.media.id, 80, 4, 'A', 2);
        right = s().addAudioClip(h.audio.id, h.media.id, 80, 4, 'B', 2);
      },
      run: () => `packed into ${s().packTakes([left, right])}`,
    },
    {
      id: 'store:projectStore.promoteTake',
      undo: 'step',
      arrange: comped,
      run: () => {
        const take = audioClip(comp).takes![1];
        s().promoteTake(comp, take.id);
        return `promoted ${take.id}`;
      },
    },
    {
      id: 'store:projectStore.setCompRange',
      undo: 'none',
      // Swipe comping: a drag across the take lanes, in beats relative to the
      // clip rather than to the timeline.
      arrange: comped,
      run: () => {
        const c = audioClip(comp);
        s().setCompRange(comp, 0, 2, c.takes![1].id);
        return `comp segments ${audioClip(comp).comp?.length}`;
      },
    },
    {
      id: 'store:projectStore.deleteTake',
      undo: 'step',
      arrange: comped,
      run: () => {
        s().deleteTake(comp, audioClip(comp).takes![1].id);
        return `takes now ${audioClip(comp).takes?.length}`;
      },
    },
    {
      id: 'store:projectStore.moveTake',
      undo: 'step',
      arrange: comped,
      run: () => {
        s().moveTake(comp, audioClip(comp).takes![1].id, -1);
        return `order ${audioClip(comp)
          .takes?.map((t) => t.id)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.setTakeMuted',
      undo: 'step',
      arrange: comped,
      run: () => {
        s().setTakeMuted(comp, audioClip(comp).takes![0].id, true);
        return `muted ${audioClip(comp).takes?.[0].muted}`;
      },
    },
    {
      id: 'store:projectStore.setSoloTake',
      undo: 'none',
      // Auditioning one take is a monitoring decision, not an edit to the comp.
      arrange: comped,
      run: () => {
        s().setSoloTake(comp, audioClip(comp).takes![1].id);
        return `solo ${audioClip(comp).soloTakeId}`;
      },
    },
  ];
};
