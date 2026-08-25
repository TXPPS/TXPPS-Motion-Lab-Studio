/**
 * The store contracts and exported actions the sweep drives by hand.
 *
 * Directive 11 §3, and the reason this file is written rather than generated:
 * `setTrack(id, patch)` has no generic patch, `moveClip(id, start, trackId)` has
 * no generic destination, and inventing one would be inventing the test. A
 * generated invocation would call every action with plausible-looking rubbish,
 * observe that something changed, and report coverage of a behaviour nobody
 * specified.
 *
 * So each entry names what it does and what must change as a result. `changes`
 * is checked against `changedParts`, so a case that alters the project passes
 * only if the project's digest actually moved — the difference between a test
 * and a smoke test.
 *
 * **This table is deliberately incomplete.** 268 of the Ledger's rows are store
 * contracts and exported actions; what is here is the subset worth having
 * properly, and the rest stay FAIL until somebody writes them. FAIL is the
 * honest state for a function nobody has driven, and filling the column with
 * cases that assert nothing would be worse than the FAIL it replaced.
 *
 * A case body runs inside the page, so it can only use what is on `__ml`.
 */

/** Shorthand: the store, and a track or clip from the fixture. */
const PRELUDE = `
  const st = () => window.__ml.projectStore.getState();
  const ui = () => window.__ml.uiStore.getState();
  // The instrument track that carries an insert, not merely the first one.
  // The fixture appends to the demo project, so the first instrument track is
  // one of the demo's and has no effects; three cases threw on \`effects[0]\`.
  const inst = st().project.tracks.find((t) => t.type === 'instrument' && (t.effects ?? []).length > 0)
    ?? st().project.tracks.find((t) => t.type === 'instrument');
  const audio = st().project.tracks.find((t) => t.type === 'audio');
  const clip = st().project.clips[0];
`;

/** A case, with its body wrapped so every one starts from the same handles. */
const c = (id, changes, body) => ({
  id,
  changes,
  body: new Function(`return async () => {${PRELUDE}${body}}`)(),
});

export const CASES = [
  // ------------------------------------------------------------------ tracks
  c(
    'store:projectStore.addTrack',
    ['project'],
    `
    const before = st().project.tracks.length;
    const id = st().addTrack('audio');
    return \`\${before} -> \${st().project.tracks.length} tracks, id \${id}\`;
  `,
  ),
  c(
    'store:projectStore.duplicateTrack',
    ['project'],
    `
    const before = st().project.tracks.length;
    st().duplicateTrack(inst.id);
    return \`\${before} -> \${st().project.tracks.length} tracks\`;
  `,
  ),
  c(
    'store:projectStore.deleteTrack',
    ['project'],
    `
    const before = st().project.tracks.length;
    st().deleteTrack(audio.id);
    return \`\${before} -> \${st().project.tracks.length} tracks\`;
  `,
  ),
  c(
    'store:projectStore.setTrack',
    ['project'],
    `
    st().setTrack(inst.id, { name: 'Soak renamed', volume: 0.42 });
    const t = st().project.tracks.find((x) => x.id === inst.id);
    return \`name "\${t.name}", volume \${t.volume}\`;
  `,
  ),
  c(
    'store:projectStore.setInstrument',
    ['project'],
    `
    st().setInstrument(inst.id, 'quick');
    return 'instrument now ' + st().project.tracks.find((x) => x.id === inst.id).instrument?.kind;
  `,
  ),
  c(
    'store:projectStore.setSynthParams',
    ['project'],
    `
    st().setInstrument(inst.id, 'synth');
    st().setSynthParams(inst.id, { cutoff: 0.31 });
    return 'cutoff ' + st().project.tracks.find((x) => x.id === inst.id).synth?.cutoff;
  `,
  ),
  c(
    'store:projectStore.moveTrack',
    ['project'],
    `
    const order = st().project.tracks.map((t) => t.id).join(',');
    st().moveTrack(st().project.tracks[0].id, 2);
    return order + ' -> ' + st().project.tracks.map((t) => t.id).join(',');
  `,
  ),

  // ------------------------------------------------------------------- clips
  c(
    'store:projectStore.addMidiClip',
    ['project'],
    `
    const before = st().project.clips.length;
    st().addMidiClip(inst.id, 8, 4);
    return \`\${before} -> \${st().project.clips.length} clips\`;
  `,
  ),
  c(
    'store:projectStore.moveClip',
    ['project'],
    `
    const was = clip.start;
    st().moveClip(clip.id, was + 4);
    return \`start \${was} -> \${st().project.clips.find((x) => x.id === clip.id).start}\`;
  `,
  ),
  c(
    'store:projectStore.resizeClip',
    ['project'],
    `
    st().resizeClip(clip.id, clip.start, 7);
    return 'length ' + st().project.clips.find((x) => x.id === clip.id).length;
  `,
  ),
  c(
    'store:projectStore.duplicateClip',
    ['project'],
    `
    const before = st().project.clips.length;
    st().duplicateClip(clip.id);
    return \`\${before} -> \${st().project.clips.length} clips\`;
  `,
  ),
  c(
    'store:projectStore.deleteClip',
    ['project'],
    `
    const before = st().project.clips.length;
    st().deleteClip(clip.id);
    return \`\${before} -> \${st().project.clips.length} clips\`;
  `,
  ),
  c(
    'store:projectStore.splitClip',
    ['project'],
    `
    const before = st().project.clips.length;
    st().splitClip(clip.id, clip.start + 2);
    return \`\${before} -> \${st().project.clips.length} clips\`;
  `,
  ),
  c(
    'store:projectStore.setClip',
    ['project'],
    `
    st().setClip(clip.id, { name: 'Soak clip' });
    return 'name ' + st().project.clips.find((x) => x.id === clip.id).name;
  `,
  ),
  c(
    'store:projectStore.deleteClips',
    ['project'],
    `
    const before = st().project.clips.length;
    st().deleteClips([clip.id]);
    return \`\${before} -> \${st().project.clips.length} clips\`;
  `,
  ),
  c(
    'store:projectStore.moveClipsBy',
    ['project'],
    `
    const was = clip.start;
    st().moveClipsBy([clip.id], 2);
    return \`start \${was} -> \${st().project.clips.find((x) => x.id === clip.id).start}\`;
  `,
  ),

  // ----------------------------------------------------------------- effects
  c(
    'store:projectStore.addEffect',
    ['project'],
    `
    const before = (st().project.tracks.find((x) => x.id === inst.id).effects ?? []).length;
    st().addEffect(inst.id, 'reverb');
    const after = st().project.tracks.find((x) => x.id === inst.id).effects.length;
    return \`\${before} -> \${after} inserts\`;
  `,
  ),
  c(
    'store:projectStore.removeEffect',
    ['project'],
    `
    const t = st().project.tracks.find((x) => x.id === inst.id);
    const before = t.effects.length;
    st().removeEffect(inst.id, t.effects[0].id);
    return \`\${before} -> \${st().project.tracks.find((x) => x.id === inst.id).effects.length}\`;
  `,
  ),
  c(
    'store:projectStore.setEffectParam',
    ['project'],
    `
    const t = st().project.tracks.find((x) => x.id === inst.id);
    const fx = t.effects[0];
    const key = Object.keys(fx.params)[0];
    const was = fx.params[key];
    st().setEffectParam(inst.id, fx.id, key, typeof was === 'number' ? was * 0.5 + 0.1 : was);
    const now = st().project.tracks.find((x) => x.id === inst.id).effects[0].params[key];
    return \`\${key}: \${was} -> \${now}\`;
  `,
  ),
  c(
    'store:projectStore.setEffectBypass',
    ['project'],
    `
    const fx = st().project.tracks.find((x) => x.id === inst.id).effects[0];
    st().setEffectBypass(inst.id, fx.id, !fx.bypass);
    const now = st().project.tracks.find((x) => x.id === inst.id).effects[0].bypass;
    return \`bypass \${fx.bypass} -> \${now}\`;
  `,
  ),

  // ---------------------------------------------------------------- undo/redo
  c(
    'store:projectStore.undo',
    // A round trip nets out, so the stack that *keeps* the change is the one
    // that must move. Asserting on the project would be asserting that undo
    // did nothing, which it correctly did.
    ['redo'],
    `
    const before = st().project.tracks.length;
    st().addTrack('audio');
    const withTrack = st().project.tracks.length;
    st().undo();
    const after = st().project.tracks.length;
    if (withTrack !== before + 1 || after !== before) throw new Error('undo did not restore');
    return \`\${before} -> \${withTrack} -> \${after} tracks\`;
  `,
  ),
  c(
    'store:projectStore.redo',
    ['project'],
    `
    st().addTrack('audio');
    st().undo();
    const undone = st().project.tracks.length;
    st().redo();
    return \`\${undone} -> \${st().project.tracks.length} tracks after redo\`;
  `,
  ),
  c(
    'store:projectStore.update',
    ['project'],
    `
    st().update((d) => { d.bpm = 137; });
    return 'bpm ' + st().project.bpm;
  `,
  ),

  // -------------------------------------------------------------- automation
  c(
    'store:projectStore.addAutomationLane',
    ['project'],
    `
    const before = (st().project.tracks.find((x) => x.id === inst.id).automation ?? []).length;
    st().addAutomationLane(inst.id, 'volume');
    const after = (st().project.tracks.find((x) => x.id === inst.id).automation ?? []).length;
    return \`\${before} -> \${after} lanes\`;
  `,
  ),
  c(
    'store:projectStore.addAutomationPoint',
    ['project'],
    `
    st().addAutomationLane(inst.id, 'volume');
    const lane = st().project.tracks.find((x) => x.id === inst.id).automation[0];
    const before = lane.points.length;
    st().addAutomationPoint(inst.id, lane.id, 2, 0.25);
    const after = st().project.tracks.find((x) => x.id === inst.id).automation[0].points.length;
    return \`\${before} -> \${after} points\`;
  `,
  ),

  // ------------------------------------------------------------------ ui/nav
  c(
    'store:uiStore.set',
    ['ui'],
    `
    const was = ui().editorTab;
    ui().set({ editorTab: was === 'mixer' ? 'piano' : 'mixer' });
    return \`editorTab \${was} -> \${ui().editorTab}\`;
  `,
  ),
  c(
    'store:uiStore.selectTrack',
    ['ui'],
    `
    const was = ui().selectedTrackId;
    ui().selectTrack?.(audio.id);
    return \`selection \${was} -> \${ui().selectedTrackId}\`;
  `,
  ),

  // The transport is not here. It has no ledger row: `play`, `stop` and `seek`
  // are engine methods rather than exports of an actions module, so a case for
  // them would name a function the ledger does not have and would read as
  // coverage of nothing. They are covered by the shortcut sweep, which is how a
  // user reaches them anyway.
];
