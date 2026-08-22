/**
 * Track freeze — the render half.
 *
 * "Freeze" prints one instrument track to audio and plays the print instead of
 * running the instrument, which is what buys the CPU back: a frozen track
 * builds no instrument and schedules no notes anywhere — not live, not in a
 * bounce. `model/freeze.ts` holds the data model and the picture of what is
 * printed and what stays live.
 *
 * The print is made by the ordinary offline renderer over a project containing
 * that track alone, so it goes through the same insert chains, the same note
 * pipeline and the same clip scheduling a bounce does. There is no second
 * renderer here to drift from the first — this module only decides what to
 * hand it and where to put what comes back.
 *
 * The bytes are stored as 24-bit WAV: a print is played back through the
 * browser's own decoder like any other media, so it has to be a real file, and
 * 24 bits puts the quantiser's error near -144 dBFS — inaudible, and far below
 * anything the mix will do to it afterwards. What gets cached for playback is
 * the decoded file rather than the render that produced it, so a freeze sounds
 * the same the moment it is made as it does after a reload.
 */
import { newId } from '../model/ids';
import { freezeRefusal, freezeRenderProject, isFrozen, trackEndBeat } from '../model/freeze';
import { usedMediaIds, type MediaRef } from '../model/media';
import { putMediaBlob } from '../persistence/mediaStore';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { encodeAudio } from './encode';
import { engine } from './engine';
import { getBufferSync, loadBuffer } from './mediaLibrary';
import { DEFAULT_TAIL_SECONDS, preRollForProject, renderProject } from './exportMix';

/** Freezing is not instant; a second press must not start a second render. */
const running = new Set<string>();

/**
 * Print a track and switch it over to the print.
 *
 * Returns false — with a toast saying why — when there is nothing to print or
 * the render fails. A failure never changes the project: an unfrozen track is
 * a working track, and half a freeze is not.
 */
export async function freezeTrack(trackId: string): Promise<boolean> {
  const toast = useUiStore.getState().toast;
  const project = useProjectStore.getState().project;
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return false;
  if (isFrozen(track)) return true;
  if (running.has(trackId)) {
    toast('error', `"${track.name}" is already being frozen.`);
    return false;
  }
  const refusal = freezeRefusal(project, track);
  if (refusal) {
    toast('error', refusal);
    return false;
  }

  running.add(trackId);
  try {
    await engine.start().catch(() => false);
    const decodeCtx: BaseAudioContext = engine.context ?? new OfflineAudioContext(1, 1, 44100);
    const copy = freezeRenderProject(project, track);
    // Sampler zones, and any audio on a channel that keys this one, have to be
    // decoded before the graph is built, because that build is synchronous.
    for (const id of usedMediaIds(copy)) {
      if (!getBufferSync(id)) await loadBuffer(id, decodeCtx);
    }

    const result = await renderProject(copy, {
      range: { startBeat: 0, endBeat: trackEndBeat(project, trackId) },
      sampleRate: engine.context?.sampleRate ?? 44100,
      // The last note's release and the inserts' tails belong to the track, so
      // the print holds them rather than stopping at the final note-off.
      tailSeconds: Math.max(
        preRollForProject(copy),
        (track.synth?.release ?? 0) + DEFAULT_TAIL_SECONDS,
      ),
      // The master chain is applied to the print on the way out, so baking it
      // in would apply it twice — and would bake the safety limiter's own
      // latency in with it.
      bypassMaster: true,
    });

    const channels: Float32Array[] = [];
    for (let c = 0; c < result.buffer.numberOfChannels; c++) {
      channels.push(result.buffer.getChannelData(c));
    }
    const encoded = encodeAudio(channels, {
      format: 'wav',
      sampleRate: result.sampleRate,
      bitDepth: 24,
      metadata: { title: `${track.name} (frozen)`, software: 'TXPPS MotionLab Studio' },
    });

    const mediaId = newId('freeze');
    await putMediaBlob(mediaId, encoded.blob, encoded.mime);
    const decoded = await loadBuffer(mediaId, decodeCtx);
    if (!decoded) throw new Error('the print could not be read back');

    const ref: MediaRef = {
      id: mediaId,
      name: `${track.name} (frozen)`,
      kind: 'freeze',
      mimeType: encoded.mime,
      duration: result.durationSec,
      sampleRate: result.sampleRate,
      channels: result.channels,
      byteSize: encoded.bytes,
      createdAt: Date.now(),
      source: `Freeze of ${track.name}`,
      peaksVersion: 0,
    };

    useProjectStore.getState().update((d) => {
      const t = d.tracks.find((x) => x.id === trackId);
      if (!t) return;
      t.freeze = { mediaId, renderedAt: Date.now() };
      if (!d.media) d.media = [];
      d.media.push(ref);
    });

    diagLog(
      'info',
      `Froze "${track.name}": ${result.durationSec.toFixed(1)}s, ` +
        `${(encoded.bytes / 1048576).toFixed(1)} MB`,
    );
    toast('info', `Froze "${track.name}" — its instrument is no longer running.`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diagLog('error', `Freeze failed for ${trackId}: ${msg}`);
    toast('error', `Could not freeze "${track.name}": ${msg}`);
    return false;
  } finally {
    running.delete(trackId);
  }
}

/**
 * Give the instrument back.
 *
 * The print stops being referenced, and the engine drops its decoded copy on
 * the next graph sync — which is the memory that matters (~10 MB a stereo
 * minute). The stored bytes stay on disk for the same reason nothing else here deletes audio behind the user's
 * back: undo has to be able to bring the freeze back, and the pool already
 * offers a cleanup that says exactly what it is about to remove.
 */
export function unfreezeTrack(trackId: string): void {
  const before = useProjectStore.getState().project;
  const track = before.tracks.find((t) => t.id === trackId);
  if (!track?.freeze) return;
  const mediaId = track.freeze.mediaId;
  useProjectStore.getState().update((d) => {
    const t = d.tracks.find((x) => x.id === trackId);
    if (t) delete t.freeze;
    // A duplicated track carries its original's print; the record only goes
    // when the last track playing it lets go.
    if (d.media && !d.tracks.some((x) => x.freeze?.mediaId === mediaId)) {
      d.media = d.media.filter((m) => m.id !== mediaId);
    }
  });
  diagLog('info', `Unfroze "${track.name}"`);
  useUiStore.getState().toast('info', `Unfroze "${track.name}" — the instrument is back.`);
}
