# MotionLab Studio backlog — deferred

Directive 03 §1 closes the last MotionLab work and says: defer everything else
here and do not return. This is that list. Nothing in it is planned; it exists
so that the decision to stop was recorded rather than the items being lost.

All of it is open findings from the §3 plugin audit and the §4 responsive audit,
both of which are complete and whose reports carry the measurements. Severities
are as those audits assigned them.

## From the plugin and instrument audit (`docs/audit/PLUGIN_AUDIT.md`)

All three P1s are closed. Ten P2s remain.

| Id     | What                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA-004 | Eighteen controls rebuild and swap a WaveShaper table on every automation frame instead of ramping — 360 curve rebuilds in 360 updates, 34–153 ms per sweep. Same shape as PA-001, one tier down in cost                                                                        |
| PA-005 | Vocal Tune offers six automation lanes against a node that is a declared pass-through                                                                                                                                                                                           |
| PA-007 | Instrument parameters are guarded at neither end: a NaN cutoff survives the load path, clamps to the 40 Hz floor, and the instrument is silently dead                                                                                                                           |
| PA-008 | A bypassed Multiband keeps publishing −7.5 dB of gain reduction and the face keeps drawing it                                                                                                                                                                                   |
| PA-009 | A stale limiter-latency claim in `KNOWN-LIMITATIONS.md`                                                                                                                                                                                                                         |
| PA-011 | The division knob prints the straight name whatever the Feel control says, while the slot summary and the audio apply the Feel                                                                                                                                                  |
| PA-012 | The Filter's Drive is a second uncompensated parallel blend of an oversampled shaper against a dry wire. **Note:** the equivalent defect in the Saturator and Distortion was fixed under PA-010, and the same one-line fix applies here — this is the cheapest item on the list |
| PA-013 | `Smoother` places its pole from a hard-coded 128-frame render quantum: correct today, silently wrong if a render size is ever hinted                                                                                                                                            |

## From the responsive and orientation audit (`docs/audit/RESPONSIVE_AUDIT.md`)

All four P0s are closed. Seven P1s and five P2s remain; two P1s were closed under
Directive 03 §1 and are struck from this list (RA-005 close button, and the
monitor-versus-solo question inside RA-002).

| Id     | Severity | What                                                                                                                                                                                                                                                                                                                                      |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RA-006 | P1       | The rack's `Insert` button answers no first pointer press on any cell: it is 12–15 px tall, and selecting a strip reflows it out from under the pointer between press and release                                                                                                                                                         |
| RA-007 | P1       | Text scaling is not implemented rather than imperfect — 130 % and 200 % root font size produce byte-identical geometry, because the type scale is `px × --ui-scale` and there is no `rem` in the codebase. **Directive 03 §2.4 requires Motion Wave's own framework to be `rem`-based from line one precisely so this is never repeated** |
| RA-008 | P1       | Channel strips clip 13–66 px vertically on 9 of 19 cells                                                                                                                                                                                                                                                                                  |
| RA-009 | P1       | Sheets escape `.app`'s inset padding and put footer buttons under the bezel                                                                                                                                                                                                                                                               |
| RA-011 | P1       | The product's own 140 % interface scale adds 73 defects                                                                                                                                                                                                                                                                                   |
| RA-012 | P1       | The phone's overflow-menu button — the sole route to four surfaces — is 20×36                                                                                                                                                                                                                                                             |
| RA-010 | P2       | The overview's window is wider than the overview                                                                                                                                                                                                                                                                                          |
| RA-013 | P2       | The mixer scrolls sideways and clips downwards                                                                                                                                                                                                                                                                                            |
| RA-014 | P2       | 313 distinct sub-44 px targets beyond the named tickets                                                                                                                                                                                                                                                                                   |
| RA-015 | P2       | Sub-5 px clips                                                                                                                                                                                                                                                                                                                            |
| RA-016 | P2       | The Diagnostics sheet does not close on Escape                                                                                                                                                                                                                                                                                            |

## Not a finding, but open

`e2e/automation.spec.ts:348` — the touch fader ride writes one automation point
where it wants more than one. Verified pre-existing by stashing the §4 work and
running it against the previous commit, where it fails identically. Its own
comment describes this container's audio stack suspending playback mid-test, so
it may be environmental rather than a product defect; nobody has established
which, and doing so is the first step if it is ever picked up.
