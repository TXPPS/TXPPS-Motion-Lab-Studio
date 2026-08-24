/**
 * FET Limiter — the face.
 *
 * Two things about this panel are backwards from what a plug-in user expects,
 * and both are the hardware's.
 *
 * **The time controls run the wrong way.** Fully clockwise is *fastest* for
 * both ATTACK and RELEASE. §9 test 3 exists to catch a model that gave them
 * conventional sense, and a face that quietly corrected them would be worse
 * than the model doing it, because the panel is what a user learns from.
 *
 * **There is no threshold and no ratio number.** The threshold is fixed and
 * INPUT is how hard the signal is driven into it — which is why INPUT is the
 * large control here rather than a trim. The ratio buttons move the threshold
 * as well as the slope, so at a fixed input 20:1 gives *less* reduction than
 * 4:1; a face that laid them out as a monotonic "amount of compression" would
 * be teaching the opposite of what the unit does.
 *
 * **U19 is an IP cell.** The era language is a narrow panel with two large
 * dials and a VU movement between them, which is how levelling amplifiers of
 * this period were laid out and is nobody's property. What is absent is
 * anything specific: no panel artwork, no badge, no typeface, no meter face
 * copied from a photograph, and no reference name in this file or in any
 * identifier it declares. Every asset is drawn in code from design tokens.
 *
 * **U20 means real state.** The gain-reduction readout is the *meter* cell's,
 * not an instantaneous calculation — §3.4 says the reading comes from a second
 * photocell with the first one's lag and then drives a VU movement, and QA is
 * told in as many words not to compare the model's meter against an instant
 * number. A face that showed the true reduction would be more accurate and less
 * faithful, and would disagree with the hardware exactly where users notice.
 */
import type { FaceElement, UnitFace } from '../../harness/types';
import { fetLimiterControls, fetLimiterSpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { FetLimiterParam } from './params.gen';

/** Meter channels the unit publishes, matching `FetLimiterFrame`. */
export const FetLimiterMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  GainReduction: 'gain-reduction',
  Detector: 'detector',
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
 * The movement, declared as a `graph` so the harness holds it to a meter's
 * standard: it must name a channel the unit publishes.
 *
 * It names the gain-reduction channel, which carries the *meter* cell's reading
 * through the VU ballistics — both lags, as the hardware has both.
 */
const movement: FaceElement = {
  id: 'vu-movement',
  role: 'meter',
  paramId: null,
  meterChannel: FetLimiterMeter.GainReduction,
  accessibleName: "Gain reduction meter, in decibels below the element's resting gain.",
  keyboardFocusable: true,
  colours: [
    { foreground: '--mw-accent', background: '--mw-bg-sunken' },
    { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
  ],
};

export const fetLimiterFace: UnitFace = {
  elements: [
    movement,

    // The timing network's charge, shown because §4.2's rule is that it is a
    // *state* rather than an envelope reset per transient: closely spaced hits
    // hold the gain down and recover together, and a user watching only the
    // reduction cannot see why the second hit behaved differently.
    meter('detector', FetLimiterMeter.Detector, 'Timing network charge'),
    meter('input-level', FetLimiterMeter.InputPeak, 'Input level'),
    meter('output-level', FetLimiterMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table — the set is the manifest's and
    // cannot be written here.
    ...controlElements(fetLimiterControls, fetLimiterSpecs, {
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
      id: 'dial-geometry',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'movement-scale',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'history-plot',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /** `em`, never `px` — RA-007 one layer up. Nine controls in two groups. */
  breakpointsEm: [30, 48],
  minWidthRem: 18,
};
