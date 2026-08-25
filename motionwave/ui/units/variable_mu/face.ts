/**
 * Variable-Mu Limiter — the face.
 *
 * **Two channel strips, not one, and that is the panel's whole argument.**
 * §3.5 and §3.7: every channel control exists twice on the hardware, and a user
 * setting a different threshold and a different time constant for the lateral
 * and the vertical path is the reason the unit is still on mix buses. A face
 * that ganged them would look tidier and would remove the feature.
 *
 * **The threshold runs the wrong way.** Ten fully clockwise is *no*
 * compression. §3.2 calls this out as exactly the detail an emulation silently
 * corrects and then hears about from users who know the hardware, and the same
 * applies here: the face is what a user learns the unit from, so it labels the
 * control the way the panel does.
 *
 * **There is no ratio control, and there is no ratio readout either.** §5:
 * the ratio is a consequence of how deep the reduction is and of where the two
 * threshold controls sit, and it bends continuously with no straight segment
 * anywhere. A number would have to be wrong at every moment except one.
 *
 * **U19 is an IP cell.** The era language is a wide chassis with two
 * symmetrical strips of small stepped knobs flanking a pair of movements, which
 * is general to late-1950s American disk mastering equipment and is nobody's
 * property. What is absent is anything specific: no panel artwork, no badge, no
 * typeface, no meter face taken from a photograph, and no reference name in
 * this file or in any identifier it declares. Every asset is drawn in code from
 * design tokens.
 *
 * **U20 means real state.** The two movements read gain reduction per channel,
 * and the storage readouts show what the timing network is holding — which in
 * positions 5 and 6 is the only way a user can see *why* the recovery is where
 * it is. §4 is explicit that the recovery there is a state rather than a
 * setting, so a face that showed only the switch position would be hiding the
 * behaviour the switch selects.
 */
import type { FaceElement, PanelSkin, UnitFace } from '../../harness/types';
import { variableMuControls, variableMuSpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { VariableMuParam } from './params.gen';

/** Meter channels the unit publishes, matching `VariableMuFrame`. */
export const VariableMuMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  GainReductionA: 'gain-reduction-a',
  GainReductionB: 'gain-reduction-b',
  StorageA: 'storage-a',
  StorageB: 'storage-b',
  /**
   * Which link is in circuit, as 1 or 0.
   *
   * Declared because the bridge publishes it, and a published double that no
   * channel names is not a spare — `MotionWaveFace` compares the frame's length
   * against this list and refuses to paint when they disagree, on the grounds
   * that a frame read one slot out would mislabel every readout. It packed
   * seven and this named six, so the Variable-Mu's panel has never painted in
   * the app: it logged the mismatch and returned, once per animation frame.
   */
  LateralVertical: 'lateral-vertical',
} as const;

function meter(id: string, channel: string, name: string): FaceElement {
  return {
    id,
    role: 'meter',
    paramId: null,
    meterChannel: channel,
    accessibleName: name,
    keyboardFocusable: false,
    colours: [{ foreground: '--mw-meter-mid', background: '--mw-bg-sunken' }],
  };
}

/**
 * One movement per channel, declared as `graph` so the harness holds each to a
 * meter's standard: it must name a channel the unit publishes.
 *
 * Two of them rather than one summed reading, because in lateral/vertical mode
 * the two channels are not two speakers — they are the sum and the difference,
 * and a single number would average away the image change that is the mode's
 * entire purpose.
 */
function movement(id: string, channel: string, name: string): FaceElement {
  return {
    id,
    role: 'meter',
    paramId: null,
    meterChannel: channel,
    accessibleName: name,
    keyboardFocusable: true,
    colours: [
      { foreground: '--mw-accent', background: '--mw-bg-sunken' },
      { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
    ],
  };
}

/**
 * `dyn-04` §0: the era's design language — a wide 6U chassis, two symmetrical
 * channel strips of small stepped knobs flanking a pair of VU meters, a mode
 * switch between them — "is general to late-1950s American disk mastering
 * equipment and is fair to evoke".
 *
 * So: wrinkle enamel in the period's grey-green, chicken-head pointers on the
 * stepped controls, legend plates rather than printing, and a wide banded
 * arrangement because the panel really is two strips either side of the metering.
 * A valve unit of this period reads as heavy, and the surface treatment is most of
 * why.
 */
const skin: PanelSkin = {
  era: 'late-1950s American disk-mastering equipment — a wide chassis, symmetrical strips of small stepped knobs flanking the metering',
  surface: 'wrinkle-enamel',
  hueDeg: 96,
  chroma: 'neutral',
  value: 'mid',
  knob: 'chicken-head',
  arrangement: 'wide-banded',
  lettering: 'legend-plate',
  furniture: 'rack-ears',
  lampToken: '--mw-warn',
};

export const variableMuFace: UnitFace = {
  skin,
  elements: [
    movement(
      'movement-a',
      VariableMuMeter.GainReductionA,
      'Left or lateral channel gain reduction, in decibels.',
    ),
    movement(
      'movement-b',
      VariableMuMeter.GainReductionB,
      'Right or vertical channel gain reduction, in decibels.',
    ),

    // What the slow storage elements are holding. §4's positions 5 and 6 make
    // the recovery a function of what has already been played, so without this
    // a user has a control whose effect they cannot see and cannot predict.
    meter('storage-a', VariableMuMeter.StorageA, 'Left or lateral timing network charge'),
    meter('storage-b', VariableMuMeter.StorageB, 'Right or vertical timing network charge'),
    meter('input-level', VariableMuMeter.InputPeak, 'Input level'),
    meter('output-level', VariableMuMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table — the set is the manifest's and
    // cannot be written here.
    ...controlElements(variableMuControls, variableMuSpecs, {
      colours: [{ foreground: '--mw-panel-ink', background: '--mw-fascia' }],
    }),
  ],

  artwork: [
    {
      id: 'panel-surface',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'strip-geometry',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'movement-scale',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'storage-plot',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /**
   * `em`, never `px` — RA-007 one layer up. Ten controls in two mirrored
   * strips, so the first breakpoint is where the strips can sit side by side
   * rather than stacked.
   */
  breakpointsEm: [34, 54],
  minWidthRem: 20,
};
