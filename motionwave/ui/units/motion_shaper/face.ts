/**
 * Motion Shaper — the face.
 *
 * The drawable curve is the instrument, not an ornament on it. Everything else
 * on this panel exists to serve the gesture of shaping a bar: the playhead
 * shows where you are in it, the ghosted input shows what you are shaping, and
 * the band shading shows which part of the signal each drawn shape is acting
 * on. A face that put the curve in a corner beside a wall of knobs would be a
 * different product.
 *
 * Two constraints shape every decision here, and both are cells rather than
 * preferences:
 *
 * **U19 is an IP cell.** The visual language is contemporary software — flat
 * planes, a dark working surface, one accent that means "live" — because that
 * is what this unit's era *is*. `fx-01` is a contemporary processor and its
 * sheet records that only the interaction model was studied and no artwork was.
 * There is no vintage panel to evoke and nothing to borrow. Every asset here is
 * drawn from primitives in code, which is why the artwork declaration can say
 * `original` without a licence note.
 *
 * **U20 means real state.** Every readout below is bound to a meter channel the
 * unit actually publishes, and every control to a parameter it actually
 * declares. The harness checks that statically, which is what stops a face
 * drifting away from its unit between releases — but the deeper reason is that
 * a drawn playhead that merely animates at the right rate is a lie that looks
 * exactly like the truth until the engine stalls.
 */
import type { FaceElement, UnitFace } from '../../harness/types';
import { motionShaperControls } from './params.gen';

// Re-exported because the face is where a panel's readers look for it, and a
// second import path for the same table is how two of them end up disagreeing
// about which is authoritative.
export { MotionShaperParam } from './params.gen';

/** Meter channels the unit publishes, matching `VisualFrame`. */
export const MotionShaperMeter = {
  Phase: 'phase',
  BandGainLow: 'band-gain-low',
  BandGainMid: 'band-gain-mid',
  BandGainHigh: 'band-gain-high',
  BandLevelLow: 'band-level-low',
  BandLevelMid: 'band-level-mid',
  BandLevelHigh: 'band-level-high',
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
} as const;

function knob(id: string, paramId: number, name: string): FaceElement {
  return {
    id,
    role: 'knob',
    paramId,
    accessibleName: name,
    keyboardFocusable: true,
    // The pairs a knob actually puts together: its value arc on the panel, and
    // its label on the same panel. U23 contrast-checks both in both themes.
    colours: [
      { foreground: '--mw-accent', background: '--mw-bg-raised' },
      { foreground: '--mw-fg-muted', background: '--mw-bg-raised' },
    ],
  };
}

function switchControl(id: string, paramId: number, name: string): FaceElement {
  return {
    id,
    role: 'switch',
    paramId,
    accessibleName: name,
    keyboardFocusable: true,
    colours: [{ foreground: '--mw-fg', background: '--mw-bg-raised' }],
  };
}

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
 * The curve editor, declared as a `graph` so the harness holds it to the same
 * standard as a meter: it must name a channel the unit publishes.
 *
 * It names the phase channel because the playhead is the part that must be
 * real. The drawn shape is a parameter — the user's own data — and the
 * *position* on it is engine state; conflating the two is how a face ends up
 * animating a playhead from a timer.
 */
const curveEditor: FaceElement = {
  id: 'curve-editor',
  role: 'graph',
  paramId: null,
  meterChannel: MotionShaperMeter.Phase,
  accessibleName:
    'Modulation shape editor. Drag a node to move it, double-tap to add or remove one, ' +
    'drag between nodes to bend the segment.',
  keyboardFocusable: true,
  colours: [
    { foreground: '--mw-accent', background: '--mw-bg-sunken' },
    { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
  ],
};

/**
 * The face's declaration.
 *
 * Every parameter the unit declares has a control here, which the harness
 * enforces: a parameter with no control is unreachable, and an unreachable
 * parameter is a feature nobody can use — the same class of defect as a control
 * that does nothing, seen from the other side.
 */
export const motionShaperFace: UnitFace = {
  elements: [
    curveEditor,

    // Band shading and levels. Bound to what each band actually carries rather
    // than to the crossover's response, because a band's content depends on the
    // material and the response does not.
    meter('band-low-level', MotionShaperMeter.BandLevelLow, 'Low band level'),
    meter('band-mid-level', MotionShaperMeter.BandLevelMid, 'Mid band level'),
    meter('band-high-level', MotionShaperMeter.BandLevelHigh, 'High band level'),

    // What the modulator is doing to each band, right now.
    meter('band-low-gain', MotionShaperMeter.BandGainLow, 'Low band modulation'),
    meter('band-mid-gain', MotionShaperMeter.BandGainMid, 'Mid band modulation'),
    meter('band-high-gain', MotionShaperMeter.BandGainHigh, 'High band modulation'),

    // The ghosted waveform behind the curve is the real input, and the output
    // meter is what the unit did to it.
    meter('input-trace', MotionShaperMeter.InputPeak, 'Input level'),
    meter('output-trace', MotionShaperMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table.
    //
    // The set is not written here and cannot be: it comes from the manifest the
    // C++ dispatch is also generated from, so a control naming a parameter the
    // DSP does not have fails to compile rather than failing a parity test
    // later. What stays here is what is genuinely the face's — which control
    // shape a parameter gets, and the token pairs it puts together — because
    // those are design decisions and the manifest has no opinion about them.
    ...motionShaperControls.map((c) =>
      c.role === 'switch'
        ? switchControl(c.id, c.paramId, c.accessibleName)
        : knob(c.id, c.paramId, c.accessibleName),
    ),
  ],

  /**
   * Every asset is drawn in code from primitives — arcs, rounded rectangles,
   * the curve itself. Nothing is traced, photographed or licensed, which is why
   * `original` needs no licence note beside it. This unit's era is contemporary
   * software, so there is no period panel to evoke and nothing to borrow: the
   * language is flat planes, a dark working surface, and one accent that means
   * "this is live".
   */
  artwork: [
    {
      id: 'panel-surface',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'curve-editor-canvas',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'knob-geometry',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'band-shading',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /**
   * Breakpoints in `em`, never `px`.
   *
   * A px media query is measured against the viewport alone and ignores the
   * root font size entirely, so a face that breaks at px points reflows for a
   * small screen and never for a user who has enlarged their text. That is
   * MotionLab's RA-007 one layer up, and it is free to avoid here.
   *
   * 30em folds the band column under the curve; 48em puts them side by side.
   */
  breakpointsEm: [30, 48],
  minWidthRem: 18,
};
