# ADR-0002 — Project file format

**Status:** Accepted · **Date:** 2026-08-22 · **Decider:** Program Director + Sync Engineer

## Context

The format has to satisfy four demands that pull against each other. It must be
open and human-inspectable, so a project can be diffed, repaired and understood
without the application. It must be forward-migratable, so a song written today
opens in three years. It must carry gigabytes of audio without the manifest
becoming unreadable. And it must support **delta sync** across phone, tablet and
desktop with deterministic conflict resolution — which means the format is not
merely a serialisation, it is the substrate the sync algorithm operates on.

The existing web DAW's format (a versioned JSON document plus IndexedDB blobs,
migrated forward by a validating loader) has proven the versioning discipline
over seven schema revisions. What it does not have is a sync story.

## Decision

A Motion Wave project is a **directory**, not a file. On platforms that want a
single artefact it is presented as a package (macOS/iOS bundle) or zipped.

```
Song.mwproj/
  manifest.json        the song: tracks, clips, devices, automation, arrangement
  format.json          { "format": "motionwave.project", "version": 1 }
  assets/
    sha256/ab/cd/abcd… content-addressed audio and sample data
  renders/             freeze and bounce caches — derivable, never synced
  history/
    ops/000001.jsonl   the operation log (see below)
```

**The manifest is JSON, sorted and pretty-printed.** Not a binary format, not
compressed. A song's structure is small — a large arrangement is a few hundred
kilobytes — and being able to open it in an editor, grep it, and see a
meaningful `git diff` is worth more than the bytes. Every id is a stable string;
nothing is addressed by array index, because an index-addressed document cannot
be merged.

**Assets are content-addressed by SHA-256.** The same recording referenced by
two projects is stored once; a file that has not changed never re-uploads;
resuming an interrupted transfer needs no state beyond which hashes are present.
Deduplication and resumability both fall out of the addressing scheme rather
than being features bolted onto it.

**Renders are never synced.** A freeze file is a function of the project and can
be rebuilt; syncing it would move the largest files in the project for no
information.

**Edits are operations, and the operation log is what syncs.** Every edit is a
small, addressed, commutative-where-possible operation (`set`, `insert`,
`remove`, `move`) against a path in the document. Sync ships operations, not
documents. Two devices that edited different things merge cleanly with no
prompt; two that edited the same field resolve by a total order (Lamport
timestamp, device id as tiebreak) and the loser is _kept_ in history rather than
discarded, so a conflict is recoverable rather than announced.

**Version 1 is a floor, not a guess.** The loader validates and migrates
forward; it never refuses a document it can repair, and it logs every repair.
That is the discipline the existing web app already runs, and it is the reason
seven schema revisions have cost no user a project.

## Consequences

- The engine's in-memory model and the manifest are the same shape. A separate
  "save format" that has to be translated is where drift starts.
- Undo is the operation log read backwards, so undo, history and sync are one
  mechanism rather than three.
- The manifest must stay free of anything derivable. A cached peak envelope, a
  computed clip length, a resolved device latency — none of these belong in a
  document that is diffed and merged.
- Sync conflict resolution is testable offline by construction: two operation
  logs and a merge function, no network required. That is a Phase-10 gate this
  host can actually run (ADR-0005).

## Rejected alternatives

- **A single binary file.** Fast to load and impossible to inspect, diff,
  repair or merge. The load-time saving is not worth it for a document this
  size.
- **SQLite as the project.** Excellent for a local application, poor as a sync
  substrate — merging two databases is a much harder problem than merging two
  operation logs, and the format stops being inspectable without a tool.
- **Whole-document sync with last-writer-wins.** Simple, and it silently
  destroys work whenever two devices touched the same song offline. The brief
  requires deterministic conflict resolution; last-writer-wins is deterministic
  and wrong.
