/**
 * Granular Reverb — the face.
 *
 * **The cloud is the panel's subject, and it is drawn from the grains that are
 * actually sounding.** U20's rule is the house rule stated for this unit: the
 * particle field reads `GrainFrame`, which the engine publishes from the same
 * pool the audio renders from, so a particle's position is the position a read
 * came from and its brightness is the windowed amplitude that sample was
 * multiplied by. A field animated from the Density and Size controls would look
 * almost identical and would be a second opinion — and would keep looking right
 * after the pool started dropping grains, which is exactly when a user needs it
 * to look wrong.
 *
 * **It says how many grains it is not showing.** The frame carries `published`
 * and `live` separately because the publish path caps at sixty-four; the
 * readout is "64 of 210" rather than a field that quietly stops getting denser.
 * A visualiser that showed a subset silently would make the Density control
 * appear to stop working at the point the subset filled.
 *
 * **Overlap and the damped RT60 are readouts, not controls.** §6 lists overlap
 * as "not a control: display `O = R·L` live", because it is the number that
 * predicts both the sound and the CPU, and neither of the two controls that set
 * it predicts it alone. The 8 kHz RT60 beside Damping is §2.5's request for the
 * same reason: it turns a percentage into the thing the percentage does.
 *
 * **Freeze is a latching toggle and reads back from the frame.** Freeze fades
 * over 10 ms and the write head stops only once that fade has finished, so the
 * indicator follows `frozen` from the unit rather than the control's own state
 * — otherwise it would light before the buffer was actually held.
 *
 * **U19 is an IP cell.** The era language here is the one granular processors
 * have shared since they became controllable in real time: a wide dark display
 * field with a scatter of point sources over a time axis, a row of small
 * detented rotaries beneath it, and a latching hold switch set apart from the
 * rest. That vocabulary is general and nobody's property. What is absent is
 * anything specific — no panel artwork, badge, typeface or colour scheme taken
 * from a photograph or a product, no reference name in this file or in any
 * identifier it declares, and no preset named after one. Every asset is drawn
 * in code from design tokens.
 */
import type { FaceElement, UnitFace } from '../../harness/types';
import { granularReverbControls, granularReverbSpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { GranularReverbParam } from './params.gen';

/** Meter channels the unit publishes, matching `GranularReverbFrame`. */
export const GranularReverbMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  /** `O = R·L`, §6's readout. */
  Overlap: 'overlap',
  /** What the tier cap left of the asked-for density. */
  ClampedDensity: 'clamped-density',
  /** §2.5's legibility number for the Damping control. */
  Rt60At8k: 'rt60-at-8k',
  /** The loop's per-pass gain, which is what Decay actually sets. */
  Feedback: 'feedback',
  /** Grains sounding now — the true count, not the published subset. */
  LiveGrains: 'live-grains',
} as const;

/**
 * Freeze and Bypass, as latching buttons.
 *
 * The manifest calls their control kind `toggle` because that is what a user
 * does with them; the face vocabulary has no such role, and inventing one would
 * mean every renderer had to grow a case for two controls. `button` is the
 * latching element the vocabulary already has, and the manifest's kind is what
 * says the latch holds rather than springs back.
 */

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
 * The cloud, declared as a `graph` so the harness holds it to a meter's
 * standard: it must name a channel the unit publishes.
 *
 * It names the live grain count rather than a level, because that is the number
 * the field is a picture of. Naming a peak instead would let the field and its
 * declared channel disagree about what is being drawn — and the count is also
 * what the "showing 64 of N" readout is counting.
 */
const cloud: FaceElement = {
  id: 'grain-cloud',
  role: 'meter',
  paramId: null,
  meterChannel: GranularReverbMeter.LiveGrains,
  accessibleName:
    'Grain cloud, drawn from the grains currently sounding. Each point is one grain: ' +
    'horizontal position is where in the buffer it is reading, brightness is its ' +
    'windowed amplitude now, and vertical position is its pan.',
  keyboardFocusable: true,
  colours: [
    { foreground: '--mw-accent', background: '--mw-bg-sunken' },
    { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
  ],
};

export const granularReverbFace: UnitFace = {
  elements: [
    cloud,

    // The readouts §6 and §2.5 ask for by name, which no control states.
    meter('overlap', GranularReverbMeter.Overlap, 'Overlap, grains sounding at once'),
    meter('live-grains', GranularReverbMeter.LiveGrains, 'Grains sounding now'),
    meter(
      'clamped-density',
      GranularReverbMeter.ClampedDensity,
      'Density after the quality tier cap',
    ),
    meter('rt60-8k', GranularReverbMeter.Rt60At8k, 'Resulting decay time at 8 kHz'),
    meter('feedback', GranularReverbMeter.Feedback, 'Loop gain per pass'),
    meter('input-level', GranularReverbMeter.InputPeak, 'Input level'),
    meter('output-level', GranularReverbMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table — the set is the manifest's and
    // cannot be written here.
    ...controlElements(granularReverbControls, granularReverbSpecs, {
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
      id: 'cloud-field',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'grain-particle',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'hold-switch',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /**
   * `em`, never `px` — RA-007 one layer up. Twenty-two controls and a display
   * that wants width, so the first breakpoint is where the cloud can sit beside
   * a column of controls rather than above them, and the second is where all
   * four control groups fit in one row under it.
   */
  breakpointsEm: [38, 60],
  minWidthRem: 22,
};
