# Public Beta Guide

Welcome to the MotionLab Studio beta. The goal of this phase is stability:
please try to break it, and tell us exactly how you did.

**App:** https://txpps-motionlab-studio.roan-crest.workers.dev
**Docs:** [Quick Start](QUICK-START.md) · [User Manual](USER-MANUAL.md) ·
[FAQ](FAQ.md) · [Known Limitations](KNOWN-LIMITATIONS.md)

## What to expect

- Everything in the User Manual works and is covered by automated tests
  on Chromium, Firefox and WebKit engines.
- Your projects stay in your browser. Autosave + automatic backups are
  on; still, export anything irreplaceable as WAV.
- Known gaps are documented — read Known Limitations before filing "no
  cloud sync" as a bug.

## Good bug reports

1. **Diagnostics first.** Wrench icon → **Copy Report** (or Download).
   It contains version, browser, feature detection, audio/storage state
   and the recent event log — no audio content.
2. **Steps.** What you did, what you expected, what happened instead.
3. **Scale.** Rough track/clip counts if it's a performance issue.

### Report template

```
Title: [area] short description   (e.g. "[sampler] pad drop replaces wrong pad")

What happened:
What I expected:
Steps to reproduce:
  1.
  2.
How often: always / sometimes / once
Diagnostic report: (paste from Diagnostics → Copy Report)
```

File reports as GitHub issues on this repository (a matching issue
template is provided), or send the filled template through your beta
feedback channel.

## Feedback beyond bugs

Feature requests are welcome but the beta is feature-frozen — they're
collected for post-1.0. Usability friction ("I couldn't find how to…")
is treated as a bug: please report it.

## Privacy

The app makes no network calls after loading except the service-worker
update check against its own origin. Diagnostic reports are generated
locally and only shared if you paste them. Audio never leaves your
machine unless you export and share it.

## Quick self-checks before reporting

- Silent? Press Play once (audio needs a user gesture); check the master
  meter and track mutes/solos.
- Microphone dead? Check the site permission and the input device in the
  Record workspace.
- Choppy? Note your track/clip counts and whether other tabs are heavy;
  include the Diagnostics report.
- Won't load? Try `#/diagnostics` and include the panel contents; a
  Shift-reload fetches a fresh app version.
