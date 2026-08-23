// Motion Wave — a drawn shape, evaluated per sample.
//
// The Motion Shaper's modulator is a curve the user draws: an ordered list of
// breakpoints with a segment shape between each pair. `fx-01` §4.2 is explicit
// that it must be evaluated analytically per sample rather than rasterised into
// a wavetable, and the reasoning is worth keeping next to the code because the
// wavetable is the obvious implementation and it is wrong three ways over:
//
//  - A table forces a resolution choice, and every choice steps. Per-sample
//    evaluation has no resolution at all; it is exact to float precision.
//  - It is *cheaper*, not dearer. A segment is one `pow` at worst — and two
//    multiplies when the tension snaps to a whole power — against a table read,
//    an interpolation, and the memory traffic of one table per band per slot.
//  - Segment transitions are detected exactly, which is what the anti-click
//    handling needs in order to know that a discontinuity happened at all.
//
// The stepping that remains is not resolution. It is that the curve is
// *legitimately* discontinuous at a `step` breakpoint and at the loop wrap, and
// that is handled where the gain is applied rather than here.
#pragma once

#include <cmath>
#include <cstddef>

namespace mw::dsp {

/// How the curve travels from one breakpoint to the next.
enum class SegmentShape {
  /// Straight.
  Line,
  /// `u^p` — accelerating or decelerating, depending on the tension's sign.
  Arc,
  /// Eased at both ends, steep in the middle, or the reverse.
  SCurve,
  /// Holds the start value for the whole segment. The only intentionally
  /// discontinuous shape, and the reason the anti-click floor exists.
  Step,
};

/// One point of a drawn curve, and the shape of the segment leaving it.
struct Breakpoint {
  /// Position in the LFO period, in [0, 1).
  double x = 0.0;
  /// Value at that position, in [0, 1].
  double y = 0.0;
  SegmentShape shape = SegmentShape::Line;
  /// −1 … +1. Mirror-symmetric about the diagonal, so the slider feels linear.
  double tension = 0.0;
};

/// The most breakpoints one curve may hold.
///
/// A fixed cap rather than a growable list, because the curve is read on the
/// audio thread and a `std::vector` that reallocated while the modulator was
/// reading it would be exactly the kind of failure the no-allocation rule
/// exists to prevent. 64 is far past what anyone draws by hand.
inline constexpr std::size_t kMaxBreakpoints = 64;

/**
 * Shape the normalised position `u` within one segment.
 *
 * `p = 2^(3t)` maps tension −1…+1 onto 1/8…8, chosen so `t` and `−t` are mirror
 * images about the diagonal: that symmetry is what makes dragging a tension
 * handle feel linear rather than sluggish at one end and violent at the other.
 */
inline double shapeSegment(double u, SegmentShape shape, double tension) noexcept {
  if (u <= 0.0) return 0.0;
  if (u >= 1.0) return shape == SegmentShape::Step ? 0.0 : 1.0;
  switch (shape) {
    case SegmentShape::Step:
      return 0.0;
    case SegmentShape::Line:
      return u;
    case SegmentShape::Arc: {
      const double p = std::exp2(3.0 * tension);
      return std::pow(u, p);
    }
    case SegmentShape::SCurve: {
      const double p = std::exp2(3.0 * tension);
      return u < 0.5 ? 0.5 * std::pow(2.0 * u, p) : 1.0 - 0.5 * std::pow(2.0 * (1.0 - u), p);
    }
  }
  return u;
}

/**
 * A drawn curve, evaluated at a phase.
 *
 * Holds a cursor to the segment the phase was last in, so the common case —
 * phase advancing a little — costs a comparison rather than a search. The
 * cursor is a cache and never the truth: `valueAt` finds the right segment
 * however far the phase jumped, because a transport locate moves it arbitrarily
 * and a modulator that assumed monotonic advance would be wrong for exactly one
 * block after every seek, which is the kind of bug that reads as "it glitches
 * sometimes".
 */
class Curve {
 public:
  /// A flat curve at `y`. The neutral shape a bypassed slot uses.
  void setFlat(double y) noexcept {
    count_ = 1;
    points_[0] = Breakpoint{0.0, y, SegmentShape::Line, 0.0};
    cursor_ = 0;
  }

  /// Replace the curve. Off the audio thread — this is a parameter change.
  void set(const Breakpoint* points, std::size_t count) noexcept {
    count_ = count > kMaxBreakpoints ? kMaxBreakpoints : count;
    for (std::size_t i = 0; i < count_; ++i) points_[i] = points[i];
    cursor_ = 0;
  }

  std::size_t count() const noexcept { return count_; }
  const Breakpoint& point(std::size_t i) const noexcept { return points_[i]; }

  /**
   * Value at phase `phi` in [0, 1).
   *
   * The curve wraps: the last point's segment runs to the first point at x = 1,
   * so a shape drawn once tiles seamlessly however many periods pass.
   */
  double valueAt(double phi) const noexcept {
    if (count_ == 0) return 0.0;
    if (count_ == 1) return points_[0].y;
    const double x = phi - std::floor(phi);

    const std::size_t i = segmentAt(x);
    const std::size_t j = (i + 1) % count_;
    const Breakpoint& a = points_[i];
    const Breakpoint& b = points_[j];

    // The wrapping segment's end is at x = 1, not at the first point's x.
    const double endX = (j == 0) ? 1.0 : b.x;
    const double span = endX - a.x;
    // A zero-width segment is a legal thing to draw — two points dropped on the
    // same position — and dividing by it would produce NaN for the rest of the
    // session. Its value is its start, which is what a zero-width segment means.
    if (span <= 0.0) return a.y;

    const double u = (x - a.x) / span;
    return a.y + (b.y - a.y) * shapeSegment(u, a.shape, a.tension);
  }

  /**
   * True when the curve is discontinuous at the boundary the phase just
   * crossed, so the gain path knows to reach for its anti-click floor rather
   * than tracking a jump it cannot follow.
   */
  bool isStepBoundary(std::size_t segment) const noexcept {
    return segment < count_ && points_[segment].shape == SegmentShape::Step;
  }

  /// Which segment a phase falls in. Public so the caller can ask what changed.
  std::size_t segmentAt(double x) const noexcept {
    // Linear scan from the cached cursor, wrapping once. At most `count_`
    // comparisons in the worst case and one in the common case, with no branch
    // on whether the phase moved forward — which is what makes it correct
    // across a locate.
    for (std::size_t step = 0; step < count_; ++step) {
      const std::size_t i = (cursor_ + step) % count_;
      const std::size_t j = (i + 1) % count_;
      const double startX = points_[i].x;
      const double endX = (j == 0) ? 1.0 : points_[j].x;
      if (x >= startX && x < endX) {
        cursor_ = i;
        return i;
      }
    }
    // Before the first breakpoint: that region belongs to the wrapping segment.
    cursor_ = count_ - 1;
    return cursor_;
  }

 private:
  Breakpoint points_[kMaxBreakpoints];
  std::size_t count_ = 0;
  /// Mutable because it is a cache, and asking a curve for a value is a const
  /// question however the lookup is accelerated.
  mutable std::size_t cursor_ = 0;
};

}  // namespace mw::dsp
