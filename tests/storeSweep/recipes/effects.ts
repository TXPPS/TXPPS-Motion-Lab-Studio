/** Insert racks: the channel's, the master's, the clip's, and the note chain. */
import { useProjectStore } from '../../../src/state/projectStore';
import { clipNow, trackNow, withEffect, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const effectsOf = (trackId: string) => trackNow(trackId).effects ?? [];
const masterFx = () => useProjectStore.getState().project.master?.effects ?? [];
const eventFxOf = (clipId: string) => clipNow(clipId).eventFx ?? [];
const noteFxOf = (trackId: string) => trackNow(trackId).noteFx ?? [];

export const effectRecipes = (h: Handles): Recipe[] => {
  let fxA = '';
  let fxB = '';
  let masterA = '';
  let eventA = '';
  let noteA = '';

  /** Two inserts on the fixture's instrument track, so a move has somewhere to go. */
  const twoInserts = () => {
    fxA = withEffect(h.inst.id);
    fxB = withEffect(h.inst.id);
  };
  const twoMasterInserts = () => {
    masterA = s().addMasterEffect('eq3') ?? '';
    s().addMasterEffect('compressor');
  };
  const twoEventFx = () => {
    eventA = s().addEventFx(h.wav.id, 'eq3') ?? '';
    s().addEventFx(h.wav.id, 'compressor');
  };
  const twoNoteFx = () => {
    noteA = s().addNoteFx(h.inst.id, 'arpeggiator') ?? '';
    s().addNoteFx(h.inst.id, 'chorder');
  };

  return [
    // ------------------------------------------------------- channel inserts
    {
      id: 'store:projectStore.setEffectShape',
      undo: 'none',
      // A curve drag. The gesture around it owns the undo step, the same way
      // a fader drag does.
      arrange: () => {
        fxA = withEffect(h.inst.id);
      },
      run: () => {
        // Four numbers per node or the store writes nothing: a node is
        // (x, y, tension, kind) and a short one is how a NaN would reach the
        // audio thread through the curve message.
        s().setEffectShape(h.inst.id, fxA, 0, [
          [0, 0, 0, 0],
          [0.5, 0.8, 0, 0],
          [1, 1, 0, 0],
        ]);
        return `shape nodes ${JSON.stringify(effectsOf(h.inst.id).find((e) => e.id === fxA)?.shapes?.[0]?.length)}`;
      },
    },
    {
      id: 'store:projectStore.moveEffect',
      undo: 'step',
      arrange: twoInserts,
      run: () => {
        s().moveEffect(h.inst.id, fxB, -1);
        return `order ${effectsOf(h.inst.id)
          .map((e) => e.kind)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.reorderEffect',
      undo: 'step',
      arrange: twoInserts,
      run: () => {
        s().reorderEffect(h.inst.id, fxB, 0);
        return `order ${effectsOf(h.inst.id)
          .map((e) => e.kind)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.copyEffectTo',
      undo: 'step',
      arrange: () => {
        fxA = withEffect(h.inst.id);
      },
      run: () => `copied as ${s().copyEffectTo(h.inst.id, fxA, h.inst2.id)}`,
    },

    // -------------------------------------------------------- master channel
    {
      id: 'store:projectStore.setMaster',
      undo: 'none',
      // The master fader, pan and the monitoring toggles beside them. The
      // fader is dragged, and the three share one setter.
      run: () => {
        s().setMaster({ pan: -0.2, limiter: false });
        return `pan ${useProjectStore.getState().project.master?.pan}`;
      },
    },
    {
      id: 'store:projectStore.setMasterVolume',
      undo: 'none',
      // A fader. Continuous, so the gesture owns the step.
      run: () => {
        s().setMasterVolume(0.62);
        return `master volume ${useProjectStore.getState().project.masterVolume}`;
      },
    },
    {
      id: 'store:projectStore.addMasterEffect',
      undo: 'step',
      run: () => `master insert ${s().addMasterEffect('eq3')}`,
    },
    {
      id: 'store:projectStore.removeMasterEffect',
      undo: 'step',
      arrange: twoMasterInserts,
      run: () => {
        s().removeMasterEffect(masterA);
        return `${masterFx().length} master inserts`;
      },
    },
    {
      id: 'store:projectStore.setMasterEffectParam',
      undo: 'none',
      // A knob.
      arrange: twoMasterInserts,
      run: () => {
        s().setMasterEffectParam(masterA, 'midDb', 3);
        return `gain ${masterFx().find((e) => e.id === masterA)?.params.midDb}`;
      },
    },
    {
      id: 'store:projectStore.setMasterEffectBypass',
      undo: 'step',
      arrange: twoMasterInserts,
      run: () => {
        s().setMasterEffectBypass(masterA, true);
        return `bypass ${masterFx().find((e) => e.id === masterA)?.bypass}`;
      },
    },
    {
      id: 'store:projectStore.moveMasterEffect',
      undo: 'step',
      arrange: twoMasterInserts,
      run: () => {
        s().moveMasterEffect(masterA, 1);
        return `order ${masterFx()
          .map((e) => e.kind)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.reorderMasterEffect',
      undo: 'step',
      arrange: twoMasterInserts,
      run: () => {
        s().reorderMasterEffect(masterA, 1);
        return `order ${masterFx()
          .map((e) => e.kind)
          .join(',')}`;
      },
    },

    // --------------------------------------------------- per-clip event effects
    {
      id: 'store:projectStore.addEventFx',
      undo: 'step',
      run: () => `clip insert ${s().addEventFx(h.wav.id, 'eq3')}`,
    },
    {
      id: 'store:projectStore.removeEventFx',
      undo: 'step',
      arrange: twoEventFx,
      run: () => {
        s().removeEventFx(h.wav.id, eventA);
        return `${eventFxOf(h.wav.id).length} clip inserts`;
      },
    },
    {
      id: 'store:projectStore.setEventFxParam',
      undo: 'none',
      arrange: twoEventFx,
      run: () => {
        s().setEventFxParam(h.wav.id, eventA, 'midDb', -2);
        return `gain ${eventFxOf(h.wav.id).find((e) => e.id === eventA)?.params.midDb}`;
      },
    },
    {
      id: 'store:projectStore.setEventFxBypass',
      undo: 'step',
      arrange: twoEventFx,
      run: () => {
        s().setEventFxBypass(h.wav.id, eventA, true);
        return `bypass ${eventFxOf(h.wav.id).find((e) => e.id === eventA)?.bypass}`;
      },
    },
    {
      id: 'store:projectStore.moveEventFx',
      undo: 'step',
      arrange: twoEventFx,
      run: () => {
        s().moveEventFx(h.wav.id, eventA, 1);
        return `order ${eventFxOf(h.wav.id)
          .map((e) => e.kind)
          .join(',')}`;
      },
    },

    // ------------------------------------------------------------- note effects
    {
      id: 'store:projectStore.addNoteFx',
      undo: 'step',
      run: () => `note fx ${s().addNoteFx(h.inst.id, 'arpeggiator')}`,
    },
    {
      id: 'store:projectStore.removeNoteFx',
      undo: 'step',
      arrange: twoNoteFx,
      run: () => {
        s().removeNoteFx(h.inst.id, noteA);
        return `${noteFxOf(h.inst.id).length} note fx`;
      },
    },
    {
      id: 'store:projectStore.setNoteFxParam',
      undo: 'none',
      arrange: twoNoteFx,
      run: () => {
        s().setNoteFxParam(h.inst.id, noteA, 'rate', 4);
        return `rate ${noteFxOf(h.inst.id).find((f) => f.id === noteA)?.params.rate}`;
      },
    },
    {
      id: 'store:projectStore.setNoteFxBypass',
      undo: 'step',
      arrange: twoNoteFx,
      run: () => {
        s().setNoteFxBypass(h.inst.id, noteA, true);
        return `bypass ${noteFxOf(h.inst.id).find((f) => f.id === noteA)?.bypass}`;
      },
    },
    {
      id: 'store:projectStore.moveNoteFx',
      undo: 'step',
      arrange: twoNoteFx,
      run: () => {
        s().moveNoteFx(h.inst.id, noteA, 1);
        return `order ${noteFxOf(h.inst.id)
          .map((f) => f.kind)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.setNoteFxList',
      undo: 'step',
      arrange: twoNoteFx,
      run: () => {
        s().setNoteFxList(h.inst.id, noteA, [0, 4, 7]);
        return `list ${noteFxOf(h.inst.id)
          .find((f) => f.id === noteA)
          ?.list?.join(',')}`;
      },
    },
  ];
};
