import { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useViewport } from '../../hooks/useViewport';
import { useUiStore } from '../../state/uiStore';
import type { EditorId } from '../../app/editorIds';
import { useWorkspaceStore } from '../../state/workspaceStore';
import { Arrangement } from '../arrangement/Arrangement';
import { BrowserPanel } from '../browser/BrowserPanel';
import { Inspector } from '../inspector/Inspector';
import { Mixer } from '../mixer/Mixer';
import { SynthPanel } from '../synth/SynthPanel';
import { TransportBar } from '../transport/TransportBar';
import { Icon } from '../common/Icon';
import { MaximizeButton } from './MaximizeButton';
import { EditorSurface } from './EditorSurface';

type Combo = 'mixer' | 'piano' | 'synth';

const COMBOS: { id: Combo; label: string }[] = [
  { id: 'mixer', label: 'Mixer' },
  { id: 'piano', label: 'Piano Roll' },
  { id: 'synth', label: 'Instrument' },
];

/**
 * Tablet: the arrangement is primary, paired with exactly one bottom panel.
 * Side panels are drawers (one at a time) rather than persistent columns,
 * so browser + inspector + arrangement + editor never compete for width.
 *
 * Full screen removes the forced split: maximizing the editor gives a true
 * single-editor workflow (the combo bar stays, so Mixer/Piano/Instrument
 * switch while full screen); maximizing the arrangement hides the bottom
 * panel. The split restores exactly when full screen exits.
 */
/**
 * A tablet drawer: the browser on the left, the inspector on the right.
 *
 * It had a scrim and a click-outside and nothing else — no `role="dialog"`, no
 * `aria-modal`, no focus trap and **no Escape**. It covers the workspace and
 * takes the pointer, so it is a modal in every way that matters to the person
 * using it; a keyboard user could tab straight through it into an arrangement
 * they could not see, and had no key that would close it. On a tablet that is
 * a pane that will not go away, which is exactly how it was reported.
 */
function Drawer({
  side,
  onClose,
  children,
}: {
  side: 'browser' | 'inspector';
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Captured, so the drawer closes before anything behind it reads the key
      // — Escape in the arrangement clears a selection the user cannot see.
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const title = side === 'browser' ? 'Browser' : 'Inspector';
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside
        ref={ref}
        className={`drawer side-panel ${side === 'browser' ? 'left' : 'right'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={`drawer-${side}`}
      >
        <div className="panel-title">
          {title}
          <span className="spacer" style={{ flex: '1 1 auto' }} />
          <button className="icon-btn" onClick={onClose} aria-label="Close panel">
            <Icon name="x" size={15} />
          </button>
        </div>
        {children}
      </aside>
    </>
  );
}

export function TabletLayout() {
  /*
   * The combo is DERIVED from the editor tab rather than kept beside it.
   *
   * It was `useState`, local to this component, so nothing outside could reach
   * it — and a control that asked for an editor tab set the tab, revealed the
   * pane, and watched the pane go on drawing the mixer. The console's chain
   * summary is one; the cue bar's link to the channel is another, and it has
   * been that way since the Channel view shipped. On a phone and a desktop both
   * work, which is exactly why nobody saw it.
   *
   * `EditorSurface` already reads `editorTab` to decide *which* editor to draw,
   * so the two were coupled in one direction. Deriving closes the loop: "which
   * editor" and "is an editor showing" become one answer instead of two that
   * can disagree. `editorTab` defaults to `'mixer'`, which is what this pane
   * opened on before.
   */
  const editorTab = useUiStore((s) => s.editorTab);
  const combo: Combo = editorTab === 'mixer' ? 'mixer' : editorTab === 'synth' ? 'synth' : 'piano';
  // Which editor the Piano Roll button goes back to. Somebody who was editing a
  // clip, looked at the mixer and came back expects that clip, not a default.
  const lastEditor = useRef<EditorId>('piano');
  useEffect(() => {
    if (combo === 'piano') lastEditor.current = editorTab;
  }, [combo, editorTab]);
  const setCombo = (c: Combo) =>
    useUiStore.getState().set({
      editorTab: c === 'mixer' ? 'mixer' : c === 'synth' ? 'synth' : lastEditor.current,
    });
  const [drawer, setDrawer] = useState<null | 'browser' | 'inspector'>(null);
  const { height } = useViewport();
  const maximized = useWorkspaceStore((s) => s.maximized);
  // Browser/inspector full screen only exists on desktop; tablet treats
  // those as the normal layout (its drawers already overlay everything).
  const maxi = maximized === 'arrange' || maximized === 'editor' ? maximized : null;
  // On short tablet landscape the bottom panel starts smaller so the
  // arrangement keeps a usable number of visible lanes.
  // A stored size wins over the height heuristic: the heuristic is a starting
  // guess, and a user who has moved the divider has already answered it.
  const setSizes = useWorkspaceStore((s) => s.setSizes);
  const storedBottom = useWorkspaceStore((s) => s.tabletBottomSize);
  const defaultBottom = storedBottom > 0 ? storedBottom : height < 820 ? 32 : 40;

  const editor = (
    <div className="editor-panel" data-testid="bottom-editor">
      <div className="editor-body">
        {combo === 'mixer' && <Mixer touch />}
        {/*
          The editor combo shows whichever editor is selected, not the piano
          roll alone. Same reason as the phone: eight are declared and five of
          them were reachable on a desktop and on nothing smaller.
        */}
        {combo === 'piano' && <EditorSurface exclude={['mixer', 'synth']} />}
        {combo === 'synth' && <SynthPanel />}
      </div>
    </div>
  );

  return (
    <>
      <TransportBar />
      <div className="arr-toolbar" style={{ borderBottom: '1px solid var(--border-soft)' }}>
        <button className="btn" onClick={() => setDrawer('browser')} data-testid="tablet-browser">
          <Icon name="folder" size={13} /> Browser
        </button>
        <div className="seg" role="group" aria-label="Bottom panel" style={{ marginLeft: 4 }}>
          {COMBOS.map((c) => (
            <button
              key={c.id}
              className={combo === c.id ? 'on' : ''}
              aria-pressed={combo === c.id}
              onClick={() => setCombo(c.id)}
              data-testid={`combo-${c.id}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <MaximizeButton pane="editor" label="editor" />
        <span className="spacer" style={{ flex: '1 1 auto' }} />
        <button
          className="btn"
          onClick={() => setDrawer('inspector')}
          data-testid="tablet-inspector"
        >
          <Icon name="wrench" size={13} /> Inspector
        </button>
      </div>

      <div className="workspace" data-testid="workspace">
        {maxi === 'editor' ? (
          <div className="pane pane-maxi" data-testid="maxi-editor">
            {editor}
          </div>
        ) : maxi === 'arrange' ? (
          <div className="pane pane-maxi" data-testid="maxi-arrange">
            <Arrangement />
          </div>
        ) : (
          <Group
            orientation="vertical"
            id="pane-tablet-stack"
            style={{ width: '100%', height: '100%' }}
          >
            <Panel id="pane-arrangement" minSize="160px" className="pane">
              <Arrangement />
            </Panel>
            <Separator className="resize-handle v" />
            <Panel
              id="pane-bottom"
              defaultSize={`${defaultBottom}%`}
              minSize="140px"
              maxSize="62%"
              className="pane"
              // Persisted, as the desktop panes are. Without this the tablet
              // was the one layout where dragging a divider was forgotten on
              // every reload — the divider moved, and the next launch put it
              // back where it started.
              onResize={(size) => setSizes({ tabletBottomSize: size.asPercentage })}
            >
              {editor}
            </Panel>
          </Group>
        )}

        {drawer && (
          <Drawer side={drawer} onClose={() => setDrawer(null)}>
            {drawer === 'browser' ? <BrowserPanel /> : <Inspector />}
          </Drawer>
        )}
      </div>
    </>
  );
}
