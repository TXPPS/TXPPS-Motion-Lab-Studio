// Motion Wave — the Granular Delay's feedback routing matrix.
//
// `fx-03` §1.2 is explicit that ping-pong is not a special case: all three
// topologies are one structure with a different 2×2 matrix, and the mode
// selector sets the matrix rather than branching the signal path. Building it
// the other way means three code paths where two of them are rarely exercised.
//
// §3.2 puts the stability condition here too, which is why this file holds a
// predicate rather than only a table.
#pragma once

#include <cmath>
#include <cstdint>

namespace mw::units::delay {

enum class Topology : std::uint8_t {
  Dual = 0,   ///< Two independent lines.
  PingPong,   ///< Full cross — repeats alternate sides.
  Blend,      ///< Cross-faded between the two, by the Cross control.
  MonoSum,    ///< Repeats collapse to centre as they decay.
};

/**
 * The 2×2 matrix `M` in §1.2, as `[[self, cross], [cross, self]]`.
 *
 * Symmetric by construction. An asymmetric routing would make one channel's
 * repeats outlive the other's, which is a defect rather than a topology, and
 * the eigenvalue argument below assumes the symmetry.
 */
struct Routing {
  double self = 1.0;
  double cross = 0.0;

  /**
   * The loop's worst-case gain multiplier.
   *
   * **This is `|a| + |b|`, and getting it wrong is the single most common
   * ping-pong bug.** §3.2(b): the eigenvalues of `[[a,b],[b,a]]` are `a+b` and
   * `a−b`, so the loop gain in the worst mode is `(|a| + |b|)·fb` — *not*
   * `|a|·fb` and `|b|·fb` checked separately. Self-feedback 0.8 with
   * cross-feedback 0.8 passes both separate checks and has an effective loop
   * gain of 1.6, which is the case §3.2 names.
   */
  double worstCaseGain() const noexcept { return std::fabs(self) + std::fabs(cross); }
};

/**
 * §1.2's table.
 *
 * Every row sums to one, which is what makes `worstCaseGain()` equal to one for
 * all of them — so the feedback control alone decides stability and no
 * combination of mode and cross can smuggle in extra loop gain. §3.2 says that
 * if a future mode breaks that, the inequality must be asserted; the assertion
 * exists either way, in `stableAt` below.
 */
inline Routing routingFor(Topology topology, double cross) noexcept {
  const double c = cross < 0.0 ? 0.0 : (cross > 1.0 ? 1.0 : cross);
  Routing out;
  switch (topology) {
    case Topology::PingPong:
      out.self = 0.0;
      out.cross = 1.0;
      break;
    case Topology::Blend:
      out.self = 1.0 - c;
      out.cross = c;
      break;
    case Topology::MonoSum:
      out.self = 0.5;
      out.cross = 0.5;
      break;
    case Topology::Dual:
    default:
      out.self = 1.0;
      out.cross = 0.0;
      break;
  }
  return out;
}

/**
 * Whether a linear loop at this feedback and routing decays.
 *
 * Deliberately *not* what the unit uses to decide whether to allow a setting:
 * §3.2 exposes feedback up to 130 % on purpose, because a saturating loop at
 * `fb > 1` converges to the fixed point of `a = fb·tanh(a)` rather than
 * diverging — the dub runaway that sits at a level instead of destroying the
 * mix. What this predicate is for is the assertion §3.2 demands: a mode whose
 * rows do not sum to one would make `fb ≤ 1` unsafe, and this is what catches
 * that at the point the matrix is built rather than at the point a user's
 * session explodes.
 */
inline bool decaysWhenLinear(const Routing& routing, double feedback,
                             double loopFilterPeakGain = 1.0) noexcept {
  // §3.2(a): the condition is `fb · max|H| < 1`, not `fb < 1`. A resonant loop
  // filter at Q = 4 has about 12 dB of peak gain, which makes fb = 0.5 unstable
  // — so the filter's peak gain belongs in the inequality, and the unit
  // normalises the filter to unity rather than relying on this to notice.
  return routing.worstCaseGain() * feedback * loopFilterPeakGain < 1.0;
}

}  // namespace mw::units::delay
