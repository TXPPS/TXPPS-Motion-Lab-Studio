/**
 * Project repository: validation, migration, CRUD, autosave plumbing.
 * Graceful about missing/corrupt/newer-schema data and quota failures.
 */
import { newId } from '../model/ids';
import { SCHEMA_VERSION } from '../model/types';
import type { EffectKind, ProjectData, ProjectMeta, Track } from '../model/types';
import { isKnownEffect, MAX_INSERTS, normaliseParams } from '../model/effects';
import { normalizeTempoMap } from '../model/tempo';
import { normalizeChords, normalizeMarkers, normalizeSections } from '../model/arrangement';
import { normalizeLinks } from '../model/controlLink';
import { normalizeGrooves } from '../model/groove';
import { AUDIO_TRACK_TYPES } from '../model/types';
import { isAutomationMode, validateLane } from '../model/automation';
import { paramIdExists } from '../model/paramRegistry';
import { normalizeComp } from '../model/comping';
import { validateSampler } from '../model/sampler';
import type { RackItem, Take } from '../model/types';

const FADE_SHAPES = new Set(['linear', 'equalPower', 'equalGain', 's']);
import { diagLog } from '../state/diagnostics';
import { idbDelete, idbGet, idbGetAll, idbPut, openDb, STORE_PREFS, STORE_PROJECTS } from './db';

export class SchemaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SchemaError';
  }
}

export interface Prefs {
  lastProjectId?: string;
  midiInputId?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Validate + normalize raw stored data into a ProjectData. Throws SchemaError
 * for unusable input; fills defaults for optional fields.
 */
export function validateProject(raw: unknown): ProjectData {
  if (!isRecord(raw)) throw new SchemaError('project data is not an object');
  // IndexedDB (structured clone) can store values JSON cannot — NaN,
  // Infinity, undefined-in-arrays. Normalize through JSON once so validated
  // state is identical to what an export/import cycle would produce, and so
  // validation is a fixpoint even for unknown passthrough fields.
  try {
    raw = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  } catch {
    throw new SchemaError('project data is not serializable');
  }
  if (!isRecord(raw)) throw new SchemaError('project data is not an object');
  const v = raw.schemaVersion;
  if (typeof v !== 'number') throw new SchemaError('missing schemaVersion');
  if (v > SCHEMA_VERSION) {
    throw new SchemaError(
      `project schema v${v} is newer than this app (v${SCHEMA_VERSION}) — please update the app`,
    );
  }
  if (!Array.isArray(raw.tracks) || !Array.isArray(raw.clips)) {
    throw new SchemaError('project is missing tracks/clips');
  }
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    throw new SchemaError('project is missing id/name');
  }
  const bpm = typeof raw.bpm === 'number' && raw.bpm >= 30 && raw.bpm <= 300 ? raw.bpm : 120;
  const ts = isRecord(raw.timeSig) ? raw.timeSig : {};
  const loop = isRecord(raw.loop) ? raw.loop : {};
  const ws = isRecord(raw.workspace) ? raw.workspace : {};
  // Structural sanity for tracks/clips; drop entries that are hopeless.
  const tracks = raw.tracks.filter(
    (t): t is ProjectData['tracks'][number] =>
      isRecord(t) && typeof t.id === 'string' && typeof t.type === 'string',
  );
  const trackIds = new Set(tracks.map((t) => t.id));
  const clips = raw.clips.filter(
    (c): c is ProjectData['clips'][number] =>
      isRecord(c) &&
      typeof c.id === 'string' &&
      typeof c.trackId === 'string' &&
      trackIds.has(c.trackId) &&
      typeof c.start === 'number' &&
      Number.isFinite(c.start) &&
      typeof c.length === 'number' &&
      Number.isFinite(c.length),
  );
  const dropped = raw.clips.length - clips.length + (raw.tracks.length - tracks.length);
  if (dropped > 0) diagLog('warn', `Project "${raw.name}": dropped ${dropped} invalid entries`);

  // --- v1 → v2 migration -------------------------------------------------
  // Purely additive: fields that did not exist in v1 get their v1-equivalent
  // defaults, so a Milestone 1 project keeps sounding exactly the same.
  for (const c of clips) {
    const base = c as unknown as Record<string, unknown>;
    if (base.locked !== undefined && typeof base.locked !== 'boolean') delete base.locked;
    // v6: per-clip inserts, validated exactly like a channel's.
    if (base.eventFx !== undefined) {
      const list = Array.isArray(base.eventFx)
        ? (base.eventFx as unknown[])
            .filter(
              (e) =>
                isRecord(e) &&
                typeof e.id === 'string' &&
                typeof e.kind === 'string' &&
                isKnownEffect(e.kind),
            )
            .slice(0, 4)
            .map((e) => {
              const r = e as Record<string, unknown>;
              const kind = r.kind as EffectKind;
              return {
                id: r.id as string,
                kind,
                bypass: r.bypass === true,
                params: normaliseParams(kind, isRecord(r.params) ? r.params : undefined),
              };
            })
        : [];
      if (list.length) base.eventFx = list;
      else delete base.eventFx;
    }
    if (typeof base.color !== 'string') delete base.color;
    if (c.type === 'midi') {
      // Notes with non-finite numerics (NaN/Infinity survive `typeof ===
      // 'number'`) would corrupt scheduling and JSON round-trips — drop them,
      // and clamp the rest to the playable ranges. Fuzz-covered.
      const m = c as unknown as { notes?: unknown };
      const notes = (Array.isArray(m.notes) ? m.notes : []).filter(
        (n): n is { start: number; length: number; pitch: number; velocity: number } =>
          isRecord(n) &&
          typeof n.start === 'number' &&
          Number.isFinite(n.start) &&
          n.start >= 0 &&
          typeof n.length === 'number' &&
          Number.isFinite(n.length) &&
          n.length > 0 &&
          typeof n.pitch === 'number' &&
          Number.isFinite(n.pitch) &&
          typeof n.velocity === 'number' &&
          Number.isFinite(n.velocity),
      );
      for (const n of notes) {
        n.pitch = Math.min(127, Math.max(0, Math.round(n.pitch)));
        n.velocity = Math.min(127, Math.max(1, Math.round(n.velocity)));
      }
      m.notes = notes;
    }
    if (c.type === 'audio') {
      const a = c as unknown as Record<string, unknown>;
      if (typeof a.fadeIn !== 'number' || a.fadeIn < 0) a.fadeIn = 0;
      if (typeof a.fadeOut !== 'number' || a.fadeOut < 0) a.fadeOut = 0;
      if (typeof a.gain !== 'number') a.gain = 1;
      if (typeof a.offset !== 'number') a.offset = 0;
      if (a.sourceDuration !== undefined && typeof a.sourceDuration !== 'number') {
        delete a.sourceDuration;
      }
      // --- v3 → v4: fade shapes, cleanup flags, takes/comp ---------------
      for (const key of ['fadeInShape', 'fadeOutShape'] as const) {
        if (a[key] !== undefined && !(typeof a[key] === 'string' && FADE_SHAPES.has(a[key]))) {
          delete a[key];
        }
      }
      for (const key of ['phaseInvert', 'monoSum', 'takesOpen'] as const) {
        if (a[key] !== undefined && typeof a[key] !== 'boolean') delete a[key];
      }
      if (a.takes !== undefined) {
        const takes = (Array.isArray(a.takes) ? a.takes : []).filter(
          (t): t is Take =>
            isRecord(t) &&
            typeof t.id === 'string' &&
            typeof t.mediaId === 'string' &&
            typeof t.offset === 'number' &&
            Number.isFinite(t.offset),
        );
        if (takes.length === 0) {
          delete a.takes;
          delete a.comp;
          delete a.soloTakeId;
        } else {
          for (const t of takes) if (typeof t.name !== 'string') t.name = 'Take';
          a.takes = takes;
          const segs = Array.isArray(a.comp)
            ? (a.comp as unknown[]).filter(
                (s) => isRecord(s) && typeof s.at === 'number' && typeof s.takeId === 'string',
              )
            : [];
          a.comp = normalizeComp(
            segs as { at: number; takeId: string }[],
            takes,
            typeof c.length === 'number' ? c.length : 0,
          );
          if (
            a.soloTakeId !== undefined &&
            !(typeof a.soloTakeId === 'string' && takes.some((t) => t.id === a.soloTakeId))
          ) {
            delete a.soloTakeId;
          }
        }
      }
    }
  }
  for (const t of tracks) {
    const tr = t as unknown as Record<string, unknown>;
    if (tr.sends !== undefined && !Array.isArray(tr.sends)) delete tr.sends;
    if (Array.isArray(tr.sends)) {
      tr.sends = (tr.sends as unknown[]).filter(
        (s) =>
          isRecord(s) &&
          typeof s.busId === 'string' &&
          trackIds.has(s.busId) &&
          s.busId !== tr.id &&
          typeof s.amount === 'number',
      );
    }
    if (tr.monitoring !== undefined && typeof tr.monitoring !== 'boolean') delete tr.monitoring;
    if (tr.inputDeviceId !== undefined && typeof tr.inputDeviceId !== 'string') {
      delete tr.inputDeviceId;
    }
    // Inserts: drop anything malformed or of an unknown kind, and clamp every
    // surviving parameter into its spec range so a corrupt value cannot reach
    // an AudioParam.
    if (tr.effects !== undefined && !Array.isArray(tr.effects)) delete tr.effects;
    if (Array.isArray(tr.effects)) {
      tr.effects = (tr.effects as unknown[])
        .filter(
          (e) =>
            isRecord(e) &&
            typeof e.id === 'string' &&
            typeof e.kind === 'string' &&
            isKnownEffect(e.kind),
        )
        .slice(0, MAX_INSERTS)
        .map((e) => {
          const rec = e as Record<string, unknown>;
          const kind = rec.kind as EffectKind;
          return {
            id: rec.id as string,
            kind,
            bypass: rec.bypass === true,
            params: normaliseParams(kind, isRecord(rec.params) ? rec.params : undefined),
          };
        });
    }

    // --- v6 -------------------------------------------------------------
    // Unknown track kinds (a newer project opened by an older build, or a
    // hand-edited file) become plain audio tracks rather than vanishing, so
    // their clips survive.
    if (!KNOWN_TRACK_TYPES.has(tr.type as string)) tr.type = 'audio';
    clampOptionalNumber(tr, 'height', 24, 400);
    clampOptionalNumber(tr, 'inputGainDb', -48, 24);
    clampOptionalNumber(tr, 'midiChannel', 0, 16, true);
    dropUnlessBoolean(tr, 'phaseInvert');
    dropUnlessBoolean(tr, 'monoSum');
    dropUnlessBoolean(tr, 'soloSafe');
    dropUnlessBoolean(tr, 'folded');
    if (typeof tr.notes !== 'string') delete tr.notes;
    else tr.notes = (tr.notes as string).slice(0, 4000);
    if (tr.noteFx !== undefined) tr.noteFx = validateNoteFx(tr.noteFx);
    if (tr.macros !== undefined) tr.macros = validateMacros(tr.macros);
    if (!isRecord(tr.freeze) || typeof tr.freeze.mediaId !== 'string') delete tr.freeze;
  }

  // Reference integrity for the v6 grouping fields. A folder parent must be a
  // folder track, a VCA must be a VCA track, and neither may point at itself —
  // otherwise a corrupted file could hide every track or build a gain loop.
  const byId = new Map(tracks.map((t) => [t.id, t as unknown as Record<string, unknown>]));
  const folderIds = new Set(tracks.filter((t) => t.type === 'folder').map((t) => t.id));
  const vcaIds = new Set(tracks.filter((t) => t.type === 'vca').map((t) => t.id));
  for (const t of tracks) {
    const tr = t as unknown as Record<string, unknown>;
    if (typeof tr.folderId !== 'string' || !folderIds.has(tr.folderId) || tr.folderId === tr.id) {
      delete tr.folderId;
    }
    if (typeof tr.vcaId !== 'string' || !vcaIds.has(tr.vcaId) || tr.vcaId === tr.id) {
      delete tr.vcaId;
    }
    if (
      typeof tr.sidechainFrom !== 'string' ||
      !byId.has(tr.sidechainFrom) ||
      tr.sidechainFrom === tr.id
    ) {
      delete tr.sidechainFrom;
    }
  }
  // A folder cycle (A inside B inside A) would make the arrangement unpaintable.
  for (const t of tracks) {
    const tr = t as unknown as Record<string, unknown>;
    const seen = new Set<string>([t.id]);
    let cursor = tr.folderId as string | undefined;
    while (typeof cursor === 'string') {
      if (seen.has(cursor)) {
        delete tr.folderId;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.folderId as string | undefined;
    }
  }
  // Routing targets must exist and must be a summing destination.
  const busIds = new Set(
    tracks.filter((t) => t.type === 'bus' || t.type === 'fx').map((t) => t.id),
  );
  for (const t of tracks) {
    const tr = t as unknown as Record<string, unknown>;
    if (!AUDIO_TRACK_TYPES.includes(t.type)) continue;
    if (typeof tr.output !== 'string' || (tr.output !== 'master' && !busIds.has(tr.output))) {
      tr.output = 'master';
    }
  }
  // --- v2 → v3 migration: automation lanes -------------------------------
  // Additive and defensive: malformed lanes/points are dropped, values are
  // clamped and re-sorted, and a lane whose parameter no longer exists on the
  // track (deleted send or insert) is removed rather than left dangling.
  for (const t of tracks) {
    const tr = t as unknown as Record<string, unknown>;
    if (tr.automation !== undefined && !Array.isArray(tr.automation)) delete tr.automation;
    if (Array.isArray(tr.automation)) {
      const lanes = (tr.automation as unknown[])
        .map((l) => validateLane(l))
        .filter((l): l is NonNullable<ReturnType<typeof validateLane>> => l !== null)
        .filter((l) => paramIdExists(t as unknown as Track, l.paramId));
      const droppedLanes = (tr.automation as unknown[]).length - lanes.length;
      if (droppedLanes > 0) {
        diagLog(
          'warn',
          `Project "${raw.name}": dropped ${droppedLanes} invalid automation lane(s)`,
        );
      }
      if (lanes.length > 0) tr.automation = lanes;
      else delete tr.automation;
    }
    if (tr.automationMode !== undefined && !isAutomationMode(tr.automationMode)) {
      delete tr.automationMode;
    }
    if (tr.automationOpen !== undefined && typeof tr.automationOpen !== 'boolean') {
      delete tr.automationOpen;
    }
    if (tr.locked !== undefined && typeof tr.locked !== 'boolean') delete tr.locked;
    // --- v4 → v5: sampler + instrument rack ------------------------------
    if (tr.sampler !== undefined) {
      const sv = validateSampler(tr.sampler);
      if (sv) tr.sampler = sv;
      else delete tr.sampler;
    }
    if (tr.rack !== undefined) {
      const rr = tr.rack as Record<string, unknown> | null;
      const items = Array.isArray(rr?.items)
        ? (rr!.items as unknown[])
            .map((it): RackItem | null => {
              if (!isRecord(it) || typeof it.id !== 'string') return null;
              const kind = it.kind === 'sampler' ? 'sampler' : 'synth';
              const sampler = kind === 'sampler' ? validateSampler(it.sampler) : null;
              if (kind === 'sampler' && !sampler) return null;
              return {
                id: it.id,
                name: typeof it.name === 'string' ? it.name : 'Layer',
                color: typeof it.color === 'string' ? it.color : '#37b89a',
                keyLo: typeof it.keyLo === 'number' ? Math.max(0, Math.min(127, it.keyLo)) : 0,
                keyHi: typeof it.keyHi === 'number' ? Math.max(0, Math.min(127, it.keyHi)) : 127,
                muted: it.muted === true,
                solo: it.solo === true,
                kind,
                ...(kind === 'sampler'
                  ? { sampler: sampler! }
                  : isRecord(it.synth)
                    ? { synth: it.synth as unknown as RackItem['synth'] }
                    : {}),
              };
            })
            .filter((x): x is RackItem => x !== null)
        : [];
      if (items.length > 0) tr.rack = { items };
      else delete tr.rack;
    }
    if (
      tr.editGroup !== undefined &&
      !(typeof tr.editGroup === 'number' && tr.editGroup >= 1 && tr.editGroup <= 4)
    ) {
      delete tr.editGroup;
    }
  }

  const media = Array.isArray(raw.media)
    ? (raw.media as unknown[]).filter(
        (m): m is ProjectData['media'] extends (infer U)[] | undefined ? U : never =>
          isRecord(m) && typeof m.id === 'string' && typeof m.duration === 'number',
      )
    : [];
  if (typeof v === 'number' && v < SCHEMA_VERSION) {
    diagLog('info', `Migrated project "${raw.name}" from schema v${v} to v${SCHEMA_VERSION}`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    id: raw.id,
    name: raw.name,
    media,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    modifiedAt: typeof raw.modifiedAt === 'number' ? raw.modifiedAt : Date.now(),
    bpm,
    timeSig: {
      num: typeof ts.num === 'number' ? ts.num : 4,
      den: typeof ts.den === 'number' ? ts.den : 4,
    },
    loop: {
      enabled: loop.enabled === true,
      start: typeof loop.start === 'number' ? loop.start : 0,
      end: typeof loop.end === 'number' ? loop.end : 16,
    },
    metronome: raw.metronome === true,
    masterVolume: typeof raw.masterVolume === 'number' ? raw.masterVolume : 0.9,
    tracks,
    clips,
    workspace: {
      pxPerBeat: typeof ws.pxPerBeat === 'number' ? ws.pxPerBeat : 26,
      snap: typeof ws.snap === 'number' ? ws.snap : 0.25,
    },
    // The return is a fresh object, so optional fields must be carried across
    // explicitly or a save/load cycle would silently drop them.
    ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
    // --- v6 song-level structure ---
    tempoMap: normalizeTempoMap(isRecord(raw.tempoMap) ? (raw.tempoMap as never) : undefined, bpm, {
      num: typeof ts.num === 'number' ? ts.num : 4,
      den: typeof ts.den === 'number' ? ts.den : 4,
    }),
    markers: normalizeMarkers(raw.markers),
    sections: normalizeSections(raw.sections),
    chords: normalizeChords(raw.chords),
    master: validateMaster(
      raw.master,
      typeof raw.masterVolume === 'number' ? raw.masterVolume : 0.9,
    ),
    scratchPads: validateScratchPads(raw.scratchPads, trackIds),
    controlLinks: normalizeLinks(raw.controlLinks),
    grooves: normalizeGrooves(raw.grooves),
    ...(typeof raw.activePadId === 'string' ? { activePadId: raw.activePadId } : {}),
    countIn: clampNum(raw.countIn, 0, 8, 1),
    preRoll: clampNum(raw.preRoll, 0, 8, 0),
    punch: isRecord(raw.punch)
      ? {
          enabled: raw.punch.enabled === true,
          start: clampNum(raw.punch.start, 0, 1e7, 0),
          end: clampNum(raw.punch.end, 0, 1e7, 16),
        }
      : { enabled: false, start: 0, end: 16 },
    clickLevel: clampNum(raw.clickLevel, 0, 2, 0.7),
    clickRecordOnly: raw.clickRecordOnly === true,
    ...(typeof raw.artist === 'string' ? { artist: raw.artist.slice(0, 160) } : {}),
    ...(typeof raw.genre === 'string' ? { genre: raw.genre.slice(0, 80) } : {}),
    mastering: validateMastering(raw.mastering),
    show: validateShow(raw.show),
  };
}

function validateMastering(raw: unknown): ProjectData['mastering'] {
  const rec = isRecord(raw) ? raw : {};
  const items = Array.isArray(rec.items)
    ? (rec.items as unknown[])
        .filter((i) => isRecord(i) && typeof i.id === 'string' && typeof i.mediaId === 'string')
        .slice(0, 99)
        .map((i) => {
          const r = i as Record<string, unknown>;
          const m = isRecord(r.measured) ? r.measured : null;
          return {
            id: r.id as string,
            name: typeof r.name === 'string' ? r.name.slice(0, 120) : 'Untitled',
            mediaId: r.mediaId as string,
            gainDb: clampNum(r.gainDb, -24, 24, 0),
            fadeIn: clampNum(r.fadeIn, 0, 30, 0),
            fadeOut: clampNum(r.fadeOut, 0, 30, 0),
            gapAfter: clampNum(r.gapAfter, 0, 30, 2),
            ...(m
              ? {
                  measured: {
                    integratedLufs: clampNum(m.integratedLufs, -70, 10, -70),
                    loudnessRangeLu: clampNum(m.loudnessRangeLu, 0, 60, 0),
                    truePeakDbtp: clampNum(m.truePeakDbtp, -120, 20, -120),
                    samplePeakDbfs: clampNum(m.samplePeakDbfs, -120, 20, -120),
                    durationSeconds: clampNum(m.durationSeconds, 0, 36000, 0),
                    measuredAt: clampNum(m.measuredAt, 0, 1e15, 0),
                  },
                }
              : {}),
          };
        })
    : [];
  return {
    items,
    targetLufs: clampNum(rec.targetLufs, -40, 0, -14),
    ceilingDbtp: clampNum(rec.ceilingDbtp, -20, 0, -1),
    normalize: rec.normalize === true,
    ...(typeof rec.title === 'string' ? { title: rec.title.slice(0, 160) } : {}),
    ...(typeof rec.artist === 'string' ? { artist: rec.artist.slice(0, 160) } : {}),
    effects: Array.isArray(rec.effects)
      ? (rec.effects as unknown[])
          .filter(
            (e) =>
              isRecord(e) &&
              typeof e.id === 'string' &&
              typeof e.kind === 'string' &&
              isKnownEffect(e.kind),
          )
          .slice(0, MAX_INSERTS)
          .map((e) => {
            const r = e as Record<string, unknown>;
            const kind = r.kind as EffectKind;
            return {
              id: r.id as string,
              kind,
              bypass: r.bypass === true,
              params: normaliseParams(kind, isRecord(r.params) ? r.params : undefined),
            };
          })
      : [],
  };
}

function validateShow(raw: unknown): ProjectData['show'] {
  const rec = isRecord(raw) ? raw : {};
  const entries = Array.isArray(rec.entries)
    ? (rec.entries as unknown[])
        .filter((e) => isRecord(e) && typeof e.id === 'string')
        .slice(0, 200)
        .map((e) => {
          const r = e as Record<string, unknown>;
          const sig = isRecord(r.timeSig) ? r.timeSig : null;
          return {
            id: r.id as string,
            name: typeof r.name === 'string' ? r.name.slice(0, 120) : 'Song',
            ...(typeof r.projectId === 'string' ? { projectId: r.projectId } : {}),
            startBeat: clampNum(r.startBeat, 0, 1e7, 0),
            ...(typeof r.bpm === 'number' ? { bpm: clampNum(r.bpm, 20, 999, 120) } : {}),
            ...(sig
              ? {
                  timeSig: {
                    num: clampNum(sig.num, 1, 32, 4),
                    den: [1, 2, 4, 8, 16, 32].includes(Math.round(Number(sig.den)))
                      ? Number(sig.den)
                      : 4,
                  },
                }
              : {}),
            ...(typeof r.note === 'string' ? { note: r.note.slice(0, 500) } : {}),
            ...(typeof r.color === 'string' ? { color: r.color } : {}),
            ...(Array.isArray(r.armed)
              ? { armed: (r.armed as unknown[]).filter((x): x is string => typeof x === 'string') }
              : {}),
          };
        })
    : [];
  return {
    entries,
    cued: clampNum(rec.cued, 0, 199, 0),
    stageMode: rec.stageMode === true,
  };
}

// ---------------------------------------------------------------- v6 helpers

const KNOWN_TRACK_TYPES = new Set<string>([
  'audio',
  'instrument',
  'drum',
  'bus',
  'fx',
  'folder',
  'vca',
]);

const NOTE_FX_KINDS = new Set([
  'arpeggiator',
  'chorder',
  'repeater',
  'noteFilter',
  'velocityCurve',
]);

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

function clampOptionalNumber(
  rec: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  integer = false,
): void {
  const v = rec[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    delete rec[key];
    return;
  }
  const clamped = Math.min(max, Math.max(min, v));
  rec[key] = integer ? Math.round(clamped) : clamped;
}

function dropUnlessBoolean(rec: Record<string, unknown>, key: string): void {
  if (typeof rec[key] !== 'boolean') delete rec[key];
}

function validateMacros(raw: unknown): unknown {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter((m) => isRecord(m) && typeof m.id === 'string')
    .slice(0, 8)
    .map((m, i) => {
      const rec = m as Record<string, unknown>;
      return {
        id: rec.id as string,
        name: typeof rec.name === 'string' ? rec.name.slice(0, 40) : `Macro ${i + 1}`,
        value: clampNum(rec.value, 0, 1, 0),
        targets: Array.isArray(rec.targets)
          ? (rec.targets as unknown[])
              .filter((t) => isRecord(t) && typeof t.paramId === 'string')
              .slice(0, 24)
              .map((t) => {
                const r = t as Record<string, unknown>;
                return {
                  paramId: r.paramId as string,
                  from: clampNum(r.from, 0, 1, 0),
                  to: clampNum(r.to, 0, 1, 1),
                };
              })
          : [],
      };
    });
  return out.length ? out : undefined;
}

function validateNoteFx(raw: unknown): unknown {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .filter(
      (n) =>
        isRecord(n) &&
        typeof n.id === 'string' &&
        typeof n.kind === 'string' &&
        NOTE_FX_KINDS.has(n.kind),
    )
    .slice(0, 4)
    .map((n) => {
      const rec = n as Record<string, unknown>;
      const params: Record<string, number> = {};
      if (isRecord(rec.params)) {
        for (const [k, v] of Object.entries(rec.params)) {
          if (typeof v === 'number' && Number.isFinite(v)) params[k] = v;
        }
      }
      return {
        id: rec.id as string,
        kind: rec.kind as string,
        bypass: rec.bypass === true,
        params,
        ...(Array.isArray(rec.list)
          ? {
              list: (rec.list as unknown[])
                .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
                .slice(0, 24)
                .map((x) => Math.round(x)),
            }
          : {}),
      };
    });
  return out.length ? out : undefined;
}

function validateMaster(raw: unknown, fallbackVolume: number): ProjectData['master'] {
  const rec = isRecord(raw) ? raw : {};
  const effects = Array.isArray(rec.effects)
    ? (rec.effects as unknown[])
        .filter(
          (e) =>
            isRecord(e) &&
            typeof e.id === 'string' &&
            typeof e.kind === 'string' &&
            isKnownEffect(e.kind),
        )
        .slice(0, MAX_INSERTS)
        .map((e) => {
          const r = e as Record<string, unknown>;
          const kind = r.kind as EffectKind;
          return {
            id: r.id as string,
            kind,
            bypass: r.bypass === true,
            params: normaliseParams(kind, isRecord(r.params) ? r.params : undefined),
          };
        })
    : [];
  return {
    volume: clampNum(rec.volume, 0, 1.5, fallbackVolume),
    pan: clampNum(rec.pan, -1, 1, 0),
    effects,
    limiter: rec.limiter !== false,
    monoCheck: rec.monoCheck === true,
    dim: rec.dim === true,
  };
}

function validateScratchPads(raw: unknown, trackIds: Set<string>): ProjectData['scratchPads'] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .filter((p) => isRecord(p) && typeof p.id === 'string')
    .slice(0, 12)
    .map((p) => {
      const rec = p as Record<string, unknown>;
      const clips = Array.isArray(rec.clips)
        ? (rec.clips as unknown[]).filter(
            (c) =>
              isRecord(c) &&
              typeof c.id === 'string' &&
              typeof c.trackId === 'string' &&
              trackIds.has(c.trackId) &&
              typeof c.start === 'number' &&
              Number.isFinite(c.start) &&
              typeof c.length === 'number' &&
              Number.isFinite(c.length),
          )
        : [];
      return {
        id: rec.id as string,
        name: typeof rec.name === 'string' ? rec.name.slice(0, 60) : 'Pad',
        clips: clips as ProjectData['clips'],
        length: clampNum(rec.length, 1, 1e7, 32),
        createdAt: clampNum(rec.createdAt, 0, 1e15, Date.now()),
      };
    });
}

/**
 * Backups live in the projects store under a suffixed key. Every save keeps
 * the previously stored version, atomically in the same transaction, so a
 * corrupted write, a bad migration, or an interrupted save always leaves one
 * older good copy to fall back to.
 */
const BACKUP_SUFFIX = '~~backup';
export const isBackupId = (id: string): boolean => id.endsWith(BACKUP_SUFFIX);

export async function saveProject(p: ProjectData): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const getReq = store.get(p.id);
      getReq.onsuccess = () => {
        const prev = getReq.result as ProjectData | undefined;
        if (prev !== undefined) store.put({ ...prev, id: p.id + BACKUP_SUFFIX });
        store.put(p);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted (storage quota?)'));
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota/i.test(msg)) {
      diagLog('error', `Storage quota exceeded while saving "${p.name}" — project NOT saved`);
    } else {
      diagLog('error', `Save failed for "${p.name}": ${msg}`);
    }
    throw e;
  }
}

export async function loadProject(id: string): Promise<ProjectData | null> {
  const raw = await idbGet<unknown>(STORE_PROJECTS, id);
  if (raw === undefined) return null;
  return validateProject(raw);
}

/** The automatically kept previous version of a project, if any. */
export async function loadProjectBackup(id: string): Promise<ProjectData | null> {
  const raw = await idbGet<unknown>(STORE_PROJECTS, id + BACKUP_SUFFIX);
  if (raw === undefined) return null;
  const p = validateProject(raw);
  // A restored backup must save under the real id, not the backup key.
  p.id = id;
  return p;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await idbGetAll<unknown>(STORE_PROJECTS);
  const metas: ProjectMeta[] = [];
  for (const raw of all) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') continue;
    if (isBackupId(raw.id)) continue;
    metas.push({
      id: raw.id,
      name: raw.name,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      modifiedAt: typeof raw.modifiedAt === 'number' ? raw.modifiedAt : 0,
      trackCount: Array.isArray(raw.tracks) ? raw.tracks.length : 0,
      clipCount: Array.isArray(raw.clips) ? raw.clips.length : 0,
    });
  }
  metas.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return metas;
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id);
  await idbDelete(STORE_PROJECTS, id + BACKUP_SUFFIX).catch(() => {
    /* no backup to remove */
  });
}

export async function duplicateProject(id: string, newName: string): Promise<ProjectData | null> {
  const src = await loadProject(id);
  if (!src) return null;
  const copy = structuredClone(src);
  copy.id = newId('p');
  copy.name = newName;
  copy.createdAt = Date.now();
  copy.modifiedAt = Date.now();
  await saveProject(copy);
  return copy;
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const p = await idbGet<Prefs>(STORE_PREFS, 'prefs');
    return isRecord(p) ? p : {};
  } catch {
    return {};
  }
}

export async function savePrefs(patch: Partial<Prefs>): Promise<void> {
  try {
    const current = await loadPrefs();
    await idbPut(STORE_PREFS, { ...current, ...patch }, 'prefs');
  } catch (e) {
    diagLog('warn', `Prefs save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
