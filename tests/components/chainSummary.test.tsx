/**
 * The row that stands where the rack cannot, and what it owes the rack.
 *
 * Phase B of the strip redesign takes the device rack off the console below the
 * tier where its 140 px floor fits a 131 px strip, and puts this in its place.
 * Substituting a small control for a large one is WCAG 2.5.8's
 * equivalent-alternative provision, and the provision obliges the alternative
 * to carry *every* command the small control offered — so the interesting
 * assertions here are not about dots. They are that pressing it lands somewhere
 * that can actually edit the chain, for every channel on the desk, the master
 * included.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChainSummary } from '../../src/components/mixer/ChainSummary';
import { ChannelEditor } from '../../src/components/channel/ChannelView';
import { masterRack, trackRack } from '../../src/components/mixer/DeviceRack';
import { createEmptyProject } from '../../src/model/demoProject';
import { MASTER_ID } from '../../src/model/types';
import { useProjectStore } from '../../src/state/projectStore';
import { useUiStore } from '../../src/state/uiStore';
import { useWorkspaceStore } from '../../src/state/workspaceStore';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const project = () => useProjectStore.getState().project;
const rackFor = (id: string) => trackRack(project().tracks.find((t) => t.id === id)!);

function setup(type: 'audio' | 'instrument' = 'audio') {
  useProjectStore.getState().setProject(createEmptyProject('Desk'), { markClean: true });
  const id = useProjectStore.getState().addTrack(type);
  useProjectStore.getState().setTrack(id, { name: 'Ch' });
  useUiStore.getState().set({ selectedTrackId: null, editorTab: 'mixer', openDevice: null });
  return id;
}

describe('the chain summary', () => {
  let id = '';
  beforeEach(() => {
    id = setup();
  });

  it('draws one dot per device, coloured by family', () => {
    for (const kind of ['eq3', 'compressor', 'delay'] as const) {
      useProjectStore.getState().addEffect(id, kind);
    }
    render(<ChainSummary rack={rackFor(id)} />);
    const dots = screen.getByTestId('chain-Ch').querySelectorAll('.chain-dot');
    expect(dots).toHaveLength(3);
    // Family, not kind: the console's question is what KIND of chain this is,
    // read across twenty channels at a glance.
    expect([...dots].map((d) => d.className)).toEqual([
      'chain-dot fam-tone',
      'chain-dot fam-dynamics',
      'chain-dot fam-time',
    ]);
  });

  it('counts what it has no room to draw rather than dropping it', () => {
    // The strip's insert rack once showed four devices and summarised the rest
    // silently, which is the one place a channel lied about itself.
    for (const kind of [
      'eq3',
      'compressor',
      'delay',
      'reverb',
      'saturator',
      'width',
      'chorus',
      'gate',
    ] as const) {
      useProjectStore.getState().addEffect(id, kind);
    }
    render(<ChainSummary rack={rackFor(id)} />);
    expect(screen.getByTestId('chain-Ch').querySelectorAll('.chain-dot')).toHaveLength(6);
    expect(screen.getByTestId('chain-Ch').textContent).toContain('+2');
  });

  it('counts an instrument as part of the chain', () => {
    // An instrument channel with no inserts is not an empty channel, and a
    // summary that said so would be describing something that plays nothing.
    const inst = useProjectStore.getState().addTrack('instrument');
    useProjectStore.getState().setTrack(inst, { name: 'Keys' });
    render(<ChainSummary rack={rackFor(inst)} />);
    const dots = screen.getByTestId('chain-Keys').querySelectorAll('.chain-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0].className).toContain('fam-instrument');
  });

  it('says so when there is nothing on the channel', () => {
    render(<ChainSummary rack={rackFor(id)} />);
    expect(screen.getByTestId('chain-Ch').textContent).toContain('Insert');
    expect(screen.getByTestId('chain-Ch').getAttribute('aria-label')).toContain('nothing inserted');
  });

  it('opens the channel end to end, on the channel it names', () => {
    useProjectStore.getState().addEffect(id, 'eq3');
    useWorkspaceStore.setState({ showEditor: false });
    render(<ChainSummary rack={rackFor(id)} />);
    fireEvent.click(screen.getByTestId('chain-Ch'));
    expect(useUiStore.getState().selectedTrackId).toBe(id);
    expect(useUiStore.getState().editorTab).toBe('channel');
    // Revealed, not merely navigated to: the tab is useless behind a pane that
    // is switched off, and `reveal` is the one call that steps out of another
    // pane's full screen as well as turning this one on.
    expect(useWorkspaceStore.getState().showEditor).toBe(true);
  });
});

describe('the master is a channel like any other', () => {
  beforeEach(() => {
    setup();
  });

  it('summarises the master chain and opens it', () => {
    useProjectStore.getState().addMasterEffect('compressor');
    render(<ChainSummary rack={masterRack(project().master?.effects ?? [])} />);
    expect(screen.getByTestId('chain-Master').querySelectorAll('.chain-dot')).toHaveLength(1);
    fireEvent.click(screen.getByTestId('chain-Master'));
    expect(useUiStore.getState().selectedTrackId).toBe(MASTER_ID);
    expect(useUiStore.getState().editorTab).toBe('channel');
  });

  it('and the Channel view draws it, rather than asking which channel', () => {
    /*
     * The half that makes the substitution legitimate. The master is not a
     * member of `project.tracks`, so the editor's track lookup returns
     * `undefined` for it — and the version of this that shipped in phase A
     * would have drawn "No channel selected" over a channel that was selected.
     * The summary would then have been a control pointing at a surface that
     * refused to show what it was pointing at, which is a route in the same
     * sense a locked door is one.
     */
    useProjectStore.getState().addMasterEffect('compressor');
    useUiStore.getState().selectTrack(MASTER_ID);
    render(<ChannelEditor />);
    expect(screen.queryByTestId('channel-view-empty')).toBeNull();
    expect(screen.getByTestId('channel-view').getAttribute('aria-label')).toBe('Master channel');
    // The rack itself, not a picture of it: the device is on the rail and its
    // own controls are there.
    expect(screen.getByTestId('channel-rail').textContent).toContain('Compressor');
  });

  it('still asks which channel when none is selected', () => {
    // Non-vacuity for the case above: if the editor drew a channel whatever it
    // was given, the assertion that it draws the master would prove nothing.
    useUiStore.getState().selectTrack(null);
    render(<ChannelEditor />);
    expect(screen.getByTestId('channel-view-empty')).toBeTruthy();
  });
});
