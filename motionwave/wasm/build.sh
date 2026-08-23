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
  -sEXPORTED_FUNCTIONS='["_mw_render_reference","_mw_render_length","_mw_golden_gain","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["HEAPF32","cwrap"]' \
  -o "$OUT/motionwave.mjs"

echo "wasm: $(du -h "$OUT/motionwave.wasm" | cut -f1) at $OUT/motionwave.wasm"
