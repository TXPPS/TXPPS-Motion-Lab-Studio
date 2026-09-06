/**
 * Motion Wave — what the dev panel plays at each unit, and what it sets first.
 *
 * Split out of `panel.ts` at the four-hundred line rule. Two tables, both
 * per unit, both explained in place: the stimulus a unit's mechanism responds
 * to, and the controls a unit needs off their defaults before its mechanism
 * does anything a panel could show.
 */
import { ConsoleEqParam } from '../units/console_eq/params.gen';
import { OpticalLevellerParam } from '../units/optical_leveller/params.gen';
import { FetLimiterParam } from '../units/fet_limiter/params.gen';
import { VariableMuParam } from '../units/variable_mu/params.gen';
import { GranularDelayParam } from '../units/granular_delay/params.gen';

/**
 * What to play at each unit, and why it is not one tone for all of them.
 *
 * The Motion Shaper's claim is about a modulator, so a steady tone is right —
 * what moves is the shaping. The Program EQ's is about iron, and a transformer
 * follows *flux*: at 1 kHz the core barely moves whatever the level, so a
 * kilohertz probe would leave its panel still and V27 would be measuring the
 * stimulus rather than the unit. 40 Hz is where `dyn-01` §7's thickening lives.
 */
export interface Stimulus {
  hz: number;
  /**
   * Rate of an amplitude envelope, in Hz, or 0 for a steady tone.
   *
   * A steady tone cannot reveal a leveller. Its detector settles within its
   * attack and then every block publishes the same gain reduction, so the panel
   * shows one number forever and `V27` fails for a unit whose animation is
   * perfectly correct. What a compressor's face has to show is its *time*
   * behaviour — an optical cell's exposure history, a FET's recovery, a valve's
   * bias storage — and time behaviour is invisible under a signal that has none.
   *
   * So the dynamics units get programme rather than a tone: the same sine under
   * a slow envelope, which is the smallest stimulus their mechanism responds to.
   * This is the same argument as `dyn-01`'s 40 Hz and not a different one — a
   * probe that leaves the mechanism still measures the probe.
   */
  envelopeHz?: number;
}

export const STIMULUS: Record<string, Stimulus> = {
  // A modulator, so the shaping is what moves. Steady is right.
  'fx-01': { hz: 1000 },
  // Iron follows flux, and at 1 kHz the core barely moves whatever the level.
  'dyn-01': { hz: 40 },
  // Levellers, limiters and valves: what they show is what they do over time.
  'dyn-02': { hz: 220, envelopeHz: 1.7 },
  'dyn-03': { hz: 220, envelopeHz: 3.1 },
  'dyn-04': { hz: 220, envelopeHz: 1.3 },
  // An equaliser is not time-varying, but its meters are: an envelope is what
  // puts anything at all on the input and output readouts.
  'dyn-05': { hz: 220, envelopeHz: 2.3 },
  // Grains are spawned against the incoming signal, so the population moves
  // with it.
  'fx-02': { hz: 440, envelopeHz: 0.9 },
  // The loop meter and the duck follow the programme; the transport wobbles
  // on its own, which is what the pitch-ratio readout shows.
  'fx-03': { hz: 330, envelopeHz: 0.7 },
};

/**
 * Controls a unit needs off their defaults before its mechanism does anything.
 *
 * The Console EQ is the case that made this necessary and it is not a special
 * case. Its `V27` readout is the EQ section's inductor core, and an inductor
 * carries the *network's* current — with every band at zero the network is out
 * of circuit and the core is correctly still. Measuring a flat equaliser and
 * reporting that nothing moves would be measuring the stimulus again, which is
 * the same error as probing a transformer at a kilohertz.
 *
 * Sent as parameter messages through the port the app uses, not by reaching
 * into the unit: a state a user cannot get the unit into is not a state worth
 * measuring a panel in.
 */
export const SETUP: Record<string, { id: number; value: number }[]> = {
  // Peak Reduction defaults to zero, which is a leveller with the cell dark.
  // The panel read exposure 0 and 0.06 dB of gain reduction, and that is the
  // unit behaving correctly under a control nobody had turned.
  'dyn-02': [{ id: OpticalLevellerParam.PeakReduction, value: 0.7 }],
  // The opposite problem: at unity input this limiter sat 17.9 dB into
  // limiting, where the detector is pinned and nothing moves. Backed off so it
  // rides the envelope instead of flattening it — which is where a limiter's
  // mechanism is visible and also where anybody would actually use one.
  'dyn-03': [{ id: FetLimiterParam.Input, value: -16 }],
  // Threshold defaults to its maximum and input to zero, so the valve was
  // barely biased: 0.58 dB of reduction and a bias store that never charged.
  'dyn-04': [
    { id: VariableMuParam.InputA, value: 12 },
    { id: VariableMuParam.InputB, value: 12 },
    { id: VariableMuParam.ThresholdA, value: 3 },
    { id: VariableMuParam.ThresholdB, value: 3 },
  ],
  'dyn-05': [
    { id: ConsoleEqParam.EqIn, value: 1 },
    { id: ConsoleEqParam.LowFrequency, value: 0 },
    { id: ConsoleEqParam.LowAmount, value: 12 },
  ],
  // Vintage wear, so the transport's wobble is a wobble the readout shows
  // rather than the Studio default's barely-there one; and enough feedback
  // and mix for the loop meter to have a loop in it.
  'fx-03': [
    // The medium's C++ default is Clean; the manifest's default of Tape is
    // what the app writes at insert, and this page writes only what is here.
    // Wear acts on tape, so tape has to be asked for first.
    { id: GranularDelayParam.Character, value: 1 },
    { id: GranularDelayParam.Wear, value: 2 },
    { id: GranularDelayParam.Feedback, value: 55 },
    { id: GranularDelayParam.Mix, value: 60 },
  ],
};
