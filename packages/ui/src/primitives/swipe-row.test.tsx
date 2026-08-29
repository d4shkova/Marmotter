import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwipeRow } from './SwipeRow.js';

afterEach(cleanup);

/** jsdom has no PointerEvent, and only clientX and pointerType are read. */
function drag(element: Element, to: number, pointerType = 'touch'): void {
  fireEvent.pointerDown(element, { clientX: 0, pointerType });
  fireEvent.pointerMove(element, { clientX: to, pointerType });
  fireEvent.pointerUp(element, { clientX: to, pointerType });
}

const markRead = { label: 'Mark as read', onAction: vi.fn() };
const leave = { label: 'Leave channel', onAction: vi.fn(), destructive: true };

function row(): Element {
  render(
    <SwipeRow leading={{ ...markRead }} trailing={{ ...leave }}>
      <button type="button">#marmotter</button>
    </SwipeRow>,
  );
  return screen.getByRole('button', { name: '#marmotter' });
}

describe('dragging a list row aside', () => {
  it('runs the leading action when dragged far enough to the right', () => {
    const onAction = vi.fn();
    render(
      <SwipeRow leading={{ label: 'Mark as read', onAction }}>
        <button type="button">#marmotter</button>
      </SwipeRow>,
    );

    drag(screen.getByRole('button', { name: '#marmotter' }), 100);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('does nothing on a nudge that was probably a scroll', () => {
    const onAction = vi.fn();
    render(
      <SwipeRow leading={{ label: 'Mark as read', onAction }}>
        <button type="button">#marmotter</button>
      </SwipeRow>,
    );

    drag(screen.getByRole('button', { name: '#marmotter' }), 30);
    expect(onAction).not.toHaveBeenCalled();
  });

  /**
   * The whole reason destructive actions have their own threshold: the drag
   * that marks a row read must not be enough to leave a channel.
   */
  it('needs most of the row before it will leave a channel', () => {
    const onAction = vi.fn();
    render(
      <SwipeRow trailing={{ label: 'Leave channel', onAction, destructive: true }}>
        <button type="button">#marmotter</button>
      </SwipeRow>,
    );
    const target = screen.getByRole('button', { name: '#marmotter' });

    drag(target, -100);
    expect(onAction).not.toHaveBeenCalled();

    drag(target, -180);
    expect(onAction).toHaveBeenCalledOnce();
  });

  /**
   * Dragging a row with a held left button is text selection and drag-ordering.
   * Giving it a second meaning breaks both, so a mouse is excluded rather than
   * supported — it has the right-click menu, which is where these actions live.
   */
  it('ignores a mouse entirely', () => {
    const onAction = vi.fn();
    render(
      <SwipeRow leading={{ label: 'Mark as read', onAction }}>
        <button type="button">#marmotter</button>
      </SwipeRow>,
    );

    drag(screen.getByRole('button', { name: '#marmotter' }), 200, 'mouse');
    expect(onAction).not.toHaveBeenCalled();
  });

  it('does not open onto an edge with no action behind it', () => {
    const onAction = vi.fn();
    const { container } = render(
      <SwipeRow leading={{ label: 'Mark as read', onAction }}>
        <button type="button">#marmotter</button>
      </SwipeRow>,
    );
    const target = screen.getByRole('button', { name: '#marmotter' });

    fireEvent.pointerDown(target, { clientX: 0, pointerType: 'touch' });
    fireEvent.pointerMove(target, { clientX: -150, pointerType: 'touch' });

    const sliding = container.firstElementChild?.lastElementChild as HTMLElement;
    expect(sliding.style.transform).toBe('');
  });

  it('names the action it is about to run while the row is held open', () => {
    const target = row();

    fireEvent.pointerDown(target, { clientX: 0, pointerType: 'touch' });
    fireEvent.pointerMove(target, { clientX: 100, pointerType: 'touch' });

    expect(screen.getByText('Mark as read')).toBeTruthy();
  });

  it('lets go without acting when the gesture is cancelled', () => {
    const onAction = vi.fn();
    render(
      <SwipeRow leading={{ label: 'Mark as read', onAction }}>
        <button type="button">#marmotter</button>
      </SwipeRow>,
    );
    const target = screen.getByRole('button', { name: '#marmotter' });

    fireEvent.pointerDown(target, { clientX: 0, pointerType: 'touch' });
    fireEvent.pointerMove(target, { clientX: 120, pointerType: 'touch' });
    fireEvent.pointerCancel(target, { pointerType: 'touch' });

    expect(onAction).not.toHaveBeenCalled();
  });
});
