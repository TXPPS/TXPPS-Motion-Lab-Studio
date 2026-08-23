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

/** What a face element is, in the terms the UI cells can check. */
export interface FaceElement {
  readonly id: string;
  readonly role: 'knob' | 'fader' | 'switch' | 'button' | 'meter' | 'display' | 'graph';
  /** The parameter it reads and writes. Null only for a pure readout. */
  readonly paramId: ParamId | null;
  /** The meter channel it draws, for a meter or a graph. */
  readonly meterChannel?: string;
  readonly accessibleName: string;
  readonly keyboardFocusable: boolean;
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

export interface UnitFace {
  readonly elements: readonly FaceElement[];
  readonly artwork: readonly ArtworkAsset[];
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
}
