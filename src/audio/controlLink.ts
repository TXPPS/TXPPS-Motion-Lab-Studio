/**
 * Applying a hardware control to the product.
 *
 * The dispatch lives here rather than in the MIDI layer because a binding is
 * not a MIDI concept: the same target list should hold whatever else ever
 * sends control values. `src/audio/midi.ts` decides *what arrived*; this
 * decides *what it moves*.
 */
import {
  isPress,
  linkValue,
  matchKeys,
  sourceKey,
  type ControlLink,
  type ControlSource,
} from '../model/controlLink';
import { findAutoParam, normParam } from '../model/paramRegistry';
import { diagLog } from '../state/diagnostics';
import { useProjectStore } from '../state/projectStore';
import { engine } from './engine';
import { recording } from './recordingController';

/** The link a message should drive, preferring an exact channel over omni. */
function linkFor(links: readonly ControlLink[], source: ControlSource): ControlLink | undefined {
  const wanted = matchKeys(source);
  for (const key of wanted) {
    const found = links.find((l) => sourceKey(l.source) === key);
    if (found) return found;
  }
  return undefined;
}

/** The target's present value as 0..1, so relative and toggle modes can move it. */
function currentValue(link: ControlLink): number {
  const target = link.target;
  const project = useProjectStore.getState().project;
  if (target.kind === 'master') {
    return target.param === 'tempo'
      ? Math.min(1, Math.max(0, (project.bpm - 20) / 280))
      : Math.min(1, project.masterVolume / 1.5);
  }
  if (target.kind === 'transport') return 0;
  const track = project.tracks.find((t) => t.id === target.trackId);
  if (!track) return 0;
  if (target.kind === 'macro') {
    return track.macros?.find((m) => m.id === target.macroId)?.value ?? 0;
  }
  const param = findAutoParam(track, project, target.paramId);
  return param ? normParam(param, param.get(track)) : 0;
}

function fireTransport(command: string): void {
  const store = useProjectStore.getState();
  switch (command) {
    case 'play':
      void engine.play();
      break;
    case 'stop':
      engine.stop();
      break;
    case 'playStop':
      if (engine.isPlaying()) engine.stop();
      else void engine.play();
      break;
    case 'record':
      if (recording.isRecording) void recording.stop();
      else void recording.start();
      break;
    case 'loop':
      store.setLoop({ enabled: !store.project.loop.enabled });
      break;
    case 'metronome':
      store.setMetronome(!store.project.metronome);
      break;
    case 'rewind':
      engine.seek(Math.max(0, engine.getPositionBeats() - 4));
      break;
    case 'forward':
      engine.seek(engine.getPositionBeats() + 4);
      break;
  }
}

/**
 * Route one incoming control value. Returns true when a binding consumed it,
 * so the caller can tell a bound control from an unbound one in the log.
 */
export function applyControl(source: ControlSource, raw: number): boolean {
  const store = useProjectStore.getState();
  const links = store.project.controlLinks;
  if (!links || links.length === 0) return false;
  const link = linkFor(links, source);
  if (!link) return false;

  const target = link.target;
  if (target.kind === 'transport') {
    // A button that also sends a release would fire the command twice.
    if (!isPress(link, raw)) return true;
    fireTransport(target.command);
    return true;
  }

  const value = linkValue(link, raw, currentValue(link));
  if (target.kind === 'master') {
    if (target.param === 'tempo') store.setBpm(20 + value * 280);
    else store.setMasterVolume(value * 1.5);
    return true;
  }
  if (target.kind === 'macro') {
    store.setMacroValue(target.trackId, target.macroId, value);
    return true;
  }
  store.setParamNorm(target.trackId, target.paramId, value);
  return true;
}

/**
 * Learn mode. The next control that moves is captured instead of applied, so
 * a user assigns a knob by turning it rather than by finding its CC number.
 */
type LearnHandler = (source: ControlSource) => void;
let learnHandler: LearnHandler | null = null;

export function beginLearn(handler: LearnHandler): void {
  learnHandler = handler;
  diagLog('info', 'Control link: waiting for a control to move');
}

export function cancelLearn(): void {
  learnHandler = null;
}

export function isLearning(): boolean {
  return learnHandler !== null;
}

/** Feed a source in while learning. Returns true when it was captured. */
export function offerToLearn(source: ControlSource): boolean {
  if (!learnHandler) return false;
  const handler = learnHandler;
  learnHandler = null;
  handler(source);
  return true;
}
