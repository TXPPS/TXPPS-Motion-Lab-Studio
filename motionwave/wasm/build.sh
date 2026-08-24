#!/usr/bin/env bash
# Motion Wave — build the core to WebAssembly.
#
# ADR-0001 makes this the browser target, so it is a build prerequisite rather
# than an optional extra: without it there is no product on the web platform.
#
# The flags are chosen for one reason each and are worth stating, because
# several of them look like they could be relaxed and cannot:
#
#   -O2                Not -O3 and not -Ofast. The boundary test asserts a
#                      bit-for-bit match against a native render, and the more
#                      aggressive levels license floating-point reassociation
#                      that would make the two targets legitimately disagree.
#                      A fast build that does not match is not a faster product,
#                      it is a different product.
#   -fno-fast-math     Same reason, said explicitly so that adding -Ofast later
#                      fails loudly rather than silently changing the audio.
#   MODULARIZE         The app loads several of these; a module that installs
#                      itself on the global object can only be loaded once.
#   EXPORT_ES6         The app is ESM. A UMD shim here would be a second module
#                      system to keep working.
#   ALLOW_MEMORY_GROWTH  A render's length is the caller's choice and a fixed
#                      heap would cap it at whatever seemed generous today.
#   ASSERTIONS=0       In the shipped build. The debug build below keeps them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
OUT="$HERE/dist"

# The pinned SDK. Recorded in CLAUDE.md as a prerequisite; a different version
# is allowed to produce a different binary, which is why the boundary test runs
# on every build rather than once.
EMSDK_DIR="${EMSDK_DIR:-/home/user/emsdk}"
if [ ! -f "$EMSDK_DIR/emsdk_env.sh" ]; then
  echo "emsdk not found at $EMSDK_DIR" >&2
  echo "Install it (see CLAUDE.md, 'Build prerequisites') or set EMSDK_DIR." >&2
  exit 1
fi
# shellcheck disable=SC1091
source "$EMSDK_DIR/emsdk_env.sh" >/dev/null 2>&1

mkdir -p "$OUT"

# One list for both builds below. Two copies would drift the first time an
# export was added, and the failure would be a worklet that cannot call the
# function the main-thread build just gained.
# Every unit's boundary, spelled out. Emscripten drops anything not named
# here, so a missing entry is a link-time-silent, run-time-fatal export —
# which is why the list is generated from one pattern per unit rather than
# maintained by hand alongside `unit_bridge.h`'s macro.
EXPORTS='["_mw_render_reference","_mw_render_length","_mw_golden_gain","_mw_shaper_prepare","_mw_shaper_set_param","_mw_shaper_set_curve","_mw_shaper_set_bpm","_mw_shaper_set_bypass","_mw_shaper_input","_mw_shaper_output","_mw_shaper_process","_mw_shaper_visual","_mw_shaper_generation","_mw_program_eq_prepare","_mw_program_eq_set_param","_mw_program_eq_input","_mw_program_eq_output","_mw_program_eq_process","_mw_program_eq_set_bypass","_mw_program_eq_generation","_mw_program_eq_visual","_mw_optical_leveller_prepare","_mw_optical_leveller_set_param","_mw_optical_leveller_input","_mw_optical_leveller_output","_mw_optical_leveller_process","_mw_optical_leveller_set_bypass","_mw_optical_leveller_generation","_mw_optical_leveller_visual","_mw_fet_limiter_prepare","_mw_fet_limiter_set_param","_mw_fet_limiter_input","_mw_fet_limiter_output","_mw_fet_limiter_process","_mw_fet_limiter_set_bypass","_mw_fet_limiter_generation","_mw_fet_limiter_visual","_mw_variable_mu_prepare","_mw_variable_mu_set_param","_mw_variable_mu_input","_mw_variable_mu_output","_mw_variable_mu_process","_mw_variable_mu_set_bypass","_mw_variable_mu_generation","_mw_variable_mu_visual","_mw_console_eq_prepare","_mw_console_eq_set_param","_mw_console_eq_input","_mw_console_eq_output","_mw_console_eq_process","_mw_console_eq_set_bypass","_mw_console_eq_generation","_mw_console_eq_visual","_mw_granular_reverb_prepare","_mw_granular_reverb_set_param","_mw_granular_reverb_input","_mw_granular_reverb_output","_mw_granular_reverb_process","_mw_granular_reverb_set_bypass","_mw_granular_reverb_generation","_mw_granular_reverb_visual","_malloc","_free"]'

emcc "$HERE/bridge.cpp" \
  -I"$ROOT/core" \
  -std=c++17 \
  -O2 \
  -fno-fast-math \
  -Wall -Wextra -Wpedantic -Werror \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createMotionWaveCore \
  -sALLOW_MEMORY_GROWTH=1 \
  -sASSERTIONS=0 \
  -sENVIRONMENT=web,worker,node \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["HEAPF32","HEAPF64","cwrap"]' \
  -o "$OUT/motionwave.mjs"

echo "wasm: $(du -h "$OUT/motionwave.wasm" | cut -f1) at $OUT/motionwave.wasm"

# ---------------------------------------------------------------- the worklet
#
# A second build of the same bridge, for the AudioWorklet.
#
# It exists because a worklet's global scope is not a module scope: it has no
# `import.meta`, no dynamic `import()`, and no `fetch` to go and get a `.wasm`
# with. `addModule` takes a classic script and that is all it takes. So this one
# is MODULARIZE without EXPORT_ES6, and SINGLE_FILE so the WebAssembly arrives
# inside the script rather than as a second request the worklet cannot make.
#
# The flags that decide the *arithmetic* are identical to the build above, which
# is the part that matters: the audio a user hears comes from this file, and if
# it were optimised differently from the one the boundary test verifies then the
# verified build would not be the shipped one.
emcc "$HERE/bridge.cpp" \
  -I"$ROOT/core" \
  -std=c++17 \
  -O2 \
  -fno-fast-math \
  -Wall -Wextra -Wpedantic -Werror \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=0 \
  -sEXPORT_NAME=createMotionWaveCore \
  -sSINGLE_FILE=1 \
  -sALLOW_MEMORY_GROWTH=1 \
  -sASSERTIONS=0 \
  -sENVIRONMENT=shell \
  -sEXPORTED_FUNCTIONS="$EXPORTS" \
  -sEXPORTED_RUNTIME_METHODS='["HEAPF32","HEAPF64"]' \
  -o "$OUT/motionwave.worklet.js"

# MODULARIZE without EXPORT_ES6 declares the factory with `var` at the script's
# top level. That reaches the worklet's global scope in every engine tried, but
# only by a rule about `var` in classic scripts, and a rule that happens to hold
# is not a contract. Stated explicitly instead.
echo "globalThis.createMotionWaveCore = createMotionWaveCore;" >> "$OUT/motionwave.worklet.js"

# Copied where the panel harness serves from. The harness has to load the same
# binary the boundary test verified; a second build for the browser would be a
# second product.
cp "$OUT/motionwave.worklet.js" "$ROOT/ui/dev/public/motionwave.worklet.js"

# And into `prebuilt/`, which is tracked in git.
#
# The app's production build needs this file, and the environments that run that
# build do not all have Emscripten: Cloudflare's builder does not, and neither
# does anyone cloning the repo to look at the web app. Requiring a C++
# toolchain to build a TypeScript app would mean the deployed site could only
# ever be built from a machine set up for the native work.
#
# The risk of a tracked build artefact is that it goes stale, so it is checked
# rather than trusted: `npm run wasm:check` rebuilds and compares byte for byte,
# and CI has Emscripten and runs it. A stale copy fails there rather than
# shipping.
mkdir -p "$ROOT/wasm/prebuilt"
cp "$OUT/motionwave.worklet.js" "$ROOT/wasm/prebuilt/motionwave.worklet.js"

echo "worklet: $(du -h "$OUT/motionwave.worklet.js" | cut -f1) at $OUT/motionwave.worklet.js"
