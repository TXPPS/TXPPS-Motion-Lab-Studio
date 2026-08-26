/** Sampler zones, pads, the instrument rack, and the synth preset. */
import { useProjectStore } from '../../../src/state/projectStore';
import { makeZone } from '../../../src/model/sampler';
import { trackNow, type Handles } from '../fixture';
import type { Recipe } from '../harness';

const s = () => useProjectStore.getState();
const sampler = (trackId: string) => trackNow(trackId).sampler;
const zones = (trackId: string) => sampler(trackId)?.zones ?? [];
const rack = (trackId: string) => trackNow(trackId).rack?.items ?? [];

export const samplerRecipes = (h: Handles): Recipe[] => {
  let zoneId = '';
  let itemId = '';

  /** A multi sampler with one zone pointing at the fixture's media. */
  const oneZone = () => {
    s().setInstrument(h.inst.id, 'multi');
    zoneId = s().addSamplerZones(h.inst.id, [makeZone({ mediaId: h.media.id })])[0];
  };
  const twoRackItems = () => {
    itemId = s().rackAddItem(h.inst.id, 'sampler') ?? '';
    s().rackAddItem(h.inst.id, 'synth');
  };

  return [
    {
      id: 'store:projectStore.setSamplerParams',
      undo: 'none',
      // A slider on the sampler's master page. Continuous.
      arrange: () => s().setInstrument(h.inst.id, 'multi'),
      run: () => {
        s().setSamplerParams(h.inst.id, { attack: 0.12, volume: 0.8 });
        return `attack ${sampler(h.inst.id)?.attack}`;
      },
    },
    {
      id: 'store:projectStore.addSamplerZones',
      undo: 'step',
      arrange: () => s().setInstrument(h.inst.id, 'multi'),
      run: () =>
        `zones ${s().addSamplerZones(h.inst.id, [makeZone({ mediaId: h.media.id })]).length}`,
    },
    {
      id: 'store:projectStore.updateSamplerZones',
      undo: 'none',
      // A trim drag on the zone's waveform.
      arrange: oneZone,
      run: () => {
        s().updateSamplerZones(h.inst.id, [zoneId], () => ({ gain: 0.42 }));
        return `gain ${zones(h.inst.id)[0]?.gain}`;
      },
    },
    {
      id: 'store:projectStore.removeSamplerZones',
      undo: 'step',
      arrange: oneZone,
      run: () => {
        s().removeSamplerZones(h.inst.id, [zoneId]);
        return `${zones(h.inst.id).length} zones left`;
      },
    },
    {
      id: 'store:projectStore.setZoneSample',
      undo: 'step',
      // Loading a sample is one decision, not a drag — the sampler's only
      // undoable zone edit, which is why it is declared a step here.
      arrange: oneZone,
      run: () => {
        s().setZoneSample(h.inst.id, zoneId, h.media.id, 'Renamed sample');
        return `zone name ${zones(h.inst.id)[0]?.name}`;
      },
    },
    {
      id: 'store:projectStore.assignPad',
      undo: 'step',
      arrange: () => s().setInstrument(h.inst.id, 'drum'),
      run: () => {
        s().assignPad(h.inst.id, 3, h.media.id, 'Pad 4');
        return `${zones(h.inst.id).length} pads filled`;
      },
    },
    {
      id: 'store:projectStore.setZoneSlices',
      undo: 'step',
      arrange: oneZone,
      run: () => {
        s().setZoneSlices(h.inst.id, zoneId, [0, 0.5, 1, 1.5]);
        return `slices ${zones(h.inst.id)[0]?.slices?.length}`;
      },
    },
    {
      id: 'store:projectStore.sliceToPads',
      undo: 'step',
      arrange: () => {
        oneZone();
        s().setZoneSlices(h.inst.id, zoneId, [0, 0.5, 1, 1.5]);
      },
      run: () => `pads made ${s().sliceToPads(h.inst.id, zoneId)}`,
    },
    {
      id: 'store:projectStore.sliceToMidiClip',
      undo: 'step',
      arrange: () => {
        oneZone();
        s().setZoneSlices(h.inst.id, zoneId, [0, 0.5, 1, 1.5]);
      },
      run: () => `clip ${s().sliceToMidiClip(h.inst.id, zoneId, 0)}`,
    },
    {
      id: 'store:projectStore.applySamplerPreset',
      undo: 'step',
      arrange: oneZone,
      run: () => {
        const current = sampler(h.inst.id)!;
        s().applySamplerPreset(h.inst.id, { ...current, attack: 0.5, presetName: 'Sweep' });
        return `preset ${sampler(h.inst.id)?.presetName}`;
      },
    },
    {
      id: 'store:projectStore.applyPreset',
      undo: 'step',
      // Moved off the preset first: the fixture's instrument track may already
      // be on the one being applied, and "applying the preset it is already on"
      // is a no-op that would read as a broken action.
      arrange: () => {
        s().setInstrument(h.inst.id, 'synth');
        s().setSynthParams(h.inst.id, { cutoff: 0.01 });
      },
      run: () => {
        s().applyPreset(h.inst.id, 'Deep Saw Bass');
        return `synth preset ${trackNow(h.inst.id).synth?.presetName}`;
      },
    },

    // ------------------------------------------------------ instrument rack
    {
      id: 'store:projectStore.rackAddItem',
      undo: 'step',
      run: () => `rack item ${s().rackAddItem(h.inst.id, 'sampler')}`,
    },
    {
      id: 'store:projectStore.rackUpdateItem',
      undo: 'step',
      arrange: twoRackItems,
      run: () => {
        s().rackUpdateItem(h.inst.id, itemId, { name: 'Renamed layer' });
        return `name ${rack(h.inst.id).find((i) => i.id === itemId)?.name}`;
      },
    },
    {
      id: 'store:projectStore.rackSetLayerZones',
      undo: 'step',
      // The action that closed the silent-layer defect: before it existed,
      // `rackAddItem(_, 'sampler')` made a layer nothing could ever fill.
      arrange: twoRackItems,
      run: () => {
        s().rackSetLayerZones(h.inst.id, itemId, [makeZone({ mediaId: h.media.id })]);
        return `layer zones ${rack(h.inst.id).find((i) => i.id === itemId)?.sampler?.zones.length}`;
      },
    },
    {
      id: 'store:projectStore.rackMoveItem',
      undo: 'step',
      arrange: twoRackItems,
      run: () => {
        s().rackMoveItem(h.inst.id, itemId, 1);
        return `order ${rack(h.inst.id)
          .map((i) => i.kind)
          .join(',')}`;
      },
    },
    {
      id: 'store:projectStore.rackRemoveItem',
      undo: 'step',
      arrange: twoRackItems,
      run: () => {
        s().rackRemoveItem(h.inst.id, itemId);
        return `${rack(h.inst.id).length} rack items left`;
      },
    },
  ];
};
