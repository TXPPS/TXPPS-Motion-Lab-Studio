# Legal notes — provenance and IP compliance

This file is the programme's record that Motion Wave's modelled units were built
from legitimate sources and carry no third-party trade dress. It is maintained
by the Program Director and updated whenever a modelled unit is added.

## The rules every agent works under

1. **Behaviour is studied; identity is not borrowed.** Circuit behaviour, control
   taxonomy and sonic targets are researched from published specifications,
   owner's and service manuals, patents, academic literature and published
   measurements. That research is legitimate and is what the Reference Spec
   Sheets in `docs/reference/` record.
2. **No reference names ship.** Trademarked product names, manufacturer names
   and model numbers appear only in `docs/reference/`, which is internal. They
   never appear in shipped UI, code identifiers, namespaces, filenames, preset
   names, marketing copy or comments under `motionwave/`.
3. **No trade dress.** Panel artwork, logos, typefaces, badges and distinctive
   visual identity are never copied, traced or screenshot-lifted. Original
   artwork may evoke the _era's_ design language — knob families, control
   taxonomy, panel proportions, period colour temperature, display technology —
   because a design language is not a trademark.
4. **No extraction.** No commercial plugin is decompiled, disassembled, or has
   assets, impulse responses or coefficient tables extracted from it. Where a
   model needs a measurement, it comes from published data or from measuring
   original hardware, and the source is cited.
5. **Escalate rather than guess.** Any request that would cross these lines is
   flagged to the user, not quietly accommodated.

## Why this is the right posture

Emulating the behaviour of an audio circuit is not, by itself, infringement:
circuits and the sound they make are not protected the way a name or a panel
design is. What creates exposure is using someone's mark to sell your product,
or reproducing the artwork that identifies theirs. Separating the two — study
the behaviour, build original identity — is the standard the audio industry
already operates on, and it is a commercial-safety requirement here rather than
a stylistic preference.

## Provenance register

One row per modelled unit. Added as each Reference Spec Sheet lands; a unit may
not enter implementation without a row here and a sheet in `docs/reference/`.

| Motion Wave unit          | Class of reference                                                | Spec sheet                   | Sources                                                                                                                                                                                     | Artwork                                              |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Program EQ                | Passive program equaliser with valve make-up, late 1950s          | `dyn-01-program-eq.md`       | Manuals, published circuit analysis, an SMC 2024 wave-digital-filter paper                                                                                                                  | Original; era language only                          |
| Optical Leveller          | Electro-optical levelling amplifier, 1960s                        | `dyn-02-optical-leveller.md` | Manufacturer spec, published photocell behaviour                                                                                                                                            | Original; era language only                          |
| FET Limiter               | FET limiting amplifier, late 1960s                                | `dyn-03-fet-limiter.md`      | Manuals, published measurements                                                                                                                                                             | Original; era language only                          |
| Variable-Mu Limiter       | Valve variable-mu limiter, 1950s                                  | `dyn-04-variable-mu.md`      | Manual, published circuit analysis                                                                                                                                                          | Original; era language only                          |
| Console EQ (two lineages) | Discrete console equalisers, British and American, c. 1967–1970   | `dyn-05-console-eq.md`       | Manufacturer documentation, published circuit analysis                                                                                                                                      | Original; era language only                          |
| Motion Shaper             | Multiband rhythmic modulation processor, contemporary             | `fx-01-motion-shaper.md`     | Vendor documentation, reviews, crossover and anti-aliasing literature                                                                                                                       | Original; interaction model only, no artwork studied |
| Granular Reverb           | No single reference — academic literature                         | `fx-02-granular-reverb.md`   | Roads, Truax, Schroeder/Moorer/Jot/Dattorro, Välimäki's review                                                                                                                              | Original                                             |
| Granular Delay            | No single reference — literature plus analogue-delay theory       | `fx-03-granular-delay.md`    | DAFx papers on BBD and tape modelling, magnetic-recording theory                                                                                                                            | Original                                             |
| DCO Poly                  | DCO polysynth, 1982–84                                            | `syn-01-dco-poly.md`         | **Instrumented hardware measurements (MIT-licensed repo)**, manufacturer specifications, published circuit analysis; GPL-emulator constants remain quarantined `[I]` and unused — see below | Original; era language only                          |
| Phase Distortion          | Phase-distortion synth, 1985                                      | `syn-02-phase-distortion.md` | Manuals, published algorithm analysis                                                                                                                                                       | Original; era language only                          |
| Analog Five               | Analogue five-voice, 1978–84                                      | `syn-03-analog-five.md`      | Service manuals, published revision differences                                                                                                                                             | Original; era language only                          |
| Matrix Twelve             | Twelve-voice analogue polysynth with a modulation matrix, 1984–85 | `syn-05-matrix-twelve.md`    | Manufacturer MIDI specification and service documentation; the specification was read from a GPL-licensed _mirror_, which is documentation rather than implementation — see §Purge          | Original; era language only                          |
| Six-Op FM                 | Six-operator FM synth, 1983                                       | `syn-04-six-op-fm.md`        | Manuals, patents, published algorithm tables. **GPL clone purged — see §Purge**                                                                                                             | Original; era language only                          |

Every sheet carries the IP banner at the top of the file, marks its own
inferences inline, and writes "unknown" rather than filling a gap. No sheet
describes panel artwork, a logo, a typeface or a badge; each describes only the
era's design language, which is general to its period and fair to evoke.

## Measurement versus implementation — the rule that came out of the research

The Research Analysts used the session's git proxy to read public GitHub
repositories, which turned out to be a better instrument than search for several
subjects. That is a legitimate channel and the sheets are stronger for it, but
it forces a distinction the brief implied and did not spell out.

**A repository that publishes measurements of hardware is an excellent source.**
Instrumented captures of envelope timings, filter corners and chorus rates are
_facts about a physical device_, and facts are not copyrightable. This is
exactly the "published measurements" class §2.3 authorises. `syn-01`'s primary
source is one of these — MIT-licensed, method stated, cross-checked against a
second author — and it is the best-sourced sheet in the set because of it.

**A repository that publishes an emulator is a different thing.** Its constants
are somebody's design decisions expressed in code, not measurements of hardware.
Where such a project is copyleft, transcribing those decisions into a commercial
product is a real contamination risk, and reading it at all is an evidentiary
fact you would rather not have.

## Purge of copyleft material — closed

Directive 03 §2.1. Recorded here rather than in a commit message because a
provenance register that does not say what was removed is not a register.

**What was cloned during research.** Four repositories were fetched into the
working environment (never into this repository — no third-party source was ever
committed, which `git log --diff-filter=A` confirms):

| Clone                    | Licence                                                    | Used for                                           | Disposition                                                    |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `pendragon-andyh/juno60` | **MIT**                                                    | Instrumented hardware measurements behind `syn-01` | **Kept.** MIT is compatible; it is cited in the register above |
| `thorinside/czd_osc`     | **MIT**                                                    | Phase-distortion oscillator behaviour, `syn-02`    | **Kept.** MIT is compatible                                    |
| `ajwills72/cz101`        | Documentation only — manuals and price lists, no source    | `syn-02` background                                | **Kept.** Nothing executable in it                             |
| `grame/faustlibraries`   | **GPL** across the library, including its `dx7/` emulation | `syn-04` background                                | **Deleted, 29 MB.** Removed from disk in full                  |

**What replaces the deleted material.** `syn-04`'s implementation inputs are its
manuals, the patents, and the published algorithm tables, all of which are named
in that sheet's sources. The Faust `dx7` library was read as _context_ for what a
six-operator engine does; nothing was transcribed from it, and nothing needs to
be, because the operator topology and the envelope model are documented in the
primary sources. The sheet's own §"what I could not confirm" is the honest record
of what those sources leave open.

**The quarantine still stands.** `syn-01`'s `[I]`-marked constants — cutoff
mapping, modulation depths, mixer soft-compression threshold, chorus wet/dry and
filter frequencies, gate-mode times, VCA gain law, envelope tables, PWM width
mapping — came from a GPL emulator and remain research context. None has reached
any implementation, because no implementation exists yet; each must be re-derived
from measurement or documentation, or chosen freshly, before it does.

**On the Matrix Twelve mirror.** `syn-05` reads its MIDI specification from a
GPL-3.0 repository. What that repository _contains_ is a rework of a
manufacturer's published specification — a document, not an implementation — so
what is used from it is fact about a hardware interface rather than expression.
Facts are not copyrightable and no code is taken.

**A correction to this register, found by the analyst writing `smp-01`.** An
earlier version of this paragraph said the AGPL-3.0 editor application listed in
that sheet "has not been read". That was wrong, and understating what was read
is the one direction an IP record must never err in. `syn-05` §0.1 is the
accurate account: the editor **was** cloned in an earlier session and read for
the numeric ranges of the continuous controls and the capacity constants, and
every value taken that way is marked `[I]` in that sheet for exactly that
reason. It is not on disk in this environment and no clone of it survives.

The distinction that keeps this safe is the one the sheet itself draws: reading
an implementation to learn _what a control's range is_, then confirming that
range against the manufacturer's published specification, takes a fact rather
than an expression. Several of those ranges are independently confirmed by the
specification's own bit masks — the 6-bit amount mask, the sign bit and the
quantise bit — and are `[C]` on that basis. The rest stay `[I]`, quarantined
exactly like `syn-01`'s: each must be confirmed by measurement or documentation,
or replaced with our own choice, before it reaches an implementation. No code,
structure or parameter table from that editor may enter the product, and none
has — no implementation of this unit exists yet.

**Enforcement.** `scripts/licence-guard.mjs` runs as the first step of
`npm run build` and fails it if any source file's header declares GPL, LGPL,
AGPL or SSPL terms. It scans source extensions only and deliberately ignores
Markdown: the reference sheets have to be able to say "this emulator is GPL-3.0,
so its constants are quarantined", and banning the words would delete the audit
trail rather than the risk. Verified in both directions — clean tree passes, a
planted `SPDX-License-Identifier: GPL-3.0-or-later` file fails the build.

Therefore:

1. **Quarantined constants.** `syn-01` marks every value taken from a GPL
   emulator `[I]` and says plainly that an emulator constant is a design
   decision. Those values are research context, **not implementation input**.
   Each must be re-derived from measurement or documentation, or replaced with
   our own choice, before it reaches `motionwave/`. The affected set is named in
   that sheet's §19: cutoff mapping, modulation depths in octaves, mixer
   soft-compression threshold, chorus wet/dry and filter frequencies, gate-mode
   times, VCA gain law, envelope lookup tables, PWM width mapping.
2. **No transcription.** Code, coefficient tables and algorithm structure are
   never copied from any third-party project into a sheet or into the product.
   ASCII architecture diagrams are fine; a table of somebody's magic numbers is
   not.
3. **Prefer the manufacturer.** Where a fact exists in a manual or a patent, it
   is sourced there even if an implementation states it more conveniently. The
   six-operator FM algorithm table is published by the manufacturer and in the
   patents, and that is where it must come from.
4. **Clones are disposable and are not part of the product.** Nothing cloned for
   research is vendored, linked, or committed. Copyleft clones are removed once
   their sheet is written, so nobody reads them casually later.

## Third-party code and licences

| Component                                                       | Licence | Where used | Notes |
| --------------------------------------------------------------- | ------- | ---------- | ----- |
| _(none yet — the core has no dependencies by design, ADR-0003)_ |         |            |       |

## Open questions for the user

- **Fender Studio Pro 8 is named in the brief as the feel reference.** Studying a
  competitor's ergonomics and workflow is normal practice and is not what this
  file guards against; the guard is that its name, artwork and any distinctive
  visual identity stay out of the product. Recorded here so the distinction is
  explicit.
- Any decision to ship impulse responses, sample content or factory presets
  derived from third-party material needs a licensing answer before it ships.
  None is planned. Note that ADR-0006 disqualifies convolution reverb on cost,
  which removes the most likely reason anyone would have wanted to ship an
  impulse-response library.
