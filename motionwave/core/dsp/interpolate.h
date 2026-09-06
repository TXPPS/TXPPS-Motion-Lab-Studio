// Motion Wave — the polynomial interpolation kernels, once.
//
// The grain engine (`dsp/grain/source.h`) and the sampler's classic read head
// (`dsp/sample/classic_read.h`) both read a buffer at a fractional position
// with the same four-point cubic and the same two-point linear kernel. They
// gather their taps differently — the grain engine wraps on a power-of-two
// mask, the sampler wraps on a loop — so what is shared is the arithmetic on
// the gathered taps and nothing else. Two copies of that arithmetic would be
// two chances for one to drift: the sampler's V-3 alias floor and the grain
// engine's GE-11 both grade the *same* kernel, and they can only be grading the
// same kernel if there is one.
//
// The expression order here is exactly the order `source.h` carried before the
// split. That is load-bearing rather than tidy: the grain engine's golden
// renders are compared bit for bit, and float arithmetic is not associative.
#pragma once

namespace mw::dsp {

/**
 * Catmull-Rom cubic through four consecutive samples, evaluated `fraction` of
 * the way from `y1` to `y2`.
 *
 * `fraction` of exactly zero returns `y1` exactly — every product is multiplied
 * by zero and then `y1` is added — which is what lets a read at an integer
 * position be the sample itself rather than an approximation of it.
 */
inline float hermite4(float y0, float y1, float y2, float y3, float fraction) noexcept {
  const float a = 0.5f * (-y0 + 3.0f * y1 - 3.0f * y2 + y3);
  const float b = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
  const float c = 0.5f * (-y0 + y2);
  return ((a * fraction + b) * fraction + c) * fraction + y1;
}

/// Linear between two consecutive samples. Exact at a fraction of zero for the
/// same reason as above.
inline float linear2(float y1, float y2, float fraction) noexcept {
  return y1 + (y2 - y1) * fraction;
}

}  // namespace mw::dsp
