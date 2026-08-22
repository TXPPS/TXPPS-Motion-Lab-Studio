/**
 * The curated plugin shelf, and the rule about what may be loaded.
 *
 * Everything on this shelf is served from our own origin, out of
 * `public/plugins/`, and every entry carries the licence we read before
 * shipping it. That is not paperwork: several plugins in the wider WAM
 * ecosystem are Faust ports whose DSP descends from GPL library code or models
 * trademarked hardware, and the `wam-community` aggregate declares no licence
 * at all. So the rule is per-plugin and it is enforced by the type: an entry
 * without a `licence` does not compile.
 *
 * The other half of this file is the trust boundary. In this version the shelf
 * is the *only* thing that loads — `resolveSource` refuses every URL that is
 * not on it. Loading a plugin from a URL a user typed means running a
 * stranger's code with our origin's privileges (our IndexedDB, which is every
 * project and every recording; our DOM; our network) and the honest control for
 * that is a Content-Security-Policy plus a specific consent dialogue, neither
 * of which exists yet. `urlConsentCopy` below is the text that dialogue must
 * carry when it is built, kept here so the wording is reviewed as part of the
 * plugin system rather than invented at the last minute.
 *
 * See docs/THIRD-PARTY-PLUGINS.md §2.5 and §4.4.
 */
import type { Effect, PluginRef } from '../../model/types';
import { useProjectStore } from '../../state/projectStore';

/** Prefix that marks a `PluginRef.source` as a shelf entry rather than a URL. */
export const SHELF_PREFIX = 'shelf:';

export interface ShelfEntry {
  /** Stable id used in `PluginRef.source` as `shelf:<id>`. Never reused. */
  id: string;
  /** The plugin's own `descriptor.json` identifier, checked after loading. */
  identifier: string;
  name: string;
  vendor: string;
  version: string;
  /** One line for the picker. */
  blurb: string;
  /**
   * SPDX licence identifier. Required. We ship a plugin only when someone has
   * read its licence and written it down here.
   */
  licence: string;
  /** Where the licence was read from, so the claim above is checkable. */
  licenceSource: string;
  /** Path under our own origin. A directory, because a WAM locates its
   *  descriptor, worklet and assets relative to `import.meta.url`. */
  path: string;
}

/**
 * Stage 1 ships the three pure-audio effects from `burns-audio-wam`, which is
 * MIT and whose bundles carry no assets beyond a screenshot. The reverb from
 * the same collection is omitted only because it drags 18 MB of impulse
 * responses behind it, not for any licence reason.
 */
export const SHELF: readonly ShelfEntry[] = [
  {
    id: 'distortion',
    identifier: 'com.sequencerParty.simpleDistortion',
    name: 'Simple Distortion',
    vendor: 'Sequencer Party',
    version: '1.0.0',
    blurb: 'Waveshaper drive with a variable curve.',
    licence: 'MIT',
    licenceSource: 'burns-audio-wam@0.2.54 package.json "license": "MIT"',
    path: '/plugins/burns-audio/distortion/index.js',
  },
  {
    id: 'delay',
    identifier: 'com.sequencerParty.simpleDelay',
    name: 'Simple Delay',
    vendor: 'Sequencer Party',
    version: '1.0.0',
    blurb: 'Stereo filtered delay.',
    licence: 'MIT',
    licenceSource: 'burns-audio-wam@0.2.54 package.json "license": "MIT"',
    path: '/plugins/burns-audio/delay/index.js',
  },
  {
    id: 'simpleEQ',
    identifier: 'com.sequencerParty.simpleEQ',
    name: 'Simple EQ',
    vendor: 'Sequencer Party',
    version: '1.0.0',
    blurb: 'Three-band equaliser.',
    licence: 'MIT',
    licenceSource: 'burns-audio-wam@0.2.54 package.json "license": "MIT"',
    path: '/plugins/burns-audio/simpleEQ/index.js',
  },
];

export function shelfEntry(id: string): ShelfEntry | undefined {
  return SHELF.find((e) => e.id === id);
}

/** The `PluginRef.source` value for a shelf entry. */
export function shelfSource(id: string): string {
  return `${SHELF_PREFIX}${id}`;
}

/** A fresh `PluginRef` for a shelf entry, before the plugin has ever loaded. */
export function shelfPluginRef(entry: ShelfEntry): PluginRef {
  return {
    identifier: entry.identifier,
    source: shelfSource(entry.id),
    name: entry.name,
    vendor: entry.vendor,
    version: entry.version,
  };
}

export interface SourceRefusal {
  url: null;
  reason: string;
}
export interface SourceResolution {
  url: string;
  reason: null;
}

/**
 * Turn a `PluginRef.source` into a URL we are willing to import, or say why not.
 *
 * The refusal text is written to be read by a musician, not by us: "we could
 * not load it" is useless, "this build only loads plugins from its own shelf"
 * tells them whether waiting will help.
 */
export function resolveSource(source: string): SourceResolution | SourceRefusal {
  if (source.startsWith(SHELF_PREFIX)) {
    const entry = shelfEntry(source.slice(SHELF_PREFIX.length));
    if (!entry) {
      return {
        url: null,
        reason: `"${source}" is not a plugin this version of MotionLab ships. It may have come from a newer build.`,
      };
    }
    return { url: entry.path, reason: null };
  }
  // Anything with a scheme is a third-party URL, and this version does not load
  // those. Saying so plainly beats a generic failure, because the project is
  // not broken — it was made somewhere that could reach more than we can.
  return {
    url: null,
    reason:
      'This version of MotionLab only loads plugins from its own curated shelf. ' +
      `The project asks for one from ${describeOrigin(source)}, which is kept with its settings but not loaded.`,
  };
}

/**
 * The origin of a source string, in full and never truncated.
 *
 * Only an *absolute* URL gets an origin. A relative path or a malformed string
 * is handed back as it came, deliberately: `new URL` would happily resolve
 * either against our own page and report our origin, and a security message
 * that says "this plugin comes from motionlab.app" about a string it could not
 * actually parse is worse than one that shows the user the raw text and lets
 * them judge it. A URL a user cannot read is a URL a user cannot judge.
 */
export function describeOrigin(source: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return source;
  try {
    return new URL(source).origin;
  } catch {
    return source;
  }
}

/**
 * What the UI must say before it loads code from a URL the user typed.
 *
 * Not a EULA — a short, specific statement of what is actually at risk, which
 * is the user's own work. The origin is passed in and shown in full. This is
 * unused until arbitrary-URL loading ships; it lives here so that the wording
 * is part of the plugin system's review surface.
 */
export function urlConsentCopy(url: string): {
  title: string;
  origin: string;
  body: string[];
  confirmLabel: string;
  cancelLabel: string;
} {
  return {
    title: 'Load a plugin from the internet?',
    origin: describeOrigin(url),
    body: [
      url,
      "This plugin's code will run inside MotionLab with the same access MotionLab has. " +
        'It can read and change your projects and recordings, and it can send data over the internet.',
      'Only load plugins from sources you trust. We have not reviewed this one.',
    ],
    confirmLabel: 'Load plugin',
    cancelLabel: 'Cancel',
  };
}

/**
 * Put a shelf plugin in a chain, in one undoable step.
 *
 * `host.add(kind)` is how every rack adds an insert, and it is the only thing
 * that knows where a given chain's effects actually live (a track, the master,
 * the mastering chain, a clip). So we use it, then fill in the plugin reference
 * with a non-undoable follow-up write, which folds into the same undo entry:
 * one Ctrl+Z removes the whole plugin, never a slot with no plugin in it.
 */
export function addShelfPlugin(
  add: (kind: 'wam') => string | null,
  shelfId: string,
): string | null {
  const entry = shelfEntry(shelfId);
  if (!entry) return null;
  const id = add('wam');
  if (!id) return null;
  const ref = shelfPluginRef(entry);
  useProjectStore.getState().update(
    (d) => {
      const target = findEffect(d, id);
      if (target) target.plugin = ref;
    },
    { undoable: false },
  );
  return id;
}

/** Every insert chain a project owns, in one place, so a plugin can be found
 *  by id without the caller knowing which chain it landed in. */
export function allEffectChains(project: {
  tracks: { effects?: Effect[] }[];
  clips: { eventFx?: Effect[] }[];
  master?: { effects?: Effect[] };
  mastering?: { effects?: Effect[] };
}): Effect[][] {
  const out: Effect[][] = [];
  for (const t of project.tracks) if (t.effects?.length) out.push(t.effects);
  for (const c of project.clips) if (c.eventFx?.length) out.push(c.eventFx);
  if (project.master?.effects?.length) out.push(project.master.effects);
  if (project.mastering?.effects?.length) out.push(project.mastering.effects);
  return out;
}

function findEffect(
  project: Parameters<typeof allEffectChains>[0],
  effectId: string,
): Effect | undefined {
  for (const chain of allEffectChains(project)) {
    const hit = chain.find((e) => e.id === effectId);
    if (hit) return hit;
  }
  return undefined;
}
