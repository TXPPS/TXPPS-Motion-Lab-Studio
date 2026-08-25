/**
 * A corrected probe is not believed until the correction has been mutated.
 *
 * Twenty-four probe defects have been found and fixed across the stress
 * harness, the reachability sweep and the bypass localiser, and every one was
 * diagnosed properly. That is the problem. "Suspect the probe first" is a good rule that decays into
 * "assume the probe", and at the point it has decayed, a correction that
 * quietly *widens* a check is indistinguishable from one that fixes it — both
 * make the red go away, which is the only signal anybody looks at.
 *
 * So each correction keeps the defect it replaced, executable, beside it:
 *
 *     const PREFIXES = unless(
 *       'reach/route-discovery',
 *       ['nav-', 'editor-tab-', 'combo-', 'page-'],   // what it does
 *       ['nav-', 'editor-tab-'],                      // what it did
 *     );
 *
 * `npm run probe:mutations` runs the probe once per registry entry with that
 * entry's defect restored, and asserts the measurement gets *worse*. A
 * correction whose defect no longer changes the answer is not load-bearing:
 * either the product changed and the correction is now moot, or the correction
 * was a widening and never caught anything. Both need a person, and both are
 * silent without this.
 *
 * Two properties make it hard to let rot:
 *
 *  - The defect lives at the correction site, not in a test file. Deleting the
 *    correction deletes its mutation, and a registry entry with no call site
 *    fails `--check` in the build.
 *  - The comparison is differential and same-scope: baseline and mutant run the
 *    same reduced sweep, so a slow machine or a flaky route moves both.
 *
 * The registry below is the standing record of every probe correction made.
 */

/** The mutation this run is carrying, if any. Empty for a normal run. */
export const ACTIVE = process.env.MW_PROBE_MUTATION ?? '';

/**
 * `corrected` normally; `broken` when this mutation is the active one.
 *
 * The argument order is deliberate: the correction reads first, so the call
 * site says what the probe does and then what it used to do. Reversed, every
 * probe would read as a list of its own bugs.
 */
export function unless(id, corrected, broken) {
  return ACTIVE === id ? broken : corrected;
}

/** For a correction that is a step rather than a value: skip the step. */
export function mutated(id) {
  return ACTIVE === id;
}

/**
 * Every probe correction, with the defect it replaced and what that defect
 * cost when it was live.
 *
 * `scope` is what the driver runs — one form factor and a handful of targets,
 * or one stress section — because the full sweeps are four minutes each and
 * thirteen of those is not something anybody would run. Scoping is applied to
 * baseline and mutant alike, so it cannot flatter either.
 *
 * `expect` is the direction the measurement must move. `fewer` and `more` are
 * both real: a probe can fail by under-reporting (a route it never found) or by
 * over-reporting (reaching a surface through the store, which no thumb can do).
 */
export const MUTATIONS = [
  // ------------------------------------------------------------------ bypass
  {
    id: 'bypass/range-in-beats',
    probe: 'bypass',
    correction: 'The render range is given in beats, which is what `RenderRange` is.',
    defect: 'Give it in seconds, as `{ startSec, endSec }`.',
    cost:
      'Silently ignored, so a probe that described a two second render rendered the whole ' +
      'seventeen second project. The same mistake was live in three soak layers and in the ' +
      'end-to-end suite, where nothing type-checked it.',
    scope: { kinds: 'reverb' },
    metric: 'samples rendered',
    expect: 'differs',
  },
  {
    id: 'bypass/full-resolution',
    probe: 'bypass',
    correction: 'Every sample is compared.',
    defect: 'Compare every eighth, as the property did.',
    cost:
      'A decimation with no anti-alias filter in front of it: any difference above 2.7 kHz ' +
      'folds down to a frequency it is not at. The difference this probe was built to ' +
      'characterise could have been anywhere in the band.',
    scope: { kinds: 'reverb' },
    metric: 'samples compared',
    expect: 'differs',
  },
  {
    id: 'bypass/isolate-track',
    probe: 'bypass',
    correction: 'The affected track is rendered alone.',
    defect: 'Render the whole mix, as the property did.',
    cost:
      'Diluted a level ratio of exactly 1.414214 to 1.0331 — a number that matches no clean ' +
      'hypothesis, and against which two wrong guesses were tried and reverted before anybody ' +
      'localised the difference.',
    scope: { kinds: 'reverb' },
    metric: 'dry rms',
    expect: 'differs',
  },
  {
    id: 'bypass/preload-context',
    probe: 'bypass',
    correction: 'The decode context `preloadForRender` requires is passed to it.',
    defect: 'Omit it, as every untyped caller in the harness did.',
    cost:
      'None yet, on this fixture. `loadBuffer` was being handed `undefined` to decode into, ' +
      'which is unreachable while every media id is already in the cache.',
    scope: { kinds: 'reverb' },
    metric: 'dry rms',
    expect: 'unfalsifiable',
    unfalsifiableBecause:
      'The app decodes the fixture before the probe runs, so `getBufferSync` short-circuits ' +
      'every id and the context is never reached on this host. It is supplied because the ' +
      'first fixture carrying an undecoded import would decode into undefined and render ' +
      'silence where the audio is — and would do it without an error.',
  },
  // ------------------------------------------------------------ reachability
  {
    id: 'reach/route-discovery',
    probe: 'reachability',
    correction: 'Routes are discovered from a list of naming conventions the shell uses.',
    defect: 'Know only the phone nav and the desktop editor tabs, as the first version did.',
    cost: 'The tablet reported one route and eight surfaces unreachable behind combo-* controls.',
    scope: { forms: 'tablet-portrait' },
    expect: 'fewer',
  },
  {
    id: 'reach/openers',
    probe: 'reachability',
    correction: 'Named sheet openers count as routes.',
    defect: 'Count only prefixed navigation.',
    cost: 'Settings and diagnostics read as unreachable on a phone.',
    scope: { forms: 'phone-portrait', targets: 'settings,diagnostics,shortcuts' },
    expect: 'fewer',
  },
  {
    id: 'reach/select-track',
    probe: 'reachability',
    correction: 'Routes are walked once per track kind with a selection held.',
    defect: 'Walk the routes once, with nothing selected.',
    cost: 'Nine surfaces read as unreachable on every form factor including desktop.',
    scope: { forms: 'desktop', targets: 'notefx-rack,notefx-add,zone-editor,sends,insert-rack' },
    expect: 'fewer',
  },
  {
    id: 'reach/tap-to-select',
    probe: 'reachability',
    correction: 'A track is selected by tapping its header.',
    defect: 'Select it by calling the store, which is what the first version did.',
    cost: 'Four surfaces counted as reachable on a phone through a route no thumb has.',
    scope: { forms: 'phone-portrait', targets: 'notefx-rack,notefx-add,zone-editor,inspector' },
    exercisedBy: 'counter:tapFailures',
    expect: 'more',
  },
  {
    id: 'reach/header-by-name',
    probe: 'reachability',
    correction: 'Track headers are found by the track name, which is what their test id carries.',
    defect: 'Look them up by track id.',
    cost: 'Every selection-dependent surface read as unreachable, on every form factor.',
    scope: { forms: 'desktop', targets: 'notefx-rack,notefx-add,zone-editor,drum-editor' },
    expect: 'fewer',
  },
  {
    id: 'reach/header-corner',
    probe: 'reachability',
    correction: 'A header is tapped at its top-left corner.',
    defect: 'Tap its centre.',
    cost: 'The centre is the mute/solo/arm cluster, which swallows the click; nothing selected.',
    scope: { forms: 'desktop', targets: 'notefx-rack,notefx-add,zone-editor,drum-editor' },
    expect: 'fewer',
  },
  {
    id: 'reach/dismiss-modals',
    probe: 'reachability',
    correction: 'Escape twice before hunting for a header.',
    defect: 'Start hunting with whatever the route walk left open.',
    cost: 'A sheet intercepts every click, each throw is swallowed, every selection comes back null.',
    scope: { forms: 'phone-portrait', targets: 'notefx-rack,notefx-add,zone-editor' },
    expect: 'fewer',
  },
  {
    id: 'reach/back-to-song',
    probe: 'reachability',
    correction: 'Return to the Song page before looking for track headers.',
    defect: 'Look from wherever the route walk ended.',
    cost: 'It ends on Mastering, which has no track list; the count of headers read zero.',
    scope: { forms: 'desktop', targets: 'notefx-rack,notefx-add,zone-editor,drum-editor' },
    expect: 'fewer',
  },
  {
    id: 'reach/scroll-into-view',
    probe: 'reachability',
    correction: 'Scroll a header into view before deciding it is not there.',
    defect: 'Treat a header below the fold as absent.',
    cost: 'The instrument track sat off-screen in the fixture; everything needing it read unreachable.',
    // The widest phone scope there is, and the counter still reads zero: every
    // header this sweep looks for is on screen when it looks. The correction is
    // plainly right and this host gives it nothing to do, which is BLOCKED
    // rather than decayed — a distinction worth more than a green line.
    scope: {
      forms: 'phone-portrait',
      targets: 'notefx-rack,zone-editor,sends,cue-mix,freeze,sampler,groove,take-review',
    },
    exercisedBy: 'counter:scrolls',
    expect: 'fewer',
  },
  {
    id: 'reach/reassert-selection',
    probe: 'reachability',
    correction: 'The selection is re-asserted before each route.',
    defect: 'Select once at the start of the walk.',
    cost: 'Record mode reassigns the selection, so the walk arrived holding the wrong track.',
    // A phone, and a wide target set: this is the scope where Record mode
    // actually gets a chance to steal the selection, and the counter reads
    // seven re-assertions in it.
    scope: {
      forms: 'phone-portrait',
      targets: 'notefx-rack,zone-editor,sends,cue-mix,freeze,sampler,groove,take-review',
    },
    exercisedBy: 'counter:reasserts',
    expect: 'unfalsifiable',
    unfalsifiableBecause:
      'exercised seven times in this scope and the reachable count does not move. The ' +
      'long-press and right-click menu walks added later select a track on their way in, ' +
      'so the selection is re-established whether or not the route walk re-asserts it. ' +
      'The behaviour is kept because it is right; the claim that it is load-bearing is not.',
  },
  {
    id: 'reach/nested-routes',
    probe: 'reachability',
    correction: 'Routes are re-discovered after arriving somewhere.',
    defect: 'Discover them once at start-up.',
    cost: 'The phone editor strip does not exist until Edit mode; four editors read as unreachable.',
    scope: { forms: 'phone-portrait', targets: 'drum-editor,score-view,audio-editor,chords' },
    expect: 'fewer',
  },
  {
    id: 'reach/menu-items',
    probe: 'reachability',
    correction: 'A menu a route opened is walked, entry by entry.',
    defect: 'Click the overflow control and look.',
    cost: 'Preferences, diagnostics and the shortcut sheet all read as phone defects.',
    scope: { forms: 'phone-portrait', targets: 'settings,diagnostics,shortcuts' },
    expect: 'fewer',
  },
  {
    id: 'reach/long-press-touch',
    probe: 'reachability',
    correction: 'The long press is a PointerEvent whose pointerType is touch.',
    defect: 'Press with the mouse API, which is what Playwright sends on a touch device.',
    cost: 'longPress returns immediately for a mouse; automation lanes read as a mobile defect.',
    scope: { forms: 'phone-portrait', targets: 'automation-lane' },
    expect: 'fewer',
  },
  {
    id: 'reach/open-midi-clip',
    probe: 'reachability',
    correction: 'A MIDI clip is opened by double-clicking one.',
    defect: 'Never open a clip.',
    cost: 'Four editors declare appliesTo: isMidiClipOpen and correctly refuse to render.',
    scope: { forms: 'desktop', targets: 'piano-roll,drum-editor,score-view,audio-editor' },
    exercisedBy: 'via:with a MIDI clip open',
    expect: 'fewer',
  },

  // ------------------------------------------------------------------ stress
  {
    id: 'stress/awaited-ops',
    probe: 'stress',
    correction: 'Transport operations are awaited, one per frame.',
    defect: 'Fire them unawaited in a tight loop.',
    cost: 'Reported 284,000 operations per second — the rate a for loop discards promises at.',
    scope: { section: 'transport' },
    metric: 'transport ops',
    expect: 'more',
  },
  {
    id: 'stress/forced-gc',
    probe: 'stress',
    correction: 'Three collections are forced before the heap is sampled.',
    defect: 'Sample the heap as it is.',
    cost: 'Reported a heap that had shrunk by 79 MB, which is a measurement of the collector.',
    scope: { section: 'sustained' },
    metric: 'retained heap growth',
    expect: 'differs',
  },
  {
    id: 'stress/quiescence',
    probe: 'stress',
    correction: 'Wait for the source count to reach zero, and report how long it took.',
    defect: 'Sleep 500 ms and count what is left.',
    cost: 'Reported 76 sources still running and read as a leak; the stop is clamped to the start.',
    // Under load, because that is the condition the defect needed. On an empty
    // project half a second is enough and the mutant looks fine, which is a
    // scope that exonerates the defect rather than a correction that decayed.
    scope: { section: 'scaling,transport' },
    metric: 'time to quiescence',
    expect: 'fails',
  },
  {
    id: 'stress/confirmed-ceiling',
    probe: 'stress',
    correction: 'Two consecutive over-budget samples before the ceiling counts.',
    defect: 'Take the first over-budget sample.',
    cost: 'Three runs of the same build reported 276, 408 and 276 tracks.',
    // A tight budget, because this machine carries four hundred tracks inside
    // two refreshes: the confirmation branch never runs at the real budget, and
    // both sides then report the loop bound rather than a ceiling.
    scope: { section: 'scaling', frameBudgetMs: 18 },
    metric: 'tracks at the frame ceiling',
    exercisedBy: 'ceiling candidates rejected',
    expect: 'fewer',
  },
  {
    id: 'stress/loop-cap',
    probe: 'stress',
    correction: 'The sweep is bounded at 400 tracks.',
    defect: 'Bound it at 64, which is where the first version stopped.',
    cost: 'It reported its own loop bound as the product ceiling.',
    scope: { section: 'scaling' },
    metric: 'tracks at the frame ceiling',
    expect: 'fewer',
  },
  {
    id: 'stress/drumkit-branch',
    probe: 'stress',
    correction: 'A drum track set to the synth kind is built, which is the DrumKit branch.',
    defect: 'Build only the three instruments that have a kind string of their own.',
    cost: 'One of the four instrument classes was never sent a note.',
    scope: { section: 'notes' },
    metric: 'instruments driven',
    expect: 'fewer',
  },
];

/** Every id the registry knows, for the driver and the static guard. */
export const MUTATION_IDS = MUTATIONS.map((m) => m.id);
