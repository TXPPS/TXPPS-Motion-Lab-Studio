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
   artwork may evoke the *era's* design language — knob families, control
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

| Motion Wave unit | Class of reference | Spec sheet | Sources | Artwork |
| --- | --- | --- | --- | --- |
| Program EQ | Passive program equaliser with valve make-up, late 1950s | `dyn-01-program-eq.md` | Manuals, published circuit analysis, an SMC 2024 wave-digital-filter paper | Original; era language only |
| Optical Leveller | Electro-optical levelling amplifier, 1960s | `dyn-02-optical-leveller.md` | Manufacturer spec, published photocell behaviour | Original; era language only |
| FET Limiter | FET limiting amplifier, late 1960s | `dyn-03-fet-limiter.md` | Manuals, published measurements | Original; era language only |
| Variable-Mu Limiter | Valve variable-mu limiter, 1950s | `dyn-04-variable-mu.md` | Manual, published circuit analysis | Original; era language only |
| Console EQ (two lineages) | Discrete console equalisers, British and American, c. 1967–1970 | `dyn-05-console-eq.md` | Manufacturer documentation, published circuit analysis | Original; era language only |
| Motion Shaper | Multiband rhythmic modulation processor, contemporary | `fx-01-motion-shaper.md` | Vendor documentation, reviews, crossover and anti-aliasing literature | Original; interaction model only, no artwork studied |
| Granular Reverb | No single reference — academic literature | `fx-02-granular-reverb.md` | Roads, Truax, Schroeder/Moorer/Jot/Dattorro, Välimäki's review | Original |
| Granular Delay | No single reference — literature plus analogue-delay theory | `fx-03-granular-delay.md` | DAFx papers on BBD and tape modelling, magnetic-recording theory | Original |
| DCO Poly | DCO polysynth, 1982–84 | `syn-01-dco-poly.md` | Service manuals, published circuit analysis | Original; era language only |
| Phase Distortion | Phase-distortion synth, 1985 | `syn-02-phase-distortion.md` | Manuals, published algorithm analysis | Original; era language only |
| Analog Five | Analogue five-voice, 1978–84 | `syn-03-analog-five.md` | Service manuals, published revision differences | Original; era language only |
| Six-Op FM | Six-operator FM synth, 1983 | `syn-04-six-op-fm.md` | Manuals, patents, published algorithm tables | Original; era language only |

Every sheet carries the IP banner at the top of the file, marks its own
inferences inline, and writes "unknown" rather than filling a gap. No sheet
describes panel artwork, a logo, a typeface or a badge; each describes only the
era's design language, which is general to its period and fair to evoke.

## Third-party code and licences

| Component | Licence | Where used | Notes |
| --- | --- | --- | --- |
| _(none yet — the core has no dependencies by design, ADR-0003)_ | | | |

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
