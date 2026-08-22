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
