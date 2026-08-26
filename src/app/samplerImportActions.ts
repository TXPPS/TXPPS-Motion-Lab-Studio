/**
 * Getting audio into a sampler.
 *
 * Until this file existed there was no way to put your own sample in one. The
 * four routes that looked like routes were not:
 *
 *   - a `text/x-ml-media` drop from Browser → Samples. HTML5 drag-and-drop is
 *     a mouse protocol; a finger never produces `dragstart`, so on a phone or
 *     a tablet this is not a hard route, it is no route.
 *   - tapping a row in that same tab, which does work — but it lives in a
 *     panel the sampler does not mention, loads into whichever track
 *     `useSynthTarget` picks rather than the one on screen, and is only
 *     discoverable by having already found it.
 *   - "Load demo loop", "+ Zone" and "Load 808-ish kit", all three of which
 *     load a fixed procedural sample. They put *a* sample in. They cannot put
 *     *your* sample in.
 *   - Browser → Pool → Import audio, which imports into the project and stops
 *     there. Nothing carries the result to the instrument.
 *
 * So the sampler gets its own supply, on the surface that needs it, in one
 * control: a file picker for audio that is not in the project yet, and the
 * project's own media for audio that is. Both end in a zone with a real
 * `mediaId`, which is the only state that makes an instrument sound.
 */
import { IMPORT_ACCEPT } from '../audio/importAudio';
import { makeZone, type SampleZone } from '../model/sampler';
import { useProjectStore } from '../state/projectStore';
import { useUiStore, type MenuItem } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { runImport } from './importActions';

/**
 * Where a loaded sample lands.
 *
 * Named per view rather than inferred from the sampler's current view, because
 * the pad editor loads into *its* pad while the view is `drum` and the zone
 * list appends while the view is `multi` — one destination read off the view
 * would be right in two places out of four and silently wrong in the others.
 */
export type SampleDest =
  | { kind: 'quick' }
  | { kind: 'pad'; index: number }
  | { kind: 'zone' }
  | { kind: 'replace'; zoneId: string }
  /**
   * A sampler layer inside an instrument rack — its own zone list, not the
   * track's. The rack row had no sample control of any kind, so "+ Sampler
   * layer" created a layer with `zones: []` that the engine dutifully played
   * and that could never be filled.
   */
  | { kind: 'layer'; itemId: string };

/** What a destination is called when a toast has to name it. */
function destLabel(dest: SampleDest): string {
  switch (dest.kind) {
    case 'quick':
      return 'the sampler';
    case 'pad':
      return `pad ${dest.index + 1}`;
    case 'zone':
      return 'the zone map';
    case 'replace':
      return 'this zone';
    case 'layer':
      return 'this layer';
  }
}

/** One media item as the loader needs it: an id to play and a name to show. */
export interface LoadableSample {
  id: string;
  name: string;
}

/** A track's sampler, or null — a rack track has none, and a synth track has none. */
function trackSampler(trackId: string) {
  return useProjectStore.getState().project.tracks.find((t) => t.id === trackId)?.sampler ?? null;
}

/**
 * The project's own audio, in the order a person would look for it.
 *
 * Newest first, because the file you just imported is the file you are
 * looking for. `freeze` prints are excluded for the reason Browser → Samples
 * excludes them: a frozen track's render belongs to that track, and loading it
 * into a sampler is a copy nobody asked for. `procedural` is excluded because
 * it is not the project's media, it is the app's.
 */
export function projectSamples(): LoadableSample[] {
  const media = useProjectStore.getState().project.media ?? [];
  return media
    .filter((m) => m.kind === 'import' || m.kind === 'recording')
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((m) => ({ id: m.id, name: m.name }));
}

/**
 * Put media into a sampler, and say what happened.
 *
 * Multi-file is the ordinary case rather than the exception — a picker set to
 * `multiple` is how anyone loads a kit — so every destination has an answer
 * for more than one file rather than quietly dropping all but the first.
 */
export function placeSamples(trackId: string, samples: LoadableSample[], dest: SampleDest): void {
  if (samples.length === 0) return;
  const store = useProjectStore.getState();
  const ui = useUiStore.getState();

  /**
   * Everything from `from` onward, appended as zones.
   *
   * Kept rather than discarded so the multi view can see them: an import that
   * silently loses four of five files is the kind of thing people notice much
   * later, having already thrown the files away.
   */
  const appendRest = (from: number) => {
    const rest = samples.slice(from);
    if (rest.length === 0) return;
    const zones: SampleZone[] = rest.map((s) => makeZone({ mediaId: s.id, name: s.name }));
    store.addSamplerZones(trackId, zones);
  };

  switch (dest.kind) {
    case 'quick':
    case 'replace': {
      const zones = trackSampler(trackId)?.zones ?? [];
      const target = dest.kind === 'replace' ? dest.zoneId : zones[0]?.id;
      if (target) store.setZoneSample(trackId, target, samples[0].id, samples[0].name);
      else
        store.addSamplerZones(trackId, [
          makeZone({ mediaId: samples[0].id, name: samples[0].name }),
        ]);
      appendRest(1);
      break;
    }
    case 'pad': {
      // Consecutive pads from the one that was asked for, which is what
      // loading eight one-shots into a kit is meant to do.
      samples.forEach((s, i) => store.assignPad(trackId, dest.index + i, s.id, s.name));
      break;
    }
    case 'zone': {
      appendRest(0);
      break;
    }
    case 'layer': {
      // A layer is one instrument, so a load replaces what it plays rather
      // than stacking on it — but extra files from a multi-select stay, mapped
      // across the whole range like any other zone list.
      store.rackSetLayerZones(
        trackId,
        dest.itemId,
        samples.map((s) => makeZone({ mediaId: s.id, name: s.name })),
      );
      break;
    }
  }

  const what = samples.length === 1 ? `"${samples[0].name}"` : `${samples.length} samples`;
  ui.toast('info', `${what} → ${destLabel(dest)}`);
}

/**
 * Open the file picker and load what comes back into the sampler.
 *
 * A detached input for the same reason `pickAndImport` uses one — no hidden
 * element has to live in the tree — but scoped to audio: `pickAndImport`
 * accepts `.mid` as well, and a MIDI file has nothing to become in a sampler.
 *
 * Import goes to the media library with no `trackId`, so no clip appears on
 * the timeline. Loading a sample into an instrument is not the same gesture as
 * dropping audio onto a track, and doing both would leave a clip the user has
 * to find and delete.
 */
export function pickSamplesInto(trackId: string, dest: SampleDest): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMPORT_ACCEPT;
  input.multiple = true;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.setAttribute('data-testid', 'smp-file-input');
  input.onchange = () => {
    const files = input.files ? Array.from(input.files) : [];
    input.remove();
    if (files.length === 0) return;
    void runImport(files, {}).then((results) => {
      const loaded: LoadableSample[] = results
        .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
        .map((r) => ({ id: r.mediaRef.id, name: r.mediaRef.name }));
      // `runImport` has already reported the failures. Saying nothing more is
      // right: a second toast reading "0 samples → the sampler" adds no fact.
      if (loaded.length) placeSamples(trackId, loaded, dest);
    });
  };
  document.body.appendChild(input);
  input.click();
}

/** Show the Samples tab, for the long tail this menu does not list. */
function openSampleBrowser(): void {
  useWorkspaceStore.getState().reveal('browser');
  useUiStore.getState().set({ browserTab: 'samples' });
}

/**
 * How many of the project's own samples a menu lists before it stops.
 *
 * A menu is not a browser. Past a dozen rows it is worse than the browser at
 * being one — it does not search, filter or preview — so it lists the recent
 * ones and hands the rest over rather than growing to two hundred entries in a
 * fixed-position overlay.
 */
const MENU_SAMPLE_LIMIT = 12;

/**
 * Every route to a sample, from one control.
 *
 * The menu *is* the affordance rather than a shortcut to it, for the reason
 * the device rack's overflow menu is: it is one target that can be made 44 pt
 * on every form factor, and every command inside it is a full-width row that
 * can be too. A row of small inline buttons would be the same reachability
 * defect one panel over.
 */
export function sampleSourceItems(trackId: string, dest: SampleDest): MenuItem[] {
  const own = projectSamples();
  const items: MenuItem[] = [
    {
      label: 'Import audio file…',
      testId: 'smp-import-file',
      action: () => pickSamplesInto(trackId, dest),
    },
  ];

  if (own.length === 0) {
    items.push({
      label: 'No imported audio in this project yet',
      disabled: true,
      action: () => {},
    });
  } else {
    for (const s of own.slice(0, MENU_SAMPLE_LIMIT)) {
      items.push({
        label: s.name,
        testId: `smp-project-media-${s.id}`,
        action: () => placeSamples(trackId, [s], dest),
      });
    }
  }

  items.push({
    label:
      own.length > MENU_SAMPLE_LIMIT
        ? `Browse all samples… (${own.length} in project)`
        : 'Browse all samples…',
    testId: 'smp-browse-samples',
    action: openSampleBrowser,
  });
  return items;
}

/** Open that menu under a control, given the control's box. */
export function openSampleSourceMenu(
  trackId: string,
  dest: SampleDest,
  x: number,
  y: number,
): void {
  useUiStore.getState().showMenu({ x, y, items: sampleSourceItems(trackId, dest) });
}
