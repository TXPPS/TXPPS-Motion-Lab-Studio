// Motion Wave — the modulation matrix shared by the sampler and the five
// synthesizers. `syn-05` §9 (capacity, amount law, editing protocol) and
// `smp-01` §6.1, §6.6 (a consumer's own lists and capacities; summation).
//
// One matrix, not six. `smp-01` §6.1 says "do not build a second one", and the
// reason is the ledger's: the routing budget, the amount law, the summation
// rule and the two capacity limits are one specification, and five copies of
// it would be five places for the clamp to drift in front of the sum.
//
// What it is. A flat list of routings — source, destination, signed amount,
// quantise flag — with the two hard limits enforced where the sheet says they
// must be, at the model layer, with a result value. A routing beyond the
// budget and an (n+1)th source on one destination are REFUSED and the matrix
// is left exactly as it was. `syn-05` §9.6 records that the matrix instrument
// refuses silently and that this is the single most complained-about aspect
// of programming it, so every mutator here returns a `RoutingResult`, and the
// counts a display shows permanently ("17 / 20 routings, 4 / 6 on this
// destination") are read straight off the model rather than kept beside it.
//
// What it computes. At every grid point (`voice/mod_grid.h`), for each
// destination, the sum over its contributors of `amount × source × fullScale`
// in the destination's own unit, clamped to the destination's declared range
// **after** summing — `smp-01` §6.6: two large opposing modulations cancel
// rather than each clamping first. Pitch destinations therefore sum in
// semitones and the consumer exponentiates once; level destinations sum in
// decibels. The matrix knows nothing about what a unit *is*; it knows how many
// of them a full-scale routing produces and where the destination's range
// ends, and a destination that is itself a generator parameter — an LFO's
// rate, an envelope's attack — is an index like any other, which is the
// property `syn-05` §1.2 says separates a matrix from a fixed routing list.
//
// Storage is fixed maxima: not an arena, not the heap, not sized at
// `prepare()`. The two matrices that exist are 20 routings over 47
// destinations and 16 over 34, and the whole table is under two kilobytes, so
// sizing it at run time would buy a heap pointer and nothing else. What fixed
// storage buys is a trivially copyable value: an edited routing table reaches
// the audio thread as one block copy swapped at a block boundary, with no
// allocation in the swap. So this type allocates nowhere — not merely "not
// after prepare" — and `mod_matrix_tests.cpp` arms `RtGuard` around the edits
// as well as the evaluation. `prepare()` checks a consumer's capacities
// against the maxima and refuses a configuration that exceeds them rather
// than clamping it, because a matrix that quietly held fewer routings than
// the instrument's sheet promised would refuse a routing the display said
// there was room for — the silent failure again, one layer down.
#pragma once

#include <cmath>
#include <cstdint>

#include "../voice/mod_grid.h"

namespace mw::dsp::mod {

/// A source is an index into the substrate's `ModFrame`, so its bound is the
/// frame's: the matrix instrument has twenty-seven sources and the sampler
/// twenty-four, and the frame holds thirty-two.
inline constexpr int kMaxSources = voice::kMaxModSources;

/// Forty-seven is the largest destination list any sheet declares (`syn-05`
/// §9.4, [C]); sixty-four leaves it the headroom the frame gives sources.
inline constexpr int kMaxDestinations = 64;

/// Twenty is the largest routing budget any sheet declares (`syn-05` §9.1);
/// thirty-two leaves room for a consumer that wants more without a rebuild.
inline constexpr int kMaxRoutings = 32;

/// A consumer's capacities. The sheets' numbers are the consumer's to state —
/// 27 / 47 / 20 / 6 for the matrix synth, 24 / 34 / 16 / 6 for the sampler —
/// and are not baked in here: the per-destination limit is [I] in `syn-05`
/// §9.1 and the sampler's budget is [I] in `smp-01` §6.1, and a default that
/// matched either sheet would be that unconfirmed value travelling under a
/// different name. The defaults are the storage maxima, which no sheet claims.
struct MatrixConfig {
  int sources = kMaxSources;
  int destinations = kMaxDestinations;
  int maxRoutings = kMaxRoutings;
  int maxSourcesPerDestination = kMaxRoutings;
};

/// What a destination's unit is worth, and where its range ends.
///
/// `fullScale` is how many native units a routing at amount +1 produces from
/// a source at +1 — 48 for a pitch destination in semitones with a ±48 bend
/// range, 1 for a normalised level. `minimum` and `maximum` bound the *sum*,
/// in the same unit; a contribution is never clamped on its own, because that
/// is the mutation `smp-01` §6.6 forbids. (Not `min`/`max`: a platform shell
/// may include this after a header that defines those as macros.)
///
/// A quantised routing rounds its contribution to integer steps of this unit.
/// `syn-05` §9.2 confirms the flag and leaves the grid [U], so **one native
/// unit per step is a choice**, made here once: it is what "integer steps of
/// the destination's own unit" says when read literally, and it makes the
/// consumer's declaration of the unit — semitones, cents, decibels — also its
/// declaration of the grid, with nothing to keep in agreement.
struct DestinationSpec {
  float fullScale = 1.0f;
  float minimum = -1.0f;
  float maximum = 1.0f;
};

/// One routing. `amount` is bipolar, −1..+1, linear in the destination's
/// native unit (`smp-01` §6.1; `syn-05` §9.2's ±63 scaled to ±1 — the linear
/// law is [U] there and is the choice both sheets make, pending test 11.5).
/// An amount of zero with either sign is off — §9.2 says an editor should
/// collapse the two — so a negative zero is stored as a positive one and the
/// two evaluate to the same bits. Two routings may carry the same source to
/// the same destination; they simply sum, as the hardware's would.
struct Routing {
  int source = 0;
  int destination = 0;
  float amount = 0.0f;
  bool quantise = false;
};

/// Why a mutator did or did not do what it was asked. A refusal is never
/// `Ok`: silent refusal is the failure `syn-05` §9.6 names, and a refusal
/// whose reason nobody can read is the same failure with a return value.
enum class RoutingResult : std::uint8_t {
  Ok,
  /// The budget is spent: `routingCount() == maxRoutings()`.
  MatrixFull,
  /// That destination already has `maxSourcesPerDestination()` contributors.
  DestinationFull,
  /// A source index outside `0 .. sources() − 1`.
  BadSource,
  /// A destination index outside `0 .. destinations() − 1`.
  BadDestination,
  /// A routing index outside `0 .. routingCount() − 1`.
  BadRouting,
  /// An amount that is not a number. Accepted, it would poison every sum on
  /// its destination and nothing downstream would say where the NaN came from.
  BadAmount,
  /// `prepare()` has not accepted a configuration.
  NotPrepared,
};

/**
 * The matrix: a routing table, the specs of its destinations, and one
 * evaluation.
 *
 * Trivially copyable and never allocating, so a consumer edits a copy off the
 * audio thread and swaps it in at a block boundary, or applies the edits on
 * the audio thread through its own message queue — both are legal here, and
 * which one is the consumer's call. A routing index is a *position*: removing
 * a routing shifts the ones above it down so the table stays dense and the
 * evaluation stays one straight loop, and a display re-reads after a removal.
 */
class ModMatrix {
 public:
  /// Accepts a consumer's capacities, or refuses them. See the header comment
  /// for why refusing beats clamping. Refusal leaves the matrix unprepared,
  /// so every mutator answers `NotPrepared` until a configuration is accepted.
  bool prepare(const MatrixConfig& config) noexcept {
    const bool fits = config.sources >= 1 && config.sources <= kMaxSources &&
                      config.destinations >= 1 && config.destinations <= kMaxDestinations &&
                      config.maxRoutings >= 1 && config.maxRoutings <= kMaxRoutings &&
                      config.maxSourcesPerDestination >= 1;
    prepared_ = fits;
    if (!fits) return false;
    config_ = config;
    for (int d = 0; d < kMaxDestinations; ++d) specs_[d] = DestinationSpec{};
    clear();
    return true;
  }

  /// Every routing gone; the destination specs stay. What an init patch wants.
  void clear() noexcept {
    count_ = 0;
    for (int d = 0; d < kMaxDestinations; ++d) contributors_[d] = 0;
  }

  /// Declares a destination's unit and range. In force from the next
  /// evaluation; existing routings into it are unaffected.
  RoutingResult setDestination(int d, const DestinationSpec& spec) noexcept {
    if (!prepared_) return RoutingResult::NotPrepared;
    if (d < 0 || d >= config_.destinations) return RoutingResult::BadDestination;
    specs_[d] = spec;
    return RoutingResult::Ok;
  }

  const DestinationSpec& destinationSpec(int d) const noexcept { return specs_[d]; }

  // ------------------------------------------------------------- editing

  /// `syn-05` §9.6 action 00, "add modulation source". The two capacity checks
  /// are here and only here, and both refuse with the table untouched.
  /// `indexOut`, when given, receives the new routing's position.
  RoutingResult add(Routing r, int* indexOut = nullptr) noexcept {
    const RoutingResult check = validate(r);
    if (check != RoutingResult::Ok) return check;
    if (count_ >= config_.maxRoutings) return RoutingResult::MatrixFull;
    if (contributors_[r.destination] >= config_.maxSourcesPerDestination) {
      return RoutingResult::DestinationFull;
    }
    routings_[count_] = r;
    ++contributors_[r.destination];
    if (indexOut != nullptr) *indexOut = count_;
    ++count_;
    return RoutingResult::Ok;
  }

  /// Action 01, "delete modulation". The routings above `index` move down.
  RoutingResult remove(int index) noexcept {
    if (!prepared_) return RoutingResult::NotPrepared;
    if (index < 0 || index >= count_) return RoutingResult::BadRouting;
    --contributors_[routings_[index].destination];
    for (int i = index + 1; i < count_; ++i) routings_[i - 1] = routings_[i];
    --count_;
    return RoutingResult::Ok;
  }

  /// Actions 02 to 07 in one: replace a routing's every field. Moving it onto
  /// a destination that is full is refused like an add would be, and the
  /// routing stays where it was — a "change destination" that succeeded on
  /// the display and failed in the table is the silent failure by another
  /// route. Moving it within its own destination needs no room.
  RoutingResult set(int index, Routing r) noexcept {
    if (!prepared_) return RoutingResult::NotPrepared;
    if (index < 0 || index >= count_) return RoutingResult::BadRouting;
    const RoutingResult check = validate(r);
    if (check != RoutingResult::Ok) return check;
    const int from = routings_[index].destination;
    if (r.destination != from) {
      if (contributors_[r.destination] >= config_.maxSourcesPerDestination) {
        return RoutingResult::DestinationFull;
      }
      --contributors_[from];
      ++contributors_[r.destination];
    }
    routings_[index] = r;
    return RoutingResult::Ok;
  }

  /// Actions 03, 04 and 07: the amount, with its sign. Clamped to the end
  /// stops rather than refused — a dial turned past its end is at its end,
  /// and a knob that refused its own stop would read as broken.
  RoutingResult setAmount(int index, float amount) noexcept {
    if (!prepared_) return RoutingResult::NotPrepared;
    if (index < 0 || index >= count_) return RoutingResult::BadRouting;
    if (std::isnan(amount)) return RoutingResult::BadAmount;
    routings_[index].amount = collapsed(amount);
    return RoutingResult::Ok;
  }

  /// Actions 05 and 06: the quantise flag.
  RoutingResult setQuantise(int index, bool quantise) noexcept {
    if (!prepared_) return RoutingResult::NotPrepared;
    if (index < 0 || index >= count_) return RoutingResult::BadRouting;
    routings_[index].quantise = quantise;
    return RoutingResult::Ok;
  }

  // ------------------------------------------------- what a display shows

  int routingCount() const noexcept { return count_; }
  int maxRoutings() const noexcept { return config_.maxRoutings; }
  /// How many routings feed `d` now — the "4" of "4 / 6 on this destination".
  int sourcesOn(int d) const noexcept { return contributors_[d]; }
  int maxSourcesPerDestination() const noexcept { return config_.maxSourcesPerDestination; }
  int sources() const noexcept { return config_.sources; }
  int destinations() const noexcept { return config_.destinations; }
  bool prepared() const noexcept { return prepared_; }

  /// The routing at a position. The position must be live; this is the read
  /// side of a display that already holds the count.
  const Routing& routing(int index) const noexcept { return routings_[index]; }

  /// The destination view of §9.6: the positions of every routing into `d`,
  /// in table order, at most `capacity` of them. Returns how many were written.
  int contributors(int d, int* out, int capacity) const noexcept {
    int n = 0;
    for (int i = 0; i < count_ && n < capacity; ++i) {
      if (routings_[i].destination == d) out[n++] = i;
    }
    return n;
  }

  /// The source view: everywhere `source` goes — "what does the mod wheel do
  /// in this patch". Same contract as `contributors`.
  int uses(int source, int* out, int capacity) const noexcept {
    int n = 0;
    for (int i = 0; i < count_ && n < capacity; ++i) {
      if (routings_[i].source == source) out[n++] = i;
    }
    return n;
  }

  // ---------------------------------------------------------- evaluation

  /// One grid point. `destinationSums` must hold `destinations()` floats and
  /// receives, per destination, the clamped sum of its contributions in that
  /// destination's native unit; a destination nothing feeds reads zero.
  ///
  /// One straight loop over the table, in table order, with no branch that
  /// depends on the data beyond the quantise flag, so two calls on one frame
  /// do the same arithmetic in the same order and produce the same bits.
  /// Nothing here allocates, locks, logs or calls anything that might; the
  /// only library call is `std::round`, which is arithmetic.
  ///
  /// The clamp is applied to the sum and nowhere earlier. Clamping each
  /// contribution first is the natural way to write this and is wrong: a
  /// +2.0 and a −1.5 into a ±1 destination would then read 1 − 1 = 0 rather
  /// than the +0.5 the sheet requires, and an opposing modulation would stop
  /// being able to pull a saturated one back.
  void evaluate(const voice::ModFrame& frame, float* destinationSums) const noexcept {
    if (!prepared_) return;
    const int n = config_.destinations;
    for (int d = 0; d < n; ++d) destinationSums[d] = 0.0f;
    for (int i = 0; i < count_; ++i) {
      const Routing& r = routings_[i];
      float c = r.amount * frame.sources[r.source] * specs_[r.destination].fullScale;
      if (r.quantise) c = std::round(c);
      destinationSums[r.destination] += c;
    }
    for (int d = 0; d < n; ++d) {
      const DestinationSpec& spec = specs_[d];
      float& v = destinationSums[d];
      v = v < spec.minimum ? spec.minimum : (v > spec.maximum ? spec.maximum : v);
    }
  }

 private:
  /// Everything a routing can be wrong about other than capacity, and the
  /// amount brought to its stored form. Capacity is checked by the caller,
  /// after this, so a routing that is both malformed and over budget reports
  /// the malformation — the thing the caller can fix by itself.
  RoutingResult validate(Routing& r) const noexcept {
    if (!prepared_) return RoutingResult::NotPrepared;
    if (r.source < 0 || r.source >= config_.sources) return RoutingResult::BadSource;
    if (r.destination < 0 || r.destination >= config_.destinations) {
      return RoutingResult::BadDestination;
    }
    if (std::isnan(r.amount)) return RoutingResult::BadAmount;
    r.amount = collapsed(r.amount);
    return RoutingResult::Ok;
  }

  /// The stored amount: inside the end stops, and never a negative zero.
  /// `−0.0f == 0.0f` is true, so a comparison would pass either through; the
  /// addition of zero to the stored form is what strips the sign bit, and it
  /// is written as one so nobody "simplifies" it away.
  static float collapsed(float amount) noexcept {
    const float clamped = amount < -1.0f ? -1.0f : (amount > 1.0f ? 1.0f : amount);
    return clamped + 0.0f;
  }

  MatrixConfig config_{};
  bool prepared_ = false;
  int count_ = 0;
  Routing routings_[kMaxRoutings]{};
  int contributors_[kMaxDestinations]{};
  DestinationSpec specs_[kMaxDestinations]{};
};

}  // namespace mw::dsp::mod
