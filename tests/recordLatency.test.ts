/**
 * Directive 10 §3.1 — a take lands on the grid.
 *
 * Directive 09 §2.5 closed two problems as one and got half of it wrong.
 * Monitoring latency is irreducible — delay can only be added — and that half
 * was right. Take *alignment* is a different problem with an exact answer: the
 * recorded audio arrives late by the whole round trip, and shifting it back is
 * arithmetic, not signal processing. Without it every take sits 10–30 ms behind
 * the beat and a musician who played perfectly is told they did not.
 *
 * These cases are on the arithmetic rather than on a device, because the
 * arithmetic is what decides where the clip goes. A real acoustic loopback —
 * click out of the interface, back in through a cable, transient measured
 * against the grid — needs hardware and is recorded in
 * `docs/HARDWARE_VERIFICATION.md`. It is the only part of this that a browser
 * cannot settle.
 */
import { describe, expect, it } from 'vitest';
import { recordLatencySec, takePlacement } from '../src/audio/takePlan';
import { createEmptyProject } from '../src/model/demoProject';
import type { ProjectData } from '../src/model/types';

/** 120 bpm in 4/4: one beat is exactly half a second, which keeps the sums readable. */
function project(patch: Partial<ProjectData> = {}): ProjectData {
  return { ...createEmptyProject('Latency'), bpm: 120, timeSig: { num: 4, den: 4 }, ...patch };
}

describe('what the round trip costs', () => {
  it('adds the measured output path to the user offset', () => {
    // The player hears through the graph and the device, then their sound comes
    // back through the interface. Only the first half is visible.
    expect(recordLatencySec({ base: 0.01, output: 0.02 }, 8)).toBeCloseTo(0.038, 6);
  });

  it('is the offset alone when the platform reports nothing', () => {
    // Firefox and Safari have historically reported no `outputLatency`. An
    // unmeasurable path is not a zero-latency one, so the user's figure is the
    // whole answer there rather than an addition to it.
    expect(recordLatencySec(null, 12)).toBeCloseTo(0.012, 6);
  });

  it('lets a negative offset take back an over-correction', () => {
    // An interface monitoring the player directly costs them no output latency
    // at all, so the measured figure over-corrects and the offset removes it.
    expect(recordLatencySec({ base: 0.005, output: 0.015 }, -12)).toBeCloseTo(0.008, 6);
  });

  it('never returns a negative shift', () => {
    // A clip reading before the start of its own media is not a correction, it
    // is a bug that would show up as silence at the head of every take.
    expect(recordLatencySec({ base: 0.005, output: 0.005 }, -500)).toBe(0);
  });
});

describe('where a take is placed', () => {
  const p = project();

  it('starts the clip that far into the media', () => {
    const at = takePlacement({
      project: p,
      startBeat: 8,
      durationSec: 4,
      latencySec: 0.03,
    });
    expect(at.clipStart).toBe(8);
    // The clip stays where the punch was; what moves is which sample it starts
    // from. Moving the clip instead would drag the user's punch point around.
    expect(at.offsetSec).toBeCloseTo(0.03, 6);
  });

  it('puts a transient played on the beat onto the beat', () => {
    /*
     * The case the whole feature is for, done as arithmetic.
     *
     * Capture starts at beat 8. The player hears the click for beat 8 one round
     * trip late and answers it, so their transient sits at 0.03 s into the take.
     * Reading the clip from 0.03 s puts that transient at the clip's first
     * sample, and the clip starts at beat 8 — so the transient is on beat 8.
     */
    const latencySec = 0.03;
    const transientInTakeSec = 0.03;
    const at = takePlacement({ project: p, startBeat: 8, durationSec: 4, latencySec });
    const transientBeatsFromClipStart = (transientInTakeSec - at.offsetSec) / 0.5;
    expect(at.clipStart + transientBeatsFromClipStart).toBeCloseTo(8, 9);
  });

  it('leaves the take where it is when there is nothing to correct', () => {
    const at = takePlacement({ project: p, startBeat: 8, durationSec: 4, latencySec: 0 });
    expect(at.offsetSec).toBe(0);
    expect(at.lengthBeats).toBeCloseTo(8, 6); // 4 s at 120 bpm
  });

  it('shortens the clip by what it skipped', () => {
    const none = takePlacement({ project: p, startBeat: 0, durationSec: 4, latencySec: 0 });
    const late = takePlacement({ project: p, startBeat: 0, durationSec: 4, latencySec: 0.5 });
    // Half a second skipped is one beat at 120, and the clip cannot claim to
    // hold audio it now starts after.
    expect(none.lengthBeats - late.lengthBeats).toBeCloseTo(1, 6);
  });

  it('adds the shift on top of a punch-in offset rather than replacing it', () => {
    const at = takePlacement({
      project: p,
      startBeat: 4, // rolled in a bar early
      punchWindow: { startBeat: 8, endBeat: 16 },
      durationSec: 8,
      latencySec: 0.03,
    });
    expect(at.clipStart).toBe(8);
    // Two beats of run-up is one second, plus the round trip.
    expect(at.offsetSec).toBeCloseTo(2 + 0.03, 6);
    expect(at.lengthBeats).toBeCloseTo(8, 6); // the punch window
  });

  it('does not read past the end of a take shorter than the round trip', () => {
    // A stab at the record button produces a take of a few milliseconds. Skipping
    // 30 ms into 10 ms of audio is a clip pointing outside its own media.
    const at = takePlacement({ project: p, startBeat: 0, durationSec: 0.01, latencySec: 0.03 });
    expect(at.offsetSec).toBeLessThan(0.01);
    expect(at.lengthBeats).toBeGreaterThan(0);
  });

  it('measures the remaining length from where the clip starts, across a tempo change', () => {
    // 120 for the first four bars, then 60. A take crossing that boundary is not
    // `seconds x one bpm` beats long, and the shift moves where the measuring
    // starts.
    const ramped = project({
      tempoMap: {
        tempos: [
          { id: 't0', beat: 0, bpm: 120, curve: 'jump' },
          { id: 't1', beat: 16, bpm: 60, curve: 'jump' },
        ],
        sigs: [{ id: 's0', bar: 0, num: 4, den: 4 }],
      },
    });
    const at = takePlacement({ project: ramped, startBeat: 14, durationSec: 6, latencySec: 0.03 });
    // Two beats at 120 (1 s) then the rest at 60 (1 s a beat): 1 s + 4.97 s
    // leaves 2 + 4.97 beats, not 6 x 2.
    expect(at.lengthBeats).toBeCloseTo(2 + 4.97, 2);
  });
});
