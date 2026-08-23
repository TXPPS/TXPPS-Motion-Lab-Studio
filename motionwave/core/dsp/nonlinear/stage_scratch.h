// Motion Wave — the scratch handoff every nonlinear element takes.
//
// Its own header, and not a member of any one element, because it is the
// contract between a *unit* and everything it owns: `lib-nonlinear.md` §5.1
// says a unit allocates one arena in `prepare` and hands slices of it to its
// stages, so that the whole chain costs exactly one allocation. A type that
// lived inside one stage's header would make every other stage depend on that
// stage to speak the shared language.
#pragma once

#include <cstddef>

namespace mw::dsp::nl {

/// A slice of a unit's arena, in floats. Never owned, never freed here.
struct StageScratch {
  float* data = nullptr;
  std::size_t floats = 0;
};

}  // namespace mw::dsp::nl
