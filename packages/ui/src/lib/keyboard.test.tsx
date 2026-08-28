import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardInset } from './keyboard.js';

/** A stand-in for `window.visualViewport`, driven by the test. */
class FakeViewport extends EventTarget {
  height: number;
  offsetTop = 0;

  constructor(height: number) {
    super();
    this.height = height;
  }

  /** Moves to a new size and tells anything listening, as a browser would. */
  resize(height: number, offsetTop = 0): void {
    this.height = height;
    this.offsetTop = offsetTop;
    this.dispatchEvent(new Event('resize'));
  }
}

function withViewport(viewport: FakeViewport | undefined): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
  return () => {
    if (original === undefined) {
      Reflect.deleteProperty(window, 'visualViewport');
    } else {
      Object.defineProperty(window, 'visualViewport', original);
    }
  };
}

function Probe(): React.ReactNode {
  return <span data-testid="inset">{useKeyboardInset()}</span>;
}

afterEach(cleanup);

describe('measuring the software keyboard', () => {
  it('reports nothing while the whole window is on screen', () => {
    const restore = withViewport(new FakeViewport(window.innerHeight));
    try {
      const { getByTestId } = render(<Probe />);
      expect(getByTestId('inset').textContent).toBe('0');
    } finally {
      restore();
    }
  });

  it('reports what the keyboard covers once it opens', () => {
    const viewport = new FakeViewport(window.innerHeight);
    const restore = withViewport(viewport);
    try {
      const { getByTestId } = render(<Probe />);
      act(() => viewport.resize(window.innerHeight - 320));
      expect(getByTestId('inset').textContent).toBe('320');
    } finally {
      restore();
    }
  });

  /**
   * The browser can scroll the visual viewport inside the layout viewport on
   * its own, to bring a focused field above the keyboard. That moves the bottom
   * of the visible region down, so less of the page is hidden — not more.
   * Padding by the viewport's height alone would over-pad by exactly the
   * scrolled distance and leave a gap under the composer.
   */
  it('discounts the visual viewport being scrolled down inside the page', () => {
    const viewport = new FakeViewport(window.innerHeight);
    const restore = withViewport(viewport);
    try {
      const { getByTestId } = render(<Probe />);
      act(() => viewport.resize(window.innerHeight - 300, 40));
      expect(getByTestId('inset').textContent).toBe('260');
    } finally {
      restore();
    }
  });

  /**
   * With `interactive-widget=resizes-content` the layout viewport shrinks with
   * the visual one and there is nothing left to pad. Measuring a keyboard here
   * would push the composer up twice.
   */
  it('reports nothing when the platform has already shrunk the page', () => {
    const viewport = new FakeViewport(window.innerHeight);
    const restore = withViewport(viewport);
    try {
      const { getByTestId } = render(<Probe />);
      act(() => {
        Object.defineProperty(window, 'innerHeight', {
          value: window.innerHeight - 320,
          configurable: true,
        });
        viewport.resize(window.innerHeight);
      });
      expect(getByTestId('inset').textContent).toBe('0');
    } finally {
      restore();
    }
  });

  it('leaves the layout alone in a browser with no visual viewport', () => {
    const restore = withViewport(undefined);
    try {
      const { getByTestId } = render(<Probe />);
      expect(getByTestId('inset').textContent).toBe('0');
    } finally {
      restore();
    }
  });

  it('stops listening once it is gone', () => {
    const viewport = new FakeViewport(window.innerHeight);
    const remove = vi.spyOn(viewport, 'removeEventListener');
    const restore = withViewport(viewport);
    try {
      render(<Probe />).unmount();
      expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
      expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
    } finally {
      restore();
    }
  });
});
