/**
 * The claims no read of this repository can settle, and why each one is one.
 *
 * `scripts/parity/evidence.mjs` checks the half of the audit that is ours:
 * every repository path and filename a section cites must resolve, and every
 * symbol it says is absent must still be absent. That covers 806 of the 947
 * claims the chapters make. This file is the other 141, across 99 sections.
 *
 * They are not unchecked because nobody got to them. Each one is a claim whose
 * MotionLab side is *an absence of a whole subsystem*, or a statement about a
 * gesture that only a running browser can settle, or a chapter's own round-up
 * of verdicts made elsewhere. A grep cannot confirm that there is no Audition
 * Channel; it can only fail to find one, which is what the claim already says.
 *
 * So the requirement is not that they be checked. It is that each one has been
 * *looked at and marked*, with a reason, so the set is a decision somebody made
 * rather than a silence. A section here that grows a code citation stops being
 * exempt automatically — the guard fails on an entry whose section now has
 * evidence, because that is a claim that became checkable and was left out.
 */

/**
 * Why a claim needs judgement. Four reasons, and every section takes one.
 *
 * Stated as classes rather than as ninety-nine sentences because the sentences
 * would be ninety-nine copies of four. What is per-section is the *assignment*: choosing
 * which of these a claim is, is the judgement being recorded.
 */
export const REASONS = {
  'no-subsystem':
    'MotionLab has no equivalent subsystem, so there is no code to cite. The verdict is ' +
    'an absence, and an absence is what a failed grep already proves — running one here ' +
    'would restate the claim rather than test it.',
  interaction:
    'The claim is about a gesture or a run-time behaviour — what a tool does under the ' +
    'pointer, what a dialog does when it opens. No static read settles it; the e2e suite ' +
    'is where a check for this belongs, and `e2e/pointer.ts` is how it would be written.',
  'host-application':
    'A property of a native host — driver models, plug-in scanning, install locations, ' +
    'process priority. A browser tab has no answer to it, and ADR-0001 says the web ' +
    'target is not where it would get one. `DIVERGENT-BY-DESIGN` is usually the verdict.',
  'round-up':
    "A chapter's own summary of verdicts it made elsewhere. Checking it here would check " +
    'the same claim twice and let a real one hide behind a duplicate.',
};

/**
 * Every section whose claims need judgement, and which reason applies.
 *
 * Ordered as the chapters are, so a reader can walk the audit and this list
 * side by side.
 */
export const JUDGEMENT = {
  // ---- editing: the tool set, comping, and the Event Inspector ------------
  //
  // Almost all of these are gestures. "What the Split tool does when you click
  // an event" is not a symbol; it is a behaviour, and the honest check is a
  // browser driving a real pointer rather than a grep for `split`.
  'editing/1.4-event-colour': 'interaction',
  'editing/1.6-spot': 'no-subsystem',
  'editing/2.3-split-tool-3': 'interaction',
  'editing/2.4-eraser-tool-4': 'interaction',
  'editing/2.6-mute-tool-6': 'interaction',
  'editing/2.8-listen-tool': 'no-subsystem',
  'editing/2.10-tool-set-comparison': 'round-up',
  'editing/3.2-clip-versions-separate-shared-copies': 'no-subsystem',
  'editing/4.1-timebase': 'no-subsystem',
  'editing/5.5-nudge': 'interaction',
  'editing/5.6-duplicate-duplicate-and-insert': 'interaction',
  'editing/5.7-duplicate-shared-ghost-copies': 'no-subsystem',
  'editing/5.8-explode-pitches-to-tracks': 'no-subsystem',
  'editing/5.11-crossfade': 'interaction',
  'editing/5.12-transport-options-that-affect-editing': 'interaction',
  'editing/5.13-ripple-edit': 'interaction',
  'editing/5.15-loop-tool-event-looping': 'no-subsystem',
  'editing/5.16-set-bar-second-offset-to-cursor': 'no-subsystem',
  'editing/6.2-time-lock-vs-edit-lock': 'no-subsystem',
  'editing/7.-convert-a-part-into-a-pattern': 'no-subsystem',
  'editing/9.-edit-groups': 'no-subsystem',
  'editing/10.1-manual-timestretch': 'interaction',
  'editing/10.2-automatic-timestretch-tempo-mode': 'no-subsystem',
  'editing/10.3-defining-file-tempo': 'no-subsystem',
  'editing/10.7-default-tempo-mode-for-new-tracks': 'no-subsystem',
  'editing/11.2-comp-assembly-the-core-gesture': 'interaction',
  'editing/11.3-range-tool-comping-without-promotion': 'interaction',
  'editing/11.4-auditioning-takes': 'interaction',
  'editing/11.5-layer-take-controls': 'no-subsystem',
  'editing/11.6-switching-between-layers': 'no-subsystem',
  'editing/11.7-takes-and-layers-menu-on-the-event': 'no-subsystem',
  'editing/11.8-quick-switching-content-on-the-main-track': 'no-subsystem',
  'editing/11.9-comping-keyboard-navigation': 'interaction',
  'editing/11.10-layer-editing-with-the-other-tools': 'no-subsystem',
  'editing/11.11-layers-follow-events': 'no-subsystem',
  'editing/11.12-layer-naming-and-colour': 'no-subsystem',
  'editing/11.13-comping-with-groups': 'no-subsystem',
  'editing/11.14-after-comping-consolidate-or-merge': 'no-subsystem',
  'editing/12.2-tab-to-transient': 'no-subsystem',
  'editing/12.5-the-bend-panel': 'no-subsystem',
  'editing/12.6-quantize-vs-slice': 'no-subsystem',
  'editing/12.8-phase-coherent-multitrack-quantization': 'no-subsystem',
  'editing/13.2-instrument-track-freeze': 'interaction',
  'editing/13.3-external-instrument-freeze-bus-freeze-quick-convert': 'no-subsystem',
  'editing/14.3-event-inspector-audio-event': 'no-subsystem',
  'editing/14.4-event-inspector-instrument-part': 'no-subsystem',
  'editing/14.6-ara-effects': 'no-subsystem',
  'editing/17.2-select-all-scope': 'interaction',
  'editing/17.3-arrow-tools-extended-vs-basic': 'interaction',
  'editing/17.6-split-tool-and-split-at-grid': 'interaction',
  'editing/17.7-paint-tool-in-the-note-editor': 'no-subsystem',
  'editing/17.8-transform-tool-for-velocity': 'no-subsystem',
  'editing/17.10-humanize': 'no-subsystem',
  'editing/17.12-multitrack-note-editing': 'no-subsystem',
  'editing/17.13-note-colour': 'no-subsystem',
  'editing/17.14-select-part-automation-with-notes': 'no-subsystem',
  'editing/26.-editing-suggestions': 'round-up',

  // ---- mixing ------------------------------------------------------------
  'mixing/5.5-sidechaining': 'interaction',
  'mixing/8.-scenes-console-scenes': 'no-subsystem',
  'mixing/9.-the-listen-bus': 'no-subsystem',
  'mixing/10.2-manual-audio-track-delay': 'no-subsystem',
  'mixing/13.-directive-1-deep-dive-summary': 'round-up',

  // ---- recording ---------------------------------------------------------
  'recording/1.9-position-display-timebase': 'no-subsystem',
  'recording/5.3-hardware-direct-monitoring': 'host-application',
  'recording/5.4-tape-style-monitoring-monitoring-mutes-playback': 'no-subsystem',
  'recording/8.1-manual': 'interaction',
  'recording/8.5-postroll': 'no-subsystem',
  'recording/8.6-the-record-panel': 'no-subsystem',
  'recording/11.-instrument-track-recording-modes': 'no-subsystem',

  // ---- setup: overwhelmingly the host application ------------------------
  //
  // AD-3 and IO-13 were here and are not any more. Both grew a code citation
  // when the audit was corrected — output device selection had been built and
  // the chapter still called it a P0 — and the guard refused to keep exempting
  // a section that had become checkable. That direction matters as much as the
  // other: an exemption nobody revisits is how a document goes stale twice.
  //
  // Driver models, plug-in scan paths, efficiency cores, install locations. A
  // browser tab has none of these and is not going to grow them; ADR-0001 puts
  // the native answers in Motion Wave, not here.
  'setup/ad-4-device-control-panel-button': 'host-application',
  'setup/ad-8-import-export-device-configurations-p0': 'host-application',
  'setup/ad-9-audio-dropout-protection-process-buffer-size': 'host-application',
  'setup/ad-12-monitoring-latencies-table': 'host-application',
  'setup/ad-14-monitoring-mode-attributes-table': 'host-application',
  'setup/ad-15-process-precision': 'host-application',
  'setup/ad-16-supported-drivers-and-wasapi-exclusive-shared': 'host-application',
  'setup/ad-17-use-efficiency-cores-for-audio-processing': 'host-application',
  'setup/ad-19-third-party-plug-in-multiprocessing-advice': 'host-application',
  'setup/io-6-per-channel-format-drop-down-and-channel-dragging-p0': 'no-subsystem',
  'setup/io-8-the-default-i-o-configuration-p0-quote-critical': 'no-subsystem',
  'setup/io-12-routing-changes-mid-production': 'no-subsystem',
  'setup/md-6-receive-from-send-to': 'no-subsystem',
  'setup/md-13-recognised-control-surface-with-zero-setup': 'host-application',
  'setup/mc-3-use-cached-plug-in-data-on-save': 'host-application',
  'setup/mc-8-vst-plug-in-locations-scan-at-startup-blocklist': 'host-application',
  'setup/mc-10-content-installation-and-rescan': 'host-application',
  'setup/ns-12-apply-customization-at-creation': 'no-subsystem',
  'setup/nt-3-round-trip-update-by-re-sending': 'no-subsystem',
  'setup/cc-3-the-advanced-color-selector': 'no-subsystem',
  'setup/cu-2-the-customization-tabs': 'no-subsystem',
  'setup/cu-3-storing-renaming-and-deleting-customization-settings': 'no-subsystem',
  'setup/cu-5-appearance-preferences-are-not-part-of-customization': 'no-subsystem',
  'setup/go-6-network-remote-control-discovery': 'host-application',
  'setup/ao-1-the-tab-cross-reference': 'round-up',
  'setup/ro-1-the-safety-options-dialog': 'no-subsystem',
  'setup/ro-4-open-with-options': 'host-application',
  'setup/ro-5-document-profiling': 'no-subsystem',
  'setup/13.6-advanced-synchronization-tab': 'no-subsystem',

  // ---- shortcuts ---------------------------------------------------------
  //
  // Seventeen rows of browser drag-and-drop modifiers. Every one is a gesture
  // with a modifier held, which is the definition of something a grep cannot
  // see and a pointer can.
  'shortcuts/2.11-browser-presets-and-drag-and-drop-modifiers': 'interaction',
};

/**
 * Sections that state verdicts without making a claim about this repository.
 *
 * One so far. `Part 4 — Counts` is the shortcuts chapter counting *itself*: how
 * many harvested shortcuts fell into each bucket. Its denominator is shortcuts
 * (204, including eight `N/A` rows and thirteen MotionLab-only bindings that
 * carry no verdict at all), where the enumerator's is verdicts — so the two
 * numbers are not the same measurement and reconciling them would be arithmetic
 * dressed as a check.
 */
export const NARRATIVE = {
  'shortcuts/part-4-counts':
    'counts of the chapter itself over a different denominator; see the note beside it',
};

/**
 * A filename the audit *proposes* rather than cites.
 *
 * `armActions.ts` is named in a "Fix shape:" sentence — "the arm action should
 * route through an `armActions.ts` sibling of `monitorActions.ts`". It has
 * never existed, and the citation checker was right to notice that it does not:
 * a reader cannot tell a proposal from a reference by the backticks alone.
 * Listed so that the difference is written down rather than inferred, and so a
 * genuinely renamed file cannot hide in the same shape.
 */
export const PROPOSED = {
  'armActions.ts': 'recording §5.2 proposes it as the home for a monitor-follows-arm action',
};
