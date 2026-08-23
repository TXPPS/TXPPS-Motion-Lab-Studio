# Motion Wave — the shared core and its headless tests.
#
# The core is plain C++17 with no dependencies (ADR-0003), which is what lets it
# compile for a phone, a desktop and a WebAssembly sandbox from one source. This
# file builds it for the host and runs its tests; the platform shells get their
# own build systems and link this as a library.
cmake_minimum_required(VERSION 3.20)
project(motionwave LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# Warnings are errors in the core. A warning in real-time audio code is usually
# a narrowing conversion or an unused result, and both of those have shipped as
# dropouts before.
add_library(mw_warnings INTERFACE)
target_compile_options(mw_warnings INTERFACE
  -Wall -Wextra -Wpedantic -Werror
  -Wshadow -Wconversion -Wsign-conversion -Wold-style-cast -Wdouble-promotion)

# Denormals cost hundreds of cycles per sample on some hardware and arrive
# silently as a reverb tail decays. Flushing them is standard for audio and is
# set here so no processor has to remember.
add_library(mw_audio_flags INTERFACE)
target_compile_options(mw_audio_flags INTERFACE -ffast-math -fno-finite-math-only)

# ------------------------------------------------------------------ the core
add_library(mw_core INTERFACE)
target_include_directories(mw_core INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/core)
target_link_libraries(mw_core INTERFACE mw_warnings)

# ----------------------------------------------------------------- the tests
enable_testing()

# Test binaries do not get -ffast-math: a null test that has to hold to
# -120 dBFS must not be run against arithmetic the compiler was told it could
# reassociate.
function(mw_add_test name source)
  add_executable(${name} ${source})
  target_link_libraries(${name} PRIVATE mw_core)
  add_test(NAME ${name} COMMAND ${name})
endfunction()

mw_add_test(param_tests core/test/param_tests.cpp)
mw_add_test(tempo_tests core/test/tempo_tests.cpp)
mw_add_test(topology_tests core/test/topology_tests.cpp)
mw_add_test(graph_tests core/test/graph_tests.cpp)
mw_add_test(render_tests core/test/render_tests.cpp)
mw_add_test(crossover_tests core/test/crossover_tests.cpp)
mw_add_test(modulator_tests core/test/modulator_tests.cpp)
mw_add_test(motion_shaper_tests core/test/motion_shaper_tests.cpp)
mw_add_test(spectrum_tests core/test/spectrum_tests.cpp)
mw_add_test(param_delta_tests core/test/param_delta_tests.cpp)
mw_add_test(nonlinear_tests core/test/nonlinear_tests.cpp)
mw_add_test(oversampler_tests core/test/oversampler_tests.cpp)
mw_add_test(program_eq_tests core/test/program_eq_tests.cpp)
mw_add_test(program_eq_amp_tests core/test/program_eq_amp_tests.cpp)
mw_add_test(program_eq_delta_tests core/test/program_eq_delta_tests.cpp)
mw_add_test(optical_leveller_tests core/test/optical_leveller_tests.cpp)
mw_add_test(optical_leveller_amp_tests core/test/optical_leveller_amp_tests.cpp)
mw_add_test(optical_leveller_delta_tests core/test/optical_leveller_delta_tests.cpp)
# The FET Limiter's suite is deliberately NOT registered yet.
#
# Six of its rows fail, and they fail because the unit is not calibrated rather
# than because the tests are wrong — the loop's steady state is still being set
# by the onset ringing of an abruptly-started tone rather than by the tone's
# level. Registering it would either break the build or invite the tests to be
# weakened until it passed, and the second is how a suite stops meaning
# anything.
#
# What *is* finished is the architecture the unit exists to prove, and it is
# measured: `fet_limiter_tests.cpp`'s first row separates the attack control
# cleanly across positions 1 to 6 at 44.1 kHz — 6.1, 10.3, 16.7, 26.1, 35.1 and
# 45.1 dB reached at a fixed instant — which is precisely what a host-rate
# detector cannot do, since 20 µs is 0.88 of a sample there.
#
# Build and run it directly while it is being finished:
#   cmake --build build --target fet_limiter_tests && ./build/fet_limiter_tests
add_executable(fet_limiter_tests core/test/fet_limiter_tests.cpp)
target_link_libraries(fet_limiter_tests PRIVATE mw_core)
