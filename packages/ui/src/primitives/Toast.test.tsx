import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOAST_DISMISS_MS, Toast } from './Toast.js';

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** How long the fade lasts before the toast is actually removed. */
const FADE_MS = 200;

/** Runs the fade to completion, so `onDismiss` has been reported. */
const finishFade = (): void => {
  act(() => {
    vi.advanceTimersByTime(FADE_MS);
  });
};

describe('Toast', () => {
  it('fades before it reports the dismissal, rather than cutting out', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t1" text="Saved marmot-photos.zip." onDismiss={onDismiss} />);
    const body = screen.getByText('Saved marmot-photos.zip.');

    fireEvent.click(body);
    // Still on screen, and on its way out. Reporting the dismissal here would
    // unmount it mid-fade, which is the bug this ordering exists to avoid.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(body.closest('div')?.className).toContain('opacity-0');

    finishFade();
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('runs the action and dismisses when the action is clicked', () => {
    const onDismiss = vi.fn();
    const onSelect = vi.fn();
    render(
      <Toast
        id="t2"
        tone="error"
        text="Couldn't verify the certificate."
        action={{ label: 'Connect anyway', onSelect }}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Connect anyway' }));
    expect(onSelect).toHaveBeenCalledTimes(1);

    finishFade();
    expect(onDismiss).toHaveBeenCalledWith('t2');
  });

  it('still has an explicit close button', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t3" text="Requested pack #7 from mybot." onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    finishFade();
    expect(onDismiss).toHaveBeenCalledWith('t3');
  });

  it('dismisses itself after ten seconds when nothing is said', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t4" text="Connected to Libera.Chat." onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DISMISS_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1 + FADE_MS);
    });
    expect(onDismiss).toHaveBeenCalledWith('t4');
  });

  it('honours a timeout the user has chosen instead of the default', () => {
    const onDismiss = vi.fn();
    render(
      <Toast id="t5" text="Connected to Libera.Chat." dismissMs={3_000} onDismiss={onDismiss} />,
    );

    act(() => {
      vi.advanceTimersByTime(3_000 + FADE_MS);
    });
    expect(onDismiss).toHaveBeenCalledWith('t5');
  });

  it('holds the countdown while somebody is reading it', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t6" text="Connected to Libera.Chat." onDismiss={onDismiss} />);
    const body = screen.getByText('Connected to Libera.Chat.');

    fireEvent.mouseEnter(body.closest('div') as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DISMISS_MS * 3);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(body.closest('div') as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DISMISS_MS + FADE_MS);
    });
    expect(onDismiss).toHaveBeenCalledWith('t6');
  });

  it('keeps counting down while the client around it re-renders', () => {
    // The shell re-renders on every line the network sends, and writes its
    // dismiss handler inline, so the toast is handed a new function several
    // times a second. Timing the countdown off that identity restarted it every
    // time, and nothing ever cleared on its own.
    const onDismiss = vi.fn();
    const render_ = (): void => {
      rerender(<Toast id="t8" text="Saved marmot-photos.zip." onDismiss={(id) => onDismiss(id)} />);
    };
    const { rerender } = render(
      <Toast id="t8" text="Saved marmot-photos.zip." onDismiss={(id) => onDismiss(id)} />,
    );

    for (let second = 0; second < DEFAULT_TOAST_DISMISS_MS / 1_000; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      render_();
    }
    act(() => {
      vi.advanceTimersByTime(FADE_MS);
    });

    expect(onDismiss).toHaveBeenCalledWith('t8');
  });

  it('waits to be answered when it is asking rather than reporting', () => {
    // An unverified certificate. Fading this one away leaves the network simply
    // not connecting, with nothing on screen saying why.
    const onDismiss = vi.fn();
    render(
      <Toast
        id="t9"
        tone="error"
        persistent
        text="Couldn't verify Libera.Chat's certificate. Connect without checking it?"
        onDismiss={onDismiss}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(DEFAULT_TOAST_DISMISS_MS * 10);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Still dismissible every way the others are.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    finishFade();
    expect(onDismiss).toHaveBeenCalledWith('t9');
  });

  it('reports one dismissal however many times it is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t7" text="Saved marmot-photos.zip." onDismiss={onDismiss} />);
    const body = screen.getByText('Saved marmot-photos.zip.');

    fireEvent.click(body);
    fireEvent.click(body);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    finishFade();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
