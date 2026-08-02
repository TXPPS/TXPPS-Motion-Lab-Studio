# FAQ

**Where are my projects stored? Do I need an account?**
No account. Projects, recordings and imports live in your browser's
IndexedDB for this site. They stay on this device/profile. Export WAV to
share audio; keep irreplaceable takes exported.

**Why did the app ask me to click before playing sound?**
Browsers require a user gesture before audio can start. The first Play
(or any key/pad press) unlocks the audio engine.

**Playback is silent after I switched tabs on my phone.**
Mobile browsers suspend audio in background tabs. Return to the tab and
press Play again; the engine resumes automatically where it can.

**Can I use my MIDI keyboard?**
On Chrome/Edge (and Firefox with permission) — enable it in the Synth
tab's MIDI section. Safari has no Web MIDI; the on-screen and computer
keyboards always work.

**Recording says my microphone is blocked.**
Allow microphone access for this site in the browser's permission
settings, then arm the track again. The app only requests the microphone
when you arm/record — never at startup.

**What audio files can I import?**
Whatever your browser decodes — WAV, MP3 and M4A/AAC everywhere; OGG/FLAC
depend on the platform. Files are copied into browser storage, so the
original file isn't needed afterwards.

**How do I move a project to another computer?**
There's no cloud sync (by design, for the beta). Export stems/mix as WAV.
Full project portability is on the roadmap — see Known Limitations.

**Undo doesn't go back past opening the project.**
Undo history (60 steps) is per session and clears when switching
projects. Every save also keeps an automatic backup of the previous
version — if a project won't open, the backup restores automatically.

**Is my work safe if the tab crashes mid-recording?**
Captured audio is preserved and offered for recovery on the next start.
Ordinary edits are autosaved ~1.5 s after you make them, and closing the
tab flushes a final save (and warns if something is still unsaved).

**The app says a new version is ready. When does it apply?**
On the next natural load. A running session is never force-reloaded — a
DAW must not restart itself while you play or record.

**Something sounds wrong / broke. What helps you fix it?**
Diagnostics (wrench icon) → **Copy Report**, and the steps that caused
it. See the [Beta Guide](BETA-GUIDE.md) for the bug-report template.
