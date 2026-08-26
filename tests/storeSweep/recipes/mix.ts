/** Sends, cue mixes, folders and VCAs, macros, control links, grooves. */
import { useProjectStore } from '../../../src/state/projectStore';
import { trackNow, withEffect, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const p = () => useProjectStore.getState().project;
const macrosOf = (trackId: string) => trackNow(trackId).macros ?? [];

export const mixRecipes = (h: Handles): Recipe[] => {
  let cueId = '';
  let macroId = '';
  let paramId = '';
  let linkId = '';
  let folderId = '';

  const aCue = () => {
    cueId = s().addCueMix('Drummer') ?? '';
  };
  const aMacro = () => {
    macroId = s().addMacro(h.inst.id) ?? '';
  };
  const aMacroTarget = () => {
    aMacro();
    paramId = `fx:${withEffect(h.inst.id)}:midDb`;
    s().assignMacroTarget(h.inst.id, macroId, paramId);
  };
  const aLink = () => {
    linkId =
      s().addControlLink({ kind: 'cc', cc: 74, channel: 1 }, { kind: 'master', param: 'volume' }) ??
      '';
  };
  const aFolder = () => {
    folderId = s().groupTracks([h.inst.id, h.inst2.id], 'Sweep group') ?? '';
  };

  return [
    // ---------------------------------------------------------------- sends
    {
      id: 'store:projectStore.setSend',
      undo: 'step',
      // A step, and correctly so: the knob drag is wrapped in a gesture by the
      // caller, which suppresses the push, and the click that first enables a
      // send is a decision that has to be undoable on its own.
      run: () => {
        s().setSend(h.inst.id, h.bus.id, { amount: 0.4, enabled: true, preFader: false });
        return `sends ${trackNow(h.inst.id).sends?.length}`;
      },
    },
    {
      id: 'store:projectStore.removeSend',
      undo: 'step',
      arrange: () => s().setSend(h.inst.id, h.bus.id, { amount: 0.4, enabled: true }),
      run: () => {
        s().removeSend(h.inst.id, h.bus.id);
        return `${trackNow(h.inst.id).sends?.length ?? 0} sends left`;
      },
    },

    // ------------------------------------------------------------ cue mixes
    {
      id: 'store:projectStore.addCueMix',
      undo: 'step',
      run: () => `cue ${s().addCueMix('Drummer')}`,
    },
    {
      id: 'store:projectStore.renameCueMix',
      undo: 'step',
      arrange: aCue,
      run: () => {
        s().renameCueMix(cueId, 'Singer');
        return `name ${p().cueMixes?.find((c) => c.id === cueId)?.name}`;
      },
    },
    {
      id: 'store:projectStore.setCueMix',
      undo: 'step',
      arrange: aCue,
      run: () => {
        s().setCueMix(cueId, { level: 0.6, ignoreSolo: true });
        return `level ${p().cueMixes?.find((c) => c.id === cueId)?.level}`;
      },
    },
    {
      id: 'store:projectStore.setCueSend',
      undo: 'none',
      arrange: aCue,
      run: () => {
        s().setCueSend(cueId, h.inst.id, { level: 0.3, follow: false });
        return `follow ${p().cueMixes?.find((c) => c.id === cueId)?.sends[h.inst.id]?.follow}`;
      },
    },
    {
      id: 'store:projectStore.matchCueToMain',
      undo: 'step',
      arrange: () => {
        aCue();
        s().setCueSend(cueId, h.inst.id, { level: 0.3, follow: false });
      },
      run: () => {
        s().matchCueToMain(cueId);
        return `follow ${p().cueMixes?.find((c) => c.id === cueId)?.sends[h.inst.id]?.follow}`;
      },
    },
    {
      id: 'store:projectStore.removeCueMix',
      undo: 'step',
      arrange: aCue,
      run: () => {
        s().removeCueMix(cueId);
        return `${p().cueMixes?.length ?? 0} cues left`;
      },
    },

    // ---------------------------------------------------- folders and VCAs
    {
      id: 'store:projectStore.groupTracks',
      undo: 'step',
      run: () => `folder ${s().groupTracks([h.inst.id, h.inst2.id], 'Sweep group')}`,
    },
    {
      id: 'store:projectStore.setFolderFor',
      undo: 'step',
      arrange: aFolder,
      run: () => {
        s().setFolderFor(h.audio.id, folderId);
        return `folder of audio ${trackNow(h.audio.id).folderId}`;
      },
    },
    {
      id: 'store:projectStore.ungroupFolder',
      undo: 'step',
      arrange: aFolder,
      run: () => {
        s().ungroupFolder(folderId);
        return `${p().tracks.filter((t) => t.type === 'folder').length} folders left`;
      },
    },
    {
      id: 'store:projectStore.addVca',
      undo: 'step',
      run: () => `vca ${s().addVca('Drums VCA')}`,
    },
    {
      id: 'store:projectStore.assignVca',
      undo: 'step',
      arrange: () => {
        folderId = s().addVca('Drums VCA');
      },
      run: () => {
        s().assignVca(h.inst.id, folderId);
        return `vca of inst ${trackNow(h.inst.id).vcaId}`;
      },
    },

    // --------------------------------------------------------------- macros
    {
      id: 'store:projectStore.addMacro',
      undo: 'step',
      run: () => `macro ${s().addMacro(h.inst.id)}`,
    },
    {
      id: 'store:projectStore.renameMacro',
      undo: 'step',
      arrange: aMacro,
      run: () => {
        s().renameMacro(h.inst.id, macroId, 'Brightness');
        return `name ${macrosOf(h.inst.id).find((m) => m.id === macroId)?.name}`;
      },
    },
    {
      id: 'store:projectStore.setMacroValue',
      undo: 'none',
      // The macro knob itself.
      arrange: aMacroTarget,
      run: () => {
        s().setMacroValue(h.inst.id, macroId, 0.7);
        return `value ${macrosOf(h.inst.id).find((m) => m.id === macroId)?.value}`;
      },
    },
    {
      id: 'store:projectStore.assignMacroTarget',
      undo: 'step',
      arrange: () => {
        aMacro();
        paramId = `fx:${withEffect(h.inst.id)}:midDb`;
      },
      run: () => {
        s().assignMacroTarget(h.inst.id, macroId, paramId);
        return `targets ${macrosOf(h.inst.id).find((m) => m.id === macroId)?.targets.length}`;
      },
    },
    {
      id: 'store:projectStore.setMacroTargetRange',
      undo: 'none',
      // The two ends of the range are dragged.
      arrange: aMacroTarget,
      run: () => {
        s().setMacroTargetRange(h.inst.id, macroId, paramId, 0.2, 0.9);
        const t = macrosOf(h.inst.id).find((m) => m.id === macroId)?.targets[0];
        return `range ${t?.from}..${t?.to}`;
      },
    },
    {
      id: 'store:projectStore.removeMacroTarget',
      undo: 'step',
      arrange: aMacroTarget,
      run: () => {
        s().removeMacroTarget(h.inst.id, macroId, paramId);
        return `${macrosOf(h.inst.id).find((m) => m.id === macroId)?.targets.length} targets left`;
      },
    },
    {
      id: 'store:projectStore.removeMacro',
      undo: 'step',
      arrange: aMacro,
      run: () => {
        s().removeMacro(h.inst.id, macroId);
        return `${macrosOf(h.inst.id).length} macros left`;
      },
    },

    // -------------------------------------------------------- control links
    {
      id: 'store:projectStore.addControlLink',
      undo: 'step',
      run: () =>
        `link ${s().addControlLink({ kind: 'cc', cc: 74, channel: 1 }, { kind: 'master', param: 'volume' })}`,
    },
    {
      id: 'store:projectStore.updateControlLink',
      undo: 'step',
      arrange: aLink,
      run: () => {
        s().updateControlLink(linkId, { mode: 'toggle' });
        return `mode ${p().controlLinks?.find((l) => l.id === linkId)?.mode}`;
      },
    },
    {
      id: 'store:projectStore.removeControlLink',
      undo: 'step',
      arrange: aLink,
      run: () => {
        s().removeControlLink(linkId);
        return `${p().controlLinks?.length ?? 0} links left`;
      },
    },
    {
      id: 'store:projectStore.clearControlLinks',
      undo: 'step',
      arrange: () => {
        aLink();
        s().addControlLink(
          { kind: 'cc', cc: 7, channel: 1 },
          { kind: 'transport', command: 'play' },
        );
      },
      run: () => {
        s().clearControlLinks();
        return `${p().controlLinks?.length ?? 0} links left`;
      },
    },

    // -------------------------------------------------------------- grooves
    {
      id: 'store:projectStore.saveGroove',
      undo: 'step',
      run: () => {
        s().saveGroove({
          name: 'Sweep swing',
          resolution: 2,
          offsets: [0, 0.08],
          velocities: [1, 0.9],
        });
        return `${p().grooves?.length} grooves`;
      },
    },
    {
      id: 'store:projectStore.removeGroove',
      undo: 'step',
      arrange: () =>
        s().saveGroove({
          name: 'Doomed groove',
          resolution: 2,
          offsets: [0, 0.05],
          velocities: [1, 1],
        }),
      run: () => {
        s().removeGroove('Doomed groove');
        return `${p().grooves?.length ?? 0} grooves left`;
      },
    },
  ];
};
