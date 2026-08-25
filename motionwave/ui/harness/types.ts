/**
 * Motion Wave — what a unit hands the verification harness.
 *
 * `docs/UNIT_LEDGER.md` defines twenty-three Definition-of-Done cells and says
 * a unit is `SHIPPING` only when every applicable one reads `PASS`, backed by a
 * named executable test. Twenty-three checks written once per unit is fourteen
 * copies that diverge; the fourteenth unit's D4 would not be the first unit's
 * D4, and the ledger would stop meaning one thing. So the checks are written
 * once, here, parameterised by the unit, and a unit's test file is a few lines
 * that hands over this interface.
 *
 * The interface is deliberately small and mostly optional. A unit that supplies
 * no face does not fail the UI cells, it is reported as unable to run them —
 * the ledger distinguishes "not done" from "cannot be done here", and blurring
 * the two is how a board goes green without a product behind it (ADR-0005).
 */

import type { DeclaredLatency } from '../mix/latency';
import type { CurveNode } from '../render/controls/curve_model';
import type { MeterChannel } from '../metering/bus';
import type { ParamId, ParamSpec } from '../param/spec';
import type { Ramp } from '../param/ramp';
import type { PresetDocument } from '../preset/format';
import type { PresetMeta } from '../preset/codec';
import type { Capability } from './capability';

export type UnitKind = 'effect' | 'instrument';

/** The values a ledger cell may hold. Nothing else is representable. */
export type CellStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'n/a';

export interface RenderContext {
  readonly sampleRate: number;
  readonly blockFrames: number;
  /**
   * The tempo the render runs at. Passed in `prepare` rather than read from a
   * global, because a unit with a tempo-synced control has to derive its real
   * value from the same map the transport uses — a unit that kept its own idea
   * of the tempo would drift against the grid it is supposed to be locked to,
   * and D12 exists to catch exactly that.
   */
  readonly tempoBpm: number;
}

/**
 * The DSP side of a unit, as the harness drives it.
 *
 * Parameters arrive as ramps the framework computed — the unit is handed the
 * result of automation and modulation rather than being given the lanes and
 * asked to evaluate them. That is what makes "no unit reimplements automation"
 * structural instead of a rule in a document: there is nothing here to
 * reimplement it with.
 */
export interface UnitRenderer {
  readonly declaredLatency: DeclaredLatency;
  prepare(context: RenderContext): void;
  reset(): void;
  processBlock(
    input: Float32Array,
    output: Float32Array,
    frames: number,
    params: ReadonlyMap<ParamId, Ramp>,
  ): void;
  /** Absent means the unit cannot be bypassed internally, which D4 reports. */
  setBypass?(bypassed: boolean): void;
  /** Meter frames the unit publishes, if it meters. */
  readonly meters?: { publish(frame: ArrayLike<number>): void };
}

/** A note, in the terms an instrument's voice allocator needs. */
export interface NoteEvent {
  readonly noteId: number;
  readonly key: number;
  readonly velocity: number;
  /** MPE member channel, or 0 for a single-channel source. */
  readonly channel: number;
}

export interface VoiceControl {
  readonly maxVoices: number;
  /** Voices currently producing sound, including those in release. */
  readonly activeVoices: number;
  /**
   * Voices with no scheduled end. The measure that actually catches a stuck
   * note: a correctly released voice stays allocated until its tail retires, so
   * `activeVoices` answers "is it busy", not "is it stuck".
   */
  readonly sustainingVoices: number;
  noteOn(event: NoteEvent): void;
  noteOff(noteId: number): void;
  panic(): void;
  /** MPE per-note expression. Absent means the unit does not claim MPE. */
  setNotePitchBend?(noteId: number, semitones: number): void;
  setNotePressure?(noteId: number, value: number): void;
  setNoteTimbre?(noteId: number, value: number): void;
  /** Cents offset per pitch class, for a unit that claims alternate tunings. */
  setTuningTable?(centsPerPitchClass: readonly number[]): void;
}

/**
 * The control primitives, which are what cell 26 is about.
 *
 * Six of these were one primitive until Directive 09: `render/facePanel.ts`
 * built an `<input type="range">` for every role, through a ternary whose two
 * branches both returned `'range'`. A stepped selector, a latching button and a
 * continuous dial were the same widget with different labels, and no cell could
 * see it — `U22` asks whether a control is 44 px, never whether the 44 px is a
 * knob or a slider.
 *
 * The set is deliberately small and each member is a distinct *gesture*, not a
 * distinct drawing: a selector snaps and a knob does not, a toggle flips on a
 * tap and a knob does not. That is what makes "the correct primitive" a
 * behavioural claim a test can settle rather than a matter of taste.
 */
export type ControlPrimitive = 'knob' | 'fader' | 'selector' | 'toggle' | 'rocker' | 'button';

/** Primitives that draw engine state rather than take input. */
export type ReadoutPrimitive = 'meter' | 'vu' | 'lamp' | 'display';

/**
 * Primitives that are both — a surface the user edits *and* a picture of state.
 * The Motion Shaper's curve is the whole unit, and it had no surface at all.
 */
export type EditorPrimitive = 'curve';

export type FaceRole = ControlPrimitive | ReadoutPrimitive | EditorPrimitive;

/** What a face element is, in the terms the UI cells can check. */
export interface FaceElement {
  readonly id: string;
  readonly role: FaceRole;
  /** The parameter it reads and writes. Null only for a pure readout. */
  readonly paramId: ParamId | null;
  /** The meter channel it draws, for a meter or a graph. */
  readonly meterChannel?: string;
  readonly accessibleName: string;
  readonly keyboardFocusable: boolean;
  /**
   * Which of the unit's shapes a `curve` edits.
   *
   * Declared rather than inferred from position, because a unit with three
   * curves and one editor is a legitimate face and inferring the index from
   * element order would silently bind it to the wrong band.
   */
  readonly shapeIndex?: number;
  /**
   * What a bar meter is showing. Gain reduction is an amount taken *away*, so
   * it is drawn from the other end; a reduction meter that filled like a level
   * meter would read as more signal at the moment there is less.
   */
  readonly meterScale?: 'level' | 'reduction';
  /** Where a lamp lights, on its channel's own scale. */
  readonly lampThreshold?: number;
  /** Token pairs this element puts together, checked for contrast by U23. */
  readonly colours?: readonly { readonly foreground: string; readonly background: string }[];
}

export interface ArtworkAsset {
  readonly id: string;
  /** `original` is the only value that satisfies U19 without a licence note. */
  readonly origin: 'original' | 'licensed' | 'generated';
  /** Who made it, or the licence it is used under. Empty fails the cell. */
  readonly attribution: string;
}

/**
 * How one unit's panel differs from every other unit's, declared as data.
 *
 * Cell 26 requires that a panel be distinguishable from the other thirteen at a
 * glance, and the reason seven panels were identical is worth stating plainly:
 * every face declared its *controls* and none declared its *appearance*, so the
 * shared renderer had nothing to render differently and drew the only panel it
 * knew. Adding per-unit drawing code to the renderer would have fixed the
 * symptom and destroyed the property that makes fourteen faces affordable —
 * `render/facePanel.ts` may not know what a Motion Shaper is.
 *
 * So appearance becomes declaration, like everything else here. The renderer
 * interprets these fields generically; a face that wants a different panel says
 * so in this object rather than in a special case somewhere else.
 *
 * Every field is era *language*, never a particular unit: control taxonomy,
 * panel proportion, surface treatment and colour temperature of the period.
 * Nothing here names, traces or matches any manufacturer's product — see
 * `LEGAL_NOTES.md`, which is a commercial-safety requirement rather than a
 * stylistic one.
 */
export interface PanelSkin {
  /** The era and class this panel speaks, in prose. Evidence for `U19`. */
  readonly era: string;
  /** Fascia treatment. Each is drawn in code from tokens; none is traced. */
  readonly surface:
    | 'painted-steel'
    | 'brushed-alloy'
    | 'wrinkle-enamel'
    | 'anodised'
    | 'moulded'
    | 'glass';
  /** Fascia hue in degrees, and how far from neutral the surface sits. */
  readonly hueDeg: number;
  readonly chroma: 'neutral' | 'muted' | 'saturated';
  /** Fascia lightness. A 1950s rack panel is light; a 1970s one is black. */
  readonly value: 'light' | 'mid' | 'dark';
  /** The knob body of this class and period. */
  readonly knob: 'pointer-skirt' | 'chicken-head' | 'fluted' | 'bar' | 'collet' | 'flat-cap';
  /** How the panel arranges what it carries. */
  readonly arrangement: 'wide-banded' | 'centre-stage' | 'strip' | 'console' | 'field';
  /** How legends are set on the fascia. */
  readonly lettering: 'engraved' | 'silkscreen' | 'legend-plate';
  /** Panel furniture, which is most of what a panel reads as from across a room. */
  readonly furniture: 'rack-ears' | 'bezel' | 'none';
  /** Token used for lamps and pointer indicators on this panel. */
  readonly lampToken: string;
}

export interface UnitFace {
  readonly elements: readonly FaceElement[];
  readonly artwork: readonly ArtworkAsset[];
  /**
   * Absent only for a face written before cell 26. A face with no skin renders
   * as the framework's default panel, which is the appearance cell 26 fails.
   */
  readonly skin?: PanelSkin;
  /**
   * Layout breakpoints in `em`, never `px`. A px media query is measured
   * against the viewport alone and ignores the root font size entirely, so a
   * face that breaks at px points reflows for a small screen and never for a
   * user who has enlarged their text — RA-007's failure, one layer up.
   */
  readonly breakpointsEm: readonly number[];
  readonly minWidthRem: number;
}

/** One measurable claim from a unit's Reference Spec Sheet. */
export interface SheetTarget {
  readonly what: string;
  /** Parameter positions, normalised, to set before measuring. */
  readonly params: ReadonlyMap<ParamId, number>;
  readonly probeHz: number;
  /** Expected gain at `probeHz`, in dB, and the tolerance the sheet allows. */
  readonly expectedDb: number;
  readonly toleranceDb: number;
}

export interface UnitUnderTest {
  /** The sheet id from `docs/UNIT_LEDGER.md`, e.g. `fx-01`. */
  readonly id: string;
  readonly name: string;
  readonly kind: UnitKind;
  readonly specs: readonly ParamSpec[];
  readonly declaredLatency: DeclaredLatency;
  readonly presetMeta: PresetMeta;
  readonly meters?: readonly MeterChannel[];
  /**
   * Shapes this unit carries beside its parameters, if any.
   *
   * The Motion Shaper's modulation is a drawn curve per band, and a curve is
   * not a `ParamSpec` — it has no range, no taper and no single value. It is
   * still state the unit needs and a project has to persist, so a unit that has
   * shapes says how many rather than leaving a host to know.
   *
   * Declared here so a host can carry them without knowing which unit it is
   * looking at: ADR-0007's boundary forbids unit-specific special-casing in the
   * host, and "the Motion Shaper has three curves" living in `src/` would be
   * exactly that.
   */
  readonly shapeCount?: number;
  /**
   * What each curve holds on a fresh insert. Required wherever `shapeCount` is.
   *
   * A unit whose whole mechanism is a drawn shape starts with **no shape**
   * unless it says otherwise, and the core's `reset()` leaves every curve flat
   * at 1.0 — which `motion_shaper.h` defines as unity gain. The Motion Shaper
   * shipped that way: inserting it produced an empty curve editor and a unit
   * that was a bit-exact no-op until the user guessed that the blank box was
   * the instrument. It was reported as "doesn't really do anything", and that
   * was exactly right.
   *
   * Declared beside `shapeCount` and in the unit's own curve model, so the host
   * seeds it without knowing which unit it is holding — the same reason
   * `shapeCount` lives here rather than in `src/`.
   */
  readonly defaultShapes?: readonly (readonly CurveNode[])[];
  readonly factoryPresets?: readonly PresetDocument[];
  /** Absent when this host cannot run the unit's DSP at all. */
  readonly renderer?: UnitRenderer;
  /** Why the renderer is absent. Reported verbatim as the BLOCKED reason. */
  readonly rendererBlockedBy?: Capability;
  readonly voices?: VoiceControl;
  readonly face?: UnitFace;
  readonly sheetTargets?: readonly SheetTarget[];
  /** Oversampling factor and the worst alias level the sheet permits, in dBc. */
  readonly oversampling?: { readonly factor: number; readonly maxAliasDbc: number };
  /** Parameters whose real value is derived from tempo, for D12. */
  readonly tempoSyncedParams?: readonly ParamId[];
  /**
   * The positions to hold the *other* parameters at while checking that a given
   * one is wired (D1). Q means nothing at zero gain and a release time means
   * nothing below the threshold, so a unit whose controls interact declares the
   * context each one needs to be audible in. It is not an exemption — the check
   * still renders and still has to hear a difference — it is the difference
   * between a harness that finds real dead controls and one that a unit has to
   * be built around.
   */
  readonly wiringContext?: (paramId: ParamId) => ReadonlyMap<ParamId, number>;
}
