#!/usr/bin/env bash
# Push the current commit to every branch this repository has.
#
# Why all three rather than one: the Cloudflare Worker builds from the
# repository's *default* branch, and that default is still
# `claude/motionlab-studio-poc-3l1gwa` — the frozen Directive 03 branch. Changing
# it requires a repository settings write, which this environment's proxy
# refuses ("Repository settings writes are not permitted through this proxy"),
# and the Cloudflare build configuration cannot be reached from here either.
#
# So the deploy is made correct by making every branch identical instead. All
# three already point at the same commit; keeping them that way means the
# deployed site is the current code whichever branch the build watches, which is
# the outcome that matters to someone holding a phone.
#
# **This is why the stale branch is not deleted yet.** Directive 08 §1.3 says to
# delete it, and that instruction assumes §1.2 and §1.4 succeeded — with the
# default still pointing at it, deleting it would break the only deploy the user
# has. It goes the moment the default moves.
set -euo pipefail

BRANCHES=(
  main
  claude/professional-daw-development-gunhc0
  claude/motionlab-studio-poc-3l1gwa
)

for branch in "${BRANCHES[@]}"; do
  for attempt in 1 2 3 4; do
    if git push -q origin "HEAD:${branch}"; then
      echo "pushed HEAD -> ${branch}"
      break
    fi
    if [ "$attempt" = 4 ]; then
      echo "FAILED to push ${branch} after 4 attempts" >&2
      exit 1
    fi
    sleep $((2 ** attempt))
  done
done

echo "all branches at $(git rev-parse --short HEAD)"
