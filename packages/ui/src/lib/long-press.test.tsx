import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LONG_PRESS_MS, useLongPress } from './long-press.js';

afterEach(cleanup);

function Target({
  onLongPress,
}: {
  onLongPress: (at: { x: number; y: number }) => void;
}): ReactNode {
  return (
    <button type="button" {...useLongPress(onLongPress)}>
      Hold me
    </button>
  );
}

/** A pointer event with the fields the hook reads. jsdom has no PointerEvent. */
const touch = (x: number, y: number): Record<string, unknown> => ({
  pointerType: 'touch',
  clientX: x,
  clientY: y,
});

function hold(): HTMLElement {
  return screen.getByRole('button', { name: 'Hold me' });
}

describe('holding a control on a touch screen', () => {
  it('fires once the press has held long enough', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    render(<Target onLongPress={fired} />);

    fireEvent.pointerDown(hold(), touch(40, 80));
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(fired).toHaveBeenCalledWith({ x: 40, y: 80 });
    vi.useRealTimers();
  });

  /**
   * The regression this exists for. A finger on glass is never still: a touch
   * screen reports movement for the whole of a press, and while any movement at
   * all cancelled the timer, this gesture fired on a mouse held down and
   * essentially never on the device it was written for — which took the member
   * list's actions, and every other menu behind a right-click, off the phone
   * entirely.
   */
  it('survives the small movements a finger makes while holding still', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    render(<Target onLongPress={fired} />);

    fireEvent.pointerDown(hold(), touch(40, 80));
    fireEvent.pointerMove(hold(), touch(43, 84));
    fireEvent.pointerMove(hold(), touch(38, 77));
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(fired).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('gives way to a scroll', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    render(<Target onLongPress={fired} />);

    fireEvent.pointerDown(hold(), touch(40, 80));
    fireEvent.pointerMove(hold(), touch(40, 160));
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(fired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('is not a held mouse button, which would cost a pointer its drag-select', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    render(<Target onLongPress={fired} />);

    fireEvent.pointerDown(hold(), { pointerType: 'mouse', clientX: 40, clientY: 80 });
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(fired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not fire after the finger comes up', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    render(<Target onLongPress={fired} />);

    fireEvent.pointerDown(hold(), touch(40, 80));
    fireEvent.pointerUp(hold());
    vi.advanceTimersByTime(LONG_PRESS_MS);

    expect(fired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
