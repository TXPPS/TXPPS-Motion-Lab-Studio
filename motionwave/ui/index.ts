/**
 * Motion Wave — the UI, parameter, preset and verification framework.
 *
 * A unit reaches all of it from here. The point of a single entry is not
 * convenience: ADR-0004 says automation, presets, modulation, host exposure and
 * the generic face all follow from a `ParamSpec` declaration with no per-unit
 * work, and that is only true if there is one obvious place to get them from.
 * A unit that imports a module directly is a unit that could have imported a
 * second implementation of the same thing.
 */

// Design system
export { DEFAULT_ROOT_FONT_PX, pxToRem, readRootFontPx, remToDevicePx, remToPx } from './design/metrics';
export { THEME_ATTRIBUTE, THEME_CHOICES, applyTheme, paletteSelectorFor, readTheme, resolveTheme } from './design/theme';
export { contrastRatio, parseColour, relativeLuminance, tokenContrast } from './design/contrast';
export { allTokenNames, blockFor, readTokenBlocks } from './design/stylesheet';
export {
  CONTRAST_PAIRS,
  MOTION_DURATION_TOKENS,
  PALETTE_TOKENS,
  PIXEL_TOKENS,
  REM_TOKENS,
} from './design/tokens';
export type { ContrastPair, ResolvedTheme, ThemeChoice } from './design/tokens';
export type { ThemeTarget } from './design/theme';
export type { TokenBlock } from './design/stylesheet';

// Parameters
export { Taper, Unit, clampNormalised, denormalise, normalise, quantiseNormalised } from './param/units';
export {
  ParamSpecError,
  defaultNormalised,
  defineParam,
  indexSpecs,
  isChoice,
  isSmoothed,
  quantise,
  toChoice,
  toNormalised,
  toReal,
} from './param/spec';
export type { ParamId, ParamSpec, ParamSpecInit } from './param/spec';
export { accessibleValue, formatReal, formatValue, parseDisplay, suffixFor, unitSuffix } from './param/format';
export { DEFAULT_QUEUE_DEPTH, ParamQueue } from './param/queue';
export type { ParamChange } from './param/queue';
export { ParamSet } from './param/set';
export type { ChangeOrigin, ParamChangeEvent, ParamListener } from './param/set';
export { rampAt, rampIncrement, rampOf, steady, toRealRamp } from './param/ramp';
export type { Ramp } from './param/ramp';
export { Smoother } from './param/smoothing';

// Automation and modulation
export { AutomationLane, PPQ } from './automation/lane';
export type { AutomationPoint, CurveKind } from './automation/lane';
export { ModulationMatrix } from './automation/modulation';
export type { ModulationRoute, ReachableBand, SourceReader } from './automation/modulation';
export { AutomationPlayer, NO_SOURCES } from './automation/player';
export { AutomationRecorder } from './automation/recorder';
export type { AutomationMode } from './automation/recorder';

// Presets
export { KNOWN_FIELDS, PRESET_FORMAT, PRESET_SCHEMA_VERSION, PresetFormatError } from './preset/format';
export type { PresetDocument, PresetLoadReport, PresetValues } from './preset/format';
export { applyPreset, capturePreset, carriedValues, parsePreset, presetIds, serialisePreset } from './preset/codec';
export type { PresetMeta } from './preset/codec';
export { PresetMigrations, remapParam, renameParam, seedParam } from './preset/migrate';
export type { MigrationResult, PresetMigration } from './preset/migrate';

// Metering
export { MeterSnapshot } from './metering/snapshot';
export { METER_FLOOR_DB, MeterBus, MeterReader, amplitudeToDb } from './metering/bus';
export type { MeterChannel, MeterKind } from './metering/bus';

// The blend, and the latency it cannot be built without
export { LatencyDeclarationError, NO_LATENCY, declareLatency, sumLatency } from './mix/latency';
export type { DeclaredLatency, LatencySource } from './mix/latency';
export { DelayLine } from './mix/delay_line';
export { WetDryMixer } from './mix/wet_dry';
export type { LatencyDeclaring, MixLaw, WetDryOptions } from './mix/wet_dry';

// The verification harness
export { CELLS, CELL_IDS, cellDefinition } from './harness/cells';
export type { CellDefinition, CellId, CellNeed, CellOutcome } from './harness/cells';
export { HostCapabilities, UNBLOCKED_BY, probeHost, registerCoreModule, unregisterCoreModule } from './harness/capability';
export type { Capability } from './harness/capability';
export { isShipping, testNameFor, verifyUnit } from './harness/verify';
export type { CellResult, VerifyOptions } from './harness/verify';
export { blockedSummary, formatReport, ledgerRow, ledgerValue, tally } from './harness/report';
export { renderOffline } from './harness/render';
export type { OfflineRenderOptions, OfflineRenderResult } from './harness/render';
export type {
  ArtworkAsset,
  CellStatus,
  FaceElement,
  NoteEvent,
  RenderContext,
  SheetTarget,
  UnitFace,
  UnitKind,
  UnitRenderer,
  UnitUnderTest,
  VoiceControl,
} from './harness/types';
