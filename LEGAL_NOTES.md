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
| _(pending — Research Analysts in progress)_ | | | | |

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
  None is planned.
