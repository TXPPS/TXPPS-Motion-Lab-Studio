/**
 * Scratch pads.
 *
 * A pad is a parallel arrangement over the same tracks: swapping one in puts
 * its clips on the timeline and stashes the ones that were there, so trying an
 * alternative chorus never costs you the one you already had. Nothing is
 * copied and nothing is lost — the swap is symmetric, and swapping back is the
 * same gesture.
 */
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import { Icon } from '../common/Icon';

export function scratchPadMenuItems(): { label: string; action: () => void; danger?: boolean }[] {
  const store = useProjectStore.getState();
  const project = store.project;
  const pads = project.scratchPads ?? [];
  const active = project.activePadId;

  const items: { label: string; action: () => void; danger?: boolean }[] = pads.map((pad) => ({
    label: `${active === pad.id ? '● ' : ''}${pad.name} — ${pad.clips.length} clip${
      pad.clips.length === 1 ? '' : 's'
    }`,
    action: () => {
      useProjectStore.getState().swapScratchPad(pad.id);
      useUiStore
        .getState()
        .toast(
          'info',
          active === pad.id
            ? `Back to the main arrangement (“${pad.name}” kept)`
            : `Swapped in “${pad.name}” — the main arrangement is safe in the pad`,
        );
    },
  }));

  items.push({
    label: 'New pad from what is here',
    action: () => {
      useUiStore.getState().showDialog({
        kind: 'prompt',
        title: 'New scratch pad',
        message: 'A parallel arrangement over the same tracks. Swap it in to try it.',
        initialValue: `Pad ${pads.length + 1}`,
        onSubmit: (name) => {
          const id = useProjectStore.getState().createScratchPad(name);
          // A pad made "from what is here" starts as a copy, which is the
          // useful thing: you try a variation OF something, not from nothing.
          useProjectStore.getState().update((d) => {
            const pad = d.scratchPads?.find((p) => p.id === id);
            if (pad) pad.clips = d.clips.map((c) => structuredClone(c));
          });
        },
      });
    },
  });

  if (pads.length > 0) {
    items.push({
      label: 'Rename a pad…',
      action: () => {
        const pad = pads[0];
        useUiStore.getState().showDialog({
          kind: 'prompt',
          title: `Rename “${pad.name}”`,
          initialValue: pad.name,
          onSubmit: (name) => name && useProjectStore.getState().renameScratchPad(pad.id, name),
        });
      },
    });
    items.push({
      label: `Delete “${pads[pads.length - 1].name}”`,
      danger: true,
      action: () => {
        const pad = pads[pads.length - 1];
        useUiStore.getState().showDialog({
          kind: 'confirm',
          title: `Delete “${pad.name}”?`,
          message: `Its ${pad.clips.length} clip${pad.clips.length === 1 ? '' : 's'} go with it.`,
          confirmLabel: 'Delete',
          danger: true,
          onSubmit: () => useProjectStore.getState().deleteScratchPad(pad.id),
        });
      },
    });
  }

  return items;
}

/** Toolbar button: the pad list, and which one is live. */
export function ScratchPadButton() {
  // Select the stored reference, not a defaulted copy: `?? []` builds a new
  // array on every render, which zustand reads as a changed snapshot and turns
  // into an infinite update loop.
  const pads = useProjectStore((s) => s.project.scratchPads);
  const active = useProjectStore((s) => s.project.activePadId);
  const count = pads?.length ?? 0;
  const live = pads?.find((p) => p.id === active);

  return (
    <button
      className={`icon-btn${live ? ' warm-on' : ''}`}
      title={
        live
          ? `Scratch pad “${live.name}” is on the timeline — the main arrangement is safe`
          : 'Scratch pads: parallel arrangements over the same tracks'
      }
      aria-label="Scratch pads"
      onClick={(e) =>
        useUiStore.getState().showMenu({
          x: e.clientX,
          y: e.clientY,
          items: scratchPadMenuItems(),
        })
      }
      data-testid="scratch-pads"
    >
      <Icon name="scratchpad" size={14} />
      {count > 0 && <span className="t-badge">{count}</span>}
    </button>
  );
}
