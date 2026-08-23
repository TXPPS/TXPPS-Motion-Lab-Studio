/**
 * BUG-004 / BUG-005 — the note-off dispatch instrumentation.
 *
 * Directive 03 §1 asks one question before any fix: does note-off fire at all?
 * If it never fires the bug is in the input layer and the engine is innocent;
 * if it fires and the sound persists the reverse. This file answers that by
 * recording every `liveNoteOn`/`liveNoteOff` the keyboard dispatches and
 * pairing them by pitch, so an unmatched on is visible as an unmatched on
 * rather than inferred from a symptom.
 *
 * The scenarios are the ones a real finger produces and a click never does:
 * lifting outside the key, the browser cancelling the pointer for a scroll,
 * ten fingers released out of order, and the octave moving under a held note.
 */
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { engineStub } from '../setup.tsx';

vi.mock('../../src/audio/engine', async () => ({
  engine: (await import('../setup.tsx')).engineStub,
}));

const { Keyboard } = await import('../../src/components/synth/Keyboard');
const { useUiStore } = await import('../../src/state/uiStore');
const { heldNotes } = await import('../../src/audio/heldNotes');

const TRACK = { id: 't1', name: 'Keys', type: 'instrument' } as never;

/** Every note the keyboard dispatched, in order. */
function dispatched(): { on: number[]; off: number[] } {
  const calls = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls;
  return {
    on: calls(engineStub.liveNoteOn).map((c) => c[1] as number),
    off: calls(engineStub.liveNoteOff).map((c) => c[1] as number),
  };
}

/** Pitches turned on and never turned off — the stuck notes. */
function unmatched(): number[] {
  const { on, off } = dispatched();
  const remaining = [...off];
  const stuck: number[] = [];
  for (const pitch of on) {
    const i = remaining.indexOf(pitch);
    if (i === -1) stuck.push(pitch);
    else remaining.splice(i, 1);
  }
  return stuck;
}

/** Keys still drawn lit. */
function litKeys(): number[] {
  return [...document.querySelectorAll('.kbd-white.pressed, .kbd-black.pressed')].map((el) =>
    Number((el.getAttribute('data-testid') ?? '').replace('key-', '')),
  );
}

/**
 * jsdom has no `PointerEvent`. A `MouseEvent` dispatched under the pointer
 * event's name reaches the same React listeners; `pointerId`, `pointerType` and
 * `buttons` are attached after construction because `MouseEventInit` drops the
 * first two and they are exactly what this file is about — the identity a
 * release is matched to. Same substitution `instrumentFace.test.tsx` and
 * `knobUndo.test.tsx` already rely on.
 */
function pointer(
  type: string,
  target: Element,
  pointerId: number,
  extra: { buttons?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    buttons: extra.buttons ?? 0,
  });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: extra.pointerType ?? 'mouse' });
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  engineStub.reset();
  heldNotes.clearForTest();
  useUiStore.getState().set({ keyboardOctave: 3 });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('BUG-004/005 · which side of the split does the stuck note land on', () => {
  it('a press and release on the same key dispatches a matched pair', () => {
    render(<Keyboard track={TRACK} />);
    const key = screen.getByTestId('key-48');
    pointer('pointerdown', key, 1, { buttons: 1 });
    pointer('pointerup', key, 1);
    expect(dispatched().on).toEqual([48]);
    expect(dispatched().off).toEqual([48]);
    expect(unmatched()).toEqual([]);
    expect(litKeys()).toEqual([]);
  });

  it('lifting the finger away from the key never dispatches note-off', () => {
    // The gesture: press a key, slide off the keyboard, lift. `pointerup`
    // fires on whatever is under the finger, and the key never hears it.
    // `releasePointerCapture` on pointerdown — which is deliberate, so that
    // gliding fires `pointerenter` on neighbours — is what guarantees this.
    render(<Keyboard track={TRACK} />);
    const key = screen.getByTestId('key-48');
    pointer('pointerdown', key, 1, { buttons: 1, pointerType: 'touch' });
    // Lift somewhere else entirely.
    pointer('pointerup', document.body, 1, { pointerType: 'touch' });
    console.log(
      `lift-outside: on=${JSON.stringify(dispatched().on)} ` +
        `off=${JSON.stringify(dispatched().off)} stuck=${JSON.stringify(unmatched())} ` +
        `lit=${JSON.stringify(litKeys())}`,
    );
    expect(unmatched(), 'note-off was never dispatched').toEqual([]);
    expect(litKeys(), 'the key stayed lit').toEqual([]);
  });

  it('a cancelled pointer that lands on the document never dispatches note-off', () => {
    render(<Keyboard track={TRACK} />);
    const key = screen.getByTestId('key-50');
    pointer('pointerdown', key, 1, { buttons: 1, pointerType: 'touch' });
    // A scroll or a system gesture cancels the pointer. The browser fires
    // pointercancel at the capture target; with capture released that can be
    // the document rather than the key.
    pointer('pointercancel', document.body, 1, { pointerType: 'touch' });
    console.log(
      `cancel-elsewhere: stuck=${JSON.stringify(unmatched())} lit=${JSON.stringify(litKeys())}`,
    );
    expect(unmatched()).toEqual([]);
    expect(litKeys()).toEqual([]);
  });

  it('ten fingers released out of order all clear', () => {
    render(<Keyboard track={TRACK} />);
    const pitches = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64];
    pitches.forEach((p, i) =>
      pointer('pointerdown', screen.getByTestId(`key-${p}`), i + 1, {
        buttons: 1,
        pointerType: 'touch',
      }),
    );
    // Released in reverse, and on the key each finger is actually over.
    [...pitches].reverse().forEach((p) => {
      const id = pitches.indexOf(p) + 1;
      pointer('pointerup', screen.getByTestId(`key-${p}`), id, { pointerType: 'touch' });
    });
    console.log(
      `ten-fingers: stuck=${JSON.stringify(unmatched())} lit=${JSON.stringify(litKeys())}`,
    );
    expect(unmatched()).toEqual([]);
    expect(litKeys()).toEqual([]);
  });

  it('a note held across an octave change still releases', () => {
    render(<Keyboard track={TRACK} />);
    pointer('pointerdown', screen.getByTestId('key-48'), 1, { buttons: 1, pointerType: 'touch' });
    act(() => {
      useUiStore.getState().set({ keyboardOctave: 5 });
    });
    // The finger is still down. It lifts over whatever key is there now.
    const anyKey = document.querySelector('.kbd-white') as Element;
    pointer('pointerup', anyKey, 1, { pointerType: 'touch' });
    console.log(
      `octave-shift: on=${JSON.stringify(dispatched().on)} ` +
        `off=${JSON.stringify(dispatched().off)} stuck=${JSON.stringify(unmatched())}`,
    );
    expect(unmatched()).toEqual([]);
    expect(litKeys()).toEqual([]);
  });

  it('the window losing focus releases everything held', () => {
    render(<Keyboard track={TRACK} />);
    pointer('pointerdown', screen.getByTestId('key-48'), 1, { buttons: 1, pointerType: 'touch' });
    pointer('pointerdown', screen.getByTestId('key-52'), 2, { buttons: 1, pointerType: 'touch' });
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    console.log(`blur: stuck=${JSON.stringify(unmatched())} lit=${JSON.stringify(litKeys())}`);
    expect(unmatched()).toEqual([]);
    expect(litKeys()).toEqual([]);
  });

  it('the tab being hidden releases everything held', () => {
    render(<Keyboard track={TRACK} />);
    pointer('pointerdown', screen.getByTestId('key-48'), 1, { buttons: 1, pointerType: 'touch' });
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'hidden',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    console.log(`hidden: stuck=${JSON.stringify(unmatched())} lit=${JSON.stringify(litKeys())}`);
    expect(unmatched()).toEqual([]);
    expect(litKeys()).toEqual([]);
  });

  it('unmounting the keyboard releases everything held', () => {
    const view = render(<Keyboard track={TRACK} />);
    pointer('pointerdown', screen.getByTestId('key-48'), 1, { buttons: 1, pointerType: 'touch' });
    act(() => view.unmount());
    console.log(`unmount: stuck=${JSON.stringify(unmatched())}`);
    expect(unmatched()).toEqual([]);
  });
});
