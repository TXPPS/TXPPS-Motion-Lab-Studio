/** Tempo, signatures, markers, sections, chords and scratch pads. */
import { useProjectStore } from '../../../src/state/projectStore';
import type { Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const p = () => useProjectStore.getState().project;

export const arrangementRecipes = (h: Handles): Recipe[] => {
  let markerId = '';
  let sectionId = '';
  let chordId = '';
  let padId = '';
  let tempoId = '';
  let sigId = '';

  const aMarker = () => {
    markerId = s().addMarker(8, 'Chorus');
  };
  const aSection = () => {
    sectionId = s().addSection(0, 16, 'Verse');
    s().addSection(16, 16, 'Chorus');
  };
  const aChord = () => {
    chordId = s().setChord(4, 0, 'maj');
  };
  const aPad = () => {
    padId = s().createScratchPad('Alt chorus');
  };
  const aTempoEvent = () => {
    s().setTempoEvent(8, 140);
    tempoId = p().tempoMap?.tempos.find((e) => e.beat === 8)?.id ?? '';
  };
  const aSignature = () => {
    s().setSignature(4, 3, 4);
    sigId = p().tempoMap?.sigs.find((x) => x.bar === 4)?.id ?? '';
  };

  return [
    {
      id: 'store:projectStore.setBpm',
      undo: 'none',
      // The tempo field is dragged as well as typed into.
      run: () => {
        s().setBpm(132);
        return `bpm ${p().bpm}`;
      },
    },
    {
      id: 'store:projectStore.setTimeSig',
      undo: 'step',
      run: () => {
        s().setTimeSig(3, 4);
        return `${p().timeSig.num}/${p().timeSig.den}`;
      },
    },
    {
      id: 'store:projectStore.setTempoEvent',
      undo: 'step',
      run: () => {
        s().setTempoEvent(8, 140, 'ramp');
        return `${p().tempoMap?.tempos.length} tempo events`;
      },
    },
    {
      id: 'store:projectStore.moveTempoEvent',
      undo: 'step',
      arrange: aTempoEvent,
      run: () => {
        s().moveTempoEvent(tempoId, 12);
        return `moved to ${p().tempoMap?.tempos.find((e) => e.id === tempoId)?.beat}`;
      },
    },
    {
      id: 'store:projectStore.removeTempoEvent',
      undo: 'step',
      arrange: aTempoEvent,
      run: () => {
        s().removeTempoEvent(tempoId);
        return `${p().tempoMap?.tempos.length} tempo events left`;
      },
    },
    {
      id: 'store:projectStore.setSignature',
      undo: 'step',
      run: () => {
        s().setSignature(4, 3, 4);
        return `${p().tempoMap?.sigs.length} signatures`;
      },
    },
    {
      id: 'store:projectStore.removeSignature',
      undo: 'step',
      arrange: aSignature,
      run: () => {
        s().removeSignature(sigId);
        return `${p().tempoMap?.sigs.length} signatures left`;
      },
    },
    {
      id: 'store:projectStore.addMarker',
      undo: 'step',
      run: () => `marker ${s().addMarker(8, 'Chorus')}`,
    },
    {
      id: 'store:projectStore.setMarker',
      undo: 'step',
      arrange: aMarker,
      run: () => {
        s().setMarker(markerId, { name: 'Bridge' });
        return `name ${p().markers?.find((m) => m.id === markerId)?.name}`;
      },
    },
    {
      id: 'store:projectStore.removeMarker',
      undo: 'step',
      arrange: aMarker,
      run: () => {
        s().removeMarker(markerId);
        return `${p().markers?.length ?? 0} markers left`;
      },
    },
    {
      id: 'store:projectStore.addSection',
      undo: 'step',
      run: () => `section ${s().addSection(0, 16, 'Verse')}`,
    },
    {
      id: 'store:projectStore.setSection',
      undo: 'step',
      arrange: aSection,
      run: () => {
        s().setSection(sectionId, { name: 'Intro' });
        return `name ${p().sections?.find((x) => x.id === sectionId)?.name}`;
      },
    },
    {
      id: 'store:projectStore.moveSection',
      undo: 'step',
      arrange: aSection,
      run: () => {
        s().moveSection(sectionId, 1);
        return `order ${p()
          .sections?.map((x) => x.name)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.removeSection',
      undo: 'step',
      arrange: aSection,
      run: () => {
        s().removeSection(sectionId);
        return `${p().sections?.length ?? 0} sections left`;
      },
    },
    {
      id: 'store:projectStore.setChord',
      undo: 'step',
      run: () => `chord ${s().setChord(4, 0, 'maj')}`,
    },
    {
      id: 'store:projectStore.removeChord',
      undo: 'step',
      arrange: aChord,
      run: () => {
        s().removeChord(chordId);
        return `${p().chords?.length ?? 0} chords left`;
      },
    },
    {
      id: 'store:projectStore.clearChords',
      undo: 'step',
      arrange: () => {
        s().setChord(0, 0, 'maj');
        s().setChord(4, 7, 'min');
      },
      run: () => {
        s().clearChords();
        return `${p().chords?.length ?? 0} chords left`;
      },
    },
    {
      id: 'store:projectStore.createScratchPad',
      undo: 'step',
      run: () => `pad ${s().createScratchPad('Alt chorus')}`,
    },
    {
      id: 'store:projectStore.renameScratchPad',
      undo: 'step',
      arrange: aPad,
      run: () => {
        s().renameScratchPad(padId, 'Alt bridge');
        return `name ${p().scratchPads?.find((x) => x.id === padId)?.name}`;
      },
    },
    {
      id: 'store:projectStore.swapScratchPad',
      undo: 'step',
      arrange: aPad,
      run: () => {
        s().swapScratchPad(padId);
        return `active ${p().activePadId}`;
      },
    },
    {
      id: 'store:projectStore.deleteScratchPad',
      undo: 'step',
      arrange: aPad,
      run: () => {
        s().deleteScratchPad(padId);
        return `${p().scratchPads?.length ?? 0} pads left`;
      },
    },
    {
      id: 'store:projectStore.setLoop',
      undo: 'none',
      // The loop brackets are dragged along the ruler.
      run: () => {
        s().setLoop({ enabled: true, start: 8, end: 24 });
        return `loop ${p().loop.start}-${p().loop.end} ${p().loop.enabled}`;
      },
    },
    {
      id: 'store:projectStore.setMetronome',
      undo: 'none',
      // Monitoring, not the song. Ctrl+Z after clicking the click would be a
      // surprising thing for it to do.
      run: () => {
        s().setMetronome(!p().metronome);
        return `metronome ${p().metronome}`;
      },
    },
    {
      id: 'store:projectStore.setNotes',
      undo: 'none',
      // Typing is a continuous gesture; one undo step per keystroke would make
      // Ctrl+Z useless for everything else in the session.
      run: () => {
        s().setNotes('Sweep: check the second chorus vocal.');
        return `notes ${p().notes?.length} chars`;
      },
    },
    {
      id: 'store:projectStore.applyGrooveToClip',
      undo: 'step',
      run: () => {
        s().applyGrooveToClip(
          h.midi.id,
          { name: 'Sweep swing', resolution: 2, offsets: [0, 0.08], velocities: [1, 0.9] },
          1,
        );
        return 'groove applied';
      },
    },
  ];
};
