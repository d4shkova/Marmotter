import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEdgeSwipe, type EdgeSwipeOptions } from './edge-swipe.js';

afterEach(cleanup);

const WIDTH = 400;

function Frame(options: EdgeSwipeOptions): React.ReactNode {
  const handlers = useEdgeSwipe(options);
  return (
    <div data-testid="frame" {...handlers}>
      conversation
    </div>
  );
}

function frame(options: Partial<EdgeSwipeOptions> = {}): HTMLElement {
  render(<Frame leadingOpen={false} trailingOpen={false} {...options} />);
  const element = screen.getByTestId('frame');
  // jsdom lays nothing out, so the frame has to be told how wide it is.
  element.getBoundingClientRect = () =>
    ({ left: 0, right: WIDTH, width: WIDTH, top: 0, bottom: 800 }) as DOMRect;
  return element;
}

/** A drag from `from` to `to`, at a constant vertical position unless given. */
function drag(element: HTMLElement, from: number, to: number, dy = 0, type = 'touch'): void {
  fireEvent.pointerDown(element, { clientX: from, clientY: 100, pointerType: type });
  fireEvent.pointerMove(element, { clientX: to, clientY: 100 + dy, pointerType: type });
  fireEvent.pointerUp(element, { pointerType: type });
}

describe('dragging in from the edge of the screen', () => {
  it('opens the channel list from the left edge', () => {
    const onOpenLeading = vi.fn();
    drag(frame({ onOpenLeading }), 30, 200);
    expect(onOpenLeading).toHaveBeenCalledOnce();
  });

  it('opens the member list from the right edge', () => {
    const onOpenTrailing = vi.fn();
    drag(frame({ onOpenTrailing }), WIDTH - 30, WIDTH - 200);
    expect(onOpenTrailing).toHaveBeenCalledOnce();
  });

  /**
   * Android's gesture navigation owns the outermost band of both edges for its
   * own back gesture, so a drag that starts there never reaches the page.
   * Treating it as ours would mean a gesture that works in a browser and does
   * nothing on a phone.
   */
  it('ignores a drag from the band the system reserves', () => {
    const onOpenLeading = vi.fn();
    drag(frame({ onOpenLeading }), 4, 200);
    expect(onOpenLeading).not.toHaveBeenCalled();
  });

  it('ignores a drag that starts in the middle of the conversation', () => {
    const onOpenLeading = vi.fn();
    drag(frame({ onOpenLeading }), 200, 340);
    expect(onOpenLeading).not.toHaveBeenCalled();
  });

  /** The message list scrolls under this, and must keep doing so. */
  it('leaves a mostly vertical drag alone', () => {
    const onOpenLeading = vi.fn();
    drag(frame({ onOpenLeading }), 30, 120, 300);
    expect(onOpenLeading).not.toHaveBeenCalled();
  });

  it('does nothing on a nudge too short to be meant', () => {
    const onOpenLeading = vi.fn();
    drag(frame({ onOpenLeading }), 30, 60);
    expect(onOpenLeading).not.toHaveBeenCalled();
  });

  it('closes the channel list by pushing it back', () => {
    const onCloseLeading = vi.fn();
    drag(frame({ leadingOpen: true, onCloseLeading }), 200, 60);
    expect(onCloseLeading).toHaveBeenCalledOnce();
  });

  it('closes the member list by pushing it back', () => {
    const onCloseTrailing = vi.fn();
    drag(frame({ trailingOpen: true, onCloseTrailing }), 200, 340);
    expect(onCloseTrailing).toHaveBeenCalledOnce();
  });

  /**
   * One drag is one decision. Without this a long sweep past the threshold
   * fires on every pointermove after it, opening a panel and closing it again.
   */
  it('acts once however far the finger keeps going', () => {
    const onOpenLeading = vi.fn();
    const element = frame({ onOpenLeading });
    fireEvent.pointerDown(element, { clientX: 30, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(element, { clientX: 200, clientY: 100, pointerType: 'touch' });
    fireEvent.pointerMove(element, { clientX: 300, clientY: 100, pointerType: 'touch' });
    expect(onOpenLeading).toHaveBeenCalledOnce();
  });

  it('ignores a mouse, which drags to select text', () => {
    const onOpenLeading = vi.fn();
    drag(frame({ onOpenLeading }), 30, 200, 0, 'mouse');
    expect(onOpenLeading).not.toHaveBeenCalled();
  });
});
