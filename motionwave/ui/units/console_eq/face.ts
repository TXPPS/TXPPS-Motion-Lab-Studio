/**
 * Console EQ — the face.
 *
 * **One device, two panels, and the switch between them changes what the
 * controls mean.** §8's table is not a list of presets: the inductor lineage
 * has a fixed 12 kHz high shelf, six mid detents and an 18 dB/octave high-pass;
 * the bridged-T lineage has three five-position bands, stepped amounts and a
 * band-pass. A face that showed one set of controls for both would be
 * describing a device that does not exist, so the lineage switch is the first
 * element and everything after it is grouped by which panel it belongs to.
 *
 * **No Q control, on either panel, and that is a modelling statement.** §6.2
 * ends by saying any UI that exposes a Q control on this family has
 * misunderstood it — on the bridged-T side the shape and the amount are
 * mechanically tied, and on the inductor side Q is set by which frequency is
 * selected and by how much is asked for. Both are consequences, so both are
 * *shown* rather than offered.
 *
 * **The amounts are stepped on one panel and continuous on the other**, which
 * looks like an inconsistency and is the hardware. The bridged-T panel is a
 * detented switch whose five values widen at the top; the inductor panel is a
 * continuous concentric control. Rounding one to match the other would be
 * tidying away the difference §10 test 11 measures.
 *
 * **U19 is an IP cell.** The era language is a narrow module with concentric
 * stepped rotaries carrying frequency and amount on one shaft, and a small
 * latching EQ switch — general to late-1960s and early-1970s console modules
 * and nobody's property. What is absent is anything specific: no panel artwork,
 * no badge, no typeface, no coloured skirt copied from a photograph, and no
 * reference name in this file or in any identifier it declares. Every asset is
 * drawn in code from design tokens.
 *
 * **U20 means real state.** The curve readout and the working Q and bandwidth
 * come from the unit's own running coefficients, not from the control values —
 * which is the house rule and the reason a drawn curve here cannot disagree
 * with what is heard.
 */
import type { FaceElement, PanelSkin, UnitFace } from '../../harness/types';
import { consoleEqControls, consoleEqSpecs } from './params.gen';
import { controlElements } from '../../render/faceControls';

export { ConsoleEqParam } from './params.gen';

/** Meter channels the unit publishes, matching `ConsoleEqFrame`. */
export const ConsoleEqMeter = {
  InputPeak: 'input-peak',
  OutputPeak: 'output-peak',
  MidQ: 'mid-q',
  BandOneWidth: 'band-one-width',
  BandTwoWidth: 'band-two-width',
  BandThreeWidth: 'band-three-width',
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
 * The curve, declared as a `graph` so the harness holds it to a meter's
 * standard: it must name a channel the unit publishes.
 *
 * It names the mid band's working Q, because that is the number a user cannot
 * predict from the panel — it moves with the selected frequency *and* with the
 * amount, and on the bridged-T panel the equivalent number moves with the
 * amount alone. Drawing the curve without it would leave the one thing the
 * controls do not say.
 */
const curve: FaceElement = {
  id: 'eq-curve',
  role: 'meter',
  paramId: null,
  meterChannel: ConsoleEqMeter.MidQ,
  accessibleName: 'Equaliser response, drawn from the coefficients in circuit.',
  keyboardFocusable: true,
  colours: [
    { foreground: '--mw-accent', background: '--mw-bg-sunken' },
    { foreground: '--mw-fg-muted', background: '--mw-bg-sunken' },
  ],
};

/**
 * `dyn-05` §0: the era's design language — concentric stepped rotary switches
 * with coloured skirts, one switch per band carrying both frequency and amount, a
 * small EQ-in latching switch, narrow module proportions — "is general to
 * late-1960s and early-1970s console modules and is fair to evoke".
 *
 * So: a dark anodised module, collet knobs, silkscreened legends, no rack ears —
 * because this is a channel strip that lives in a frame rather than a box that
 * lives in a rack, and the proportions are the first thing that says so. The unit
 * carries two lineages and one panel: the era language above is common to both,
 * which is why the lineage shows in the controls rather than in the fascia.
 */
const skin: PanelSkin = {
  era: 'late-1960s and early-1970s console modules — a narrow anodised strip of collet knobs, no rack ears because it lives in a frame',
  surface: 'anodised',
  hueDeg: 248,
  chroma: 'muted',
  value: 'dark',
  knob: 'collet',
  arrangement: 'console',
  lettering: 'silkscreen',
  furniture: 'none',
  lampToken: '--mw-accent',
};

export const consoleEqFace: UnitFace = {
  skin,
  elements: [
    curve,

    // The three bridged-T bandwidths, which are what proportional Q looks like
    // from the outside: they move when the *amount* moves and by nothing else.
    meter('band-one-width', ConsoleEqMeter.BandOneWidth, 'Band 1 bandwidth in octaves'),
    meter('band-two-width', ConsoleEqMeter.BandTwoWidth, 'Band 2 bandwidth in octaves'),
    meter('band-three-width', ConsoleEqMeter.BandThreeWidth, 'Band 3 bandwidth in octaves'),
    meter('input-level', ConsoleEqMeter.InputPeak, 'Input level'),
    meter('output-level', ConsoleEqMeter.OutputPeak, 'Output level'),

    // Every control, from the generated table — the set is the manifest's and
    // cannot be written here.
    ...controlElements(consoleEqControls, consoleEqSpecs, {
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
      id: 'concentric-geometry',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'curve-plot',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
    {
      id: 'detent-marks',
      origin: 'original',
      attribution: 'Drawn in code from design tokens for Motion Wave',
    },
  ],

  /**
   * `em`, never `px` — RA-007 one layer up. Twenty controls in two panels that
   * are never both in use, so the first breakpoint is where a whole panel and
   * its curve fit side by side.
   */
  breakpointsEm: [36, 56],
  minWidthRem: 21,
};
