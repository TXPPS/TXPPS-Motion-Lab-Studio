/**
 * Optical Leveller — the face.
 *
 * The panel has one job the other units do not: it must not lie about time.
 * This unit's release is *not a number* — §4 says so outright, and says a model
 * that exposed one would be wrong — so the face shows the two things that make
 * it move rather than a control that pretends to set it. The exposure readout
 * is why the same transient recovers differently after a busy passage than
 * after a quiet one, and the release readout is what that history currently
 * amounts to in seconds.
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
import { opticalLevellerControls, opticalLevellerSpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { OpticalLevellerParam } from './params.gen';

/** Meter channels the unit publishes, matching `OpticalLevellerFrame`. */
export const OpticalLevellerMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  GainReduction: 'gain-reduction',
  Exposure: 'exposure',
  ReleaseSeconds: 'release-seconds',
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
  meterChannel: OpticalLevellerMeter.GainReduction,
  accessibleName:
    'Gain reduction meter. Reads the second photocell through a VU movement, so it ' +
    'under-reads short events exactly as the hardware does.',
  keyboardFocusable: true,
  colours: [
    { foreground: '--mw-accent', background: '--mw-bg-sunken' },
    { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
  ],
};

export const opticalLevellerFace: UnitFace = {
  elements: [
    movement,

    // The two states that make release what it is. Shown because §4's
    // consequences say release must never be exposed as a fixed number, and a
    // face that showed neither would leave a user with a control that behaves
    // differently every time and no way to see why.
    meter('exposure', OpticalLevellerMeter.Exposure, 'Cell exposure history'),
    meter('release-time', OpticalLevellerMeter.ReleaseSeconds, 'Current release time'),
    meter('input-level', OpticalLevellerMeter.InputPeak, 'Input level'),
    meter('output-level', OpticalLevellerMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table — the set is the manifest's and
    // cannot be written here.
    ...controlElements(opticalLevellerControls, opticalLevellerSpecs, {
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
  breakpointsEm: [28, 46],
  minWidthRem: 18,
};
