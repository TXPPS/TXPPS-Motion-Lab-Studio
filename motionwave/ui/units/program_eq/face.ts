/**
 * Program EQ — the face.
 *
 * The panel's job is to make one thing obvious: the two low controls are not
 * opposites. `dyn-01` §3.3 records that the original operating instructions
 * advise against using both at once on the theory that they cancel, that they
 * do not cancel, and that the combination is the reason people buy the unit. A
 * face that drew boost and cut as a mirrored pair would be teaching the manual's
 * mistake, so the response display shows the network's actual curve and the two
 * legs sit side by side rather than opposed.
 *
 * **U19 is an IP cell, not a styling cell.** The visual language here is the
 * era's — a broad panel with the controls in two banded groups, large stepped
 * selectors beside continuous dials, a warm neutral surface — because that is
 * what a 1950s passive equaliser *is*. What is deliberately absent is anything
 * specific: no panel artwork, no badge, no typeface, no colour matched to a
 * particular unit, and no reference name anywhere in this file or in any
 * identifier it declares. Every asset is drawn in code from design tokens,
 * which is why the provenance below reads `original` with no licence note.
 *
 * **U20 means real state.** Every readout is bound to a channel the unit
 * actually publishes, and the harmonic display in particular reads the
 * amplifier's own `curvature()` — the same evaluation the audio's shaping uses.
 * A harmonic profile drawn from a formula would agree with the sound until one
 * of the two was changed.
 */
import type { FaceElement, UnitFace } from '../../harness/types';
import { programEqControls, programEqSpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { ProgramEqParam } from './params.gen';

/** Meter channels the unit publishes, matching `ProgramEqFrame` field for field. */
export const ProgramEqMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  HarmonicSecond: 'harmonic-second',
  HarmonicThird: 'harmonic-third',
  InputCoreDrive: 'input-core-drive',
  OutputCoreDrive: 'output-core-drive',
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
 * The harmonic display, declared as a `graph` so the harness holds it to a
 * meter's standard: it must name a channel the unit publishes.
 *
 * It names the second-harmonic coefficient because that is the number the
 * amplifier's character *is* — §6.3 chose a second-harmonic-dominant profile
 * over the push-pull alternative it could not resolve, and this is where a user
 * watches that choice behave. The third is drawn beside it from its own
 * channel.
 */
const harmonicDisplay: FaceElement = {
  id: 'harmonic-display',
  role: 'meter',
  paramId: null,
  meterChannel: ProgramEqMeter.HarmonicSecond,
  accessibleName:
    'Harmonic profile of the make-up amplifier. Shows the second and third harmonic ' +
    'coefficients the audio path is currently running at.',
  keyboardFocusable: true,
  colours: [
    { foreground: '--mw-accent', background: '--mw-bg-sunken' },
    { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
  ],
};

export const programEqFace: UnitFace = {
  elements: [
    harmonicDisplay,

    // The transformers, which are the unit's low-frequency character and are in
    // circuit whatever the EQ is doing. Shown because §7 says the thickening
    // under sustained bass energy is a property users notice and attribute to
    // the EQ; a face that hid it would leave them attributing it to the wrong
    // control.
    meter('input-core', ProgramEqMeter.InputCoreDrive, 'Input transformer drive'),
    meter('output-core', ProgramEqMeter.OutputCoreDrive, 'Output transformer drive'),
    meter('third-harmonic', ProgramEqMeter.HarmonicThird, 'Third harmonic coefficient'),
    meter('input-level', ProgramEqMeter.InputPeak, 'Input level'),
    meter('output-level', ProgramEqMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table. The set is not written here and
    // cannot be: it comes from the manifest the C++ dispatch is generated from,
    // so a control naming a parameter the DSP does not have fails to compile.
    // What stays here is the face's own — which control shape a parameter gets
    // and the token pairs it puts together.
    ...controlElements(programEqControls, programEqSpecs, {
      colours: [{ foreground: '--mw-panel-ink', background: '--mw-fascia' }],
    }),
  ],

  /**
   * Drawn in code from design tokens: arcs for the dials, a detented ring for
   * the selectors, a banded surface, and the harmonic display's own plot.
   *
   * Nothing is traced, photographed, or licensed, and nothing evokes a
   * particular unit. The era language is in the *proportions* and the control
   * taxonomy — a wide shallow panel, stepped selectors paired with continuous
   * dials, two bands separated on the surface — which is how equalisers of this
   * period were laid out and is not any one manufacturer's property.
   */
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
      id: 'selector-detents',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'harmonic-plot',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /**
   * Breakpoints in `em`, never `px` — MotionLab's RA-007 one layer up. A px
   * media query ignores the root font size entirely, so a face that breaks at px
   * points reflows for a small screen and never for someone who has enlarged
   * their text.
   *
   * Wider than the Motion Shaper's because there are fourteen controls rather
   * than sixteen but they are grouped into four bands that have to stay
   * legible: 32em separates the two EQ bands, 52em puts the display beside them.
   */
  breakpointsEm: [32, 52],
  minWidthRem: 20,
};
