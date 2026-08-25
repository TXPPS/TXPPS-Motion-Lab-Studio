/**
 * The editor tab strip and the editor it selects, without any one layout's
 * chrome.
 *
 * Directive 11 §5. Eight editors are declared in `app/editors.ts` — mixer,
 * piano roll, drums, score, audio, chords, instrument, diagnostics — and the
 * desktop reached all eight through `BottomEditor`'s tab strip while a phone
 * and a tablet each mounted `<PianoRoll />` and nothing else. Five of them were
 * therefore on a desktop and on nothing smaller, which is the directive's
 * definition of a defect: layout may differ, capability may not.
 *
 * The fix is to share the *registry*, not the widget. This holds the two parts
 * every layout needs and none of the parts only one of them wants: the desktop
 * keeps its maximise and collapse buttons in `BottomEditor`, and a phone gets a
 * strip that scrolls sideways under a thumb. Adding a ninth editor stays one
 * entry in one file, and it now appears on every form factor at once rather
 * than on the desktop and nowhere else.
 *
 * `exclude` is how a layout says it already reaches an editor another way — a
 * phone has Mix and Perform in its bottom navigation, so offering them again in
 * the editor strip would be two routes to one place and would push the note
 * editors off the end of a 390 px row. It is a layout's own statement about its
 * own navigation rather than a special case about which editor is which: the
 * body falls back to the first editor still offered, so excluding the one that
 * happened to be selected shows a note editor rather than an empty panel.
 */
import { Suspense } from 'react';
import { EDITORS } from '../../app/editors';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

/**
 * The tabs, as a `tablist`.
 *
 * `display: contents` on the role wrapper so a caller can put its own controls
 * in the same flex row without the tablist claiming them — which is what the
 * desktop does with its maximise and collapse buttons.
 */
export function EditorTabs({ exclude = [] }: { exclude?: readonly string[] }) {
  const tab = useUiStore((s) => s.editorTab);
  const project = useProjectStore((s) => s.project);
  const trackId = useUiStore((s) => s.selectedTrackId);
  const clipId = useUiStore((s) => s.editClipId);
  const selection = { trackId, clipId };

  return (
    <div role="tablist" aria-label="Editor" style={{ display: 'contents' }}>
      {EDITORS.filter((e) => !exclude.includes(e.id)).map((e) => {
        const ok = e.appliesTo ? e.appliesTo(project, selection) : true;
        return (
          <button
            key={e.id}
            className={`tab${tab === e.id ? ' on' : ''}${ok ? '' : ' dim'}`}
            role="tab"
            id={`editor-tab-${e.id}`}
            aria-controls="editor-panel"
            aria-selected={tab === e.id}
            title={ok ? e.hint : (e.unavailable ?? e.hint)}
            onClick={() => useUiStore.getState().set({ editorTab: e.id })}
            data-testid={`editor-tab-${e.id}`}
          >
            <Icon name={e.icon} size={12} />
            <span>{e.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The editor `editorTab` names, lazily loaded like every other. */
export function EditorBody({ exclude = [] }: { exclude?: readonly string[] }) {
  const tab = useUiStore((s) => s.editorTab);
  const offered = EDITORS.filter((e) => !exclude.includes(e.id));
  const active = offered.find((e) => e.id === tab) ?? offered[0] ?? EDITORS[0];
  const Body = active.component;
  return (
    <div
      className="editor-body"
      role="tabpanel"
      id="editor-panel"
      aria-labelledby={`editor-tab-${tab}`}
      tabIndex={0}
    >
      <Suspense fallback={<div className="page-loading">Loading…</div>}>
        <Body />
      </Suspense>
    </div>
  );
}

/**
 * Both, for a layout that wants the editor and none of the desktop's furniture.
 *
 * The strip scrolls sideways rather than wrapping or shrinking: eight tabs do
 * not fit across a phone, and the two ways of making them fit are both worse
 * than a scroll — wrapping steals a second row from the editor itself, and
 * shrinking puts every tab under the touch minimum.
 */
export function EditorSurface({ exclude = [] }: { exclude?: readonly string[] }) {
  return (
    <div className="editor-panel" data-testid="editor-surface">
      <div className="editor-tabs editor-tabs-scroll">
        <EditorTabs exclude={exclude} />
      </div>
      <EditorBody exclude={exclude} />
    </div>
  );
}
