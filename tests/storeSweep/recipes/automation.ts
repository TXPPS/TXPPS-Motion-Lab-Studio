/** Automation lanes, points and the write modes. */
import { useProjectStore } from '../../../src/state/projectStore';
import { trackNow, withEffect, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const lanes = (trackId: string) => trackNow(trackId).automation ?? [];
const lane = (trackId: string, laneId: string) => lanes(trackId).find((l) => l.id === laneId);

export const automationRecipes = (h: Handles): Recipe[] => {
  let laneId = '';
  let paramId = '';
  let pointIds: string[] = [];

  /** A lane on a parameter that certainly exists: an insert this test added. */
  const oneLane = () => {
    const fx = withEffect(h.inst.id);
    paramId = `fx:${fx}:midDb`;
    laneId = s().addAutomationLane(h.inst.id, paramId) ?? '';
    if (!laneId) throw new Error(`addAutomationLane refused ${paramId}`);
  };
  const withPoints = () => {
    oneLane();
    pointIds = s().insertAutomationPoints(h.inst.id, laneId, [
      { beat: 0, value: 0.2 },
      { beat: 4, value: 0.8 },
      { beat: 8, value: 0.4 },
    ]);
  };

  return [
    {
      id: 'store:projectStore.removeAutomationLane',
      undo: 'step',
      arrange: oneLane,
      run: () => {
        s().removeAutomationLane(h.inst.id, laneId);
        return `${lanes(h.inst.id).length} lanes left`;
      },
    },
    {
      id: 'store:projectStore.setAutomationLane',
      undo: 'step',
      // `enabled` is undoable; `height` is a continuous UI adjustment and is
      // not. This recipe drives the undoable half, which is the contract the
      // store's own comment states.
      arrange: oneLane,
      run: () => {
        s().setAutomationLane(h.inst.id, laneId, { enabled: false });
        return `enabled ${lane(h.inst.id, laneId)?.enabled}`;
      },
    },
    {
      id: 'store:projectStore.setAutomationMode',
      undo: 'none',
      // Read/latch/touch is how the channel behaves while the transport runs,
      // not a change to the song — the same class as arming a track.
      run: () => {
        s().setAutomationMode(h.inst.id, 'latch');
        return `mode ${trackNow(h.inst.id).automationMode}`;
      },
    },
    {
      id: 'store:projectStore.insertAutomationPoints',
      undo: 'step',
      arrange: oneLane,
      run: () =>
        `inserted ${
          s().insertAutomationPoints(h.inst.id, laneId, [
            { beat: 1, value: 0.3 },
            { beat: 2, value: 0.6 },
          ]).length
        }`,
    },
    {
      id: 'store:projectStore.updateAutomationPoints',
      undo: 'none',
      // A drag on the automation lane.
      arrange: withPoints,
      run: () => {
        s().updateAutomationPoints(h.inst.id, laneId, pointIds, (p) => ({ value: p.value / 2 }));
        return `first value ${lane(h.inst.id, laneId)?.points[0].value}`;
      },
    },
    {
      id: 'store:projectStore.deleteAutomationPoints',
      undo: 'step',
      arrange: withPoints,
      run: () => {
        s().deleteAutomationPoints(h.inst.id, laneId, [pointIds[0]]);
        return `${lane(h.inst.id, laneId)?.points.length} points left`;
      },
    },
    {
      id: 'store:projectStore.setAutomationCurve',
      undo: 'step',
      arrange: withPoints,
      run: () => {
        s().setAutomationCurve(h.inst.id, laneId, pointIds, 'exp');
        return `curve ${lane(h.inst.id, laneId)?.points[0].curve}`;
      },
    },
    {
      id: 'store:projectStore.writeAutomationAt',
      undo: 'none',
      // Touch/latch recording while the transport runs; the pass is one step
      // and the transport's stop is what closes it.
      arrange: withPoints,
      run: () => {
        s().writeAutomationAt(h.inst.id, laneId, 6, 0.9, 5);
        return `${lane(h.inst.id, laneId)?.points.length} points after the pass`;
      },
    },
    {
      id: 'store:projectStore.trimAutomationAt',
      undo: 'none',
      arrange: withPoints,
      run: () => {
        s().trimAutomationAt(h.inst.id, laneId, 6, 0.1, 5);
        return `${lane(h.inst.id, laneId)?.points.length} points after the trim`;
      },
    },
    {
      id: 'store:projectStore.setParamNorm',
      undo: 'none',
      // The generic parameter write a control link or a macro goes through.
      arrange: oneLane,
      run: () => {
        s().setParamNorm(h.inst.id, paramId, 0.77);
        return `${paramId} -> 0.77`;
      },
    },
  ];
};
