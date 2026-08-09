import { cleanup, fireEvent, render } from '@testing-library/react';
import { type ReactNode, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './focus.js';

afterEach(cleanup);

/** A minimal overlay that traps focus and re-renders on demand. */
function Trapped({ onClose }: { onClose: () => void }): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useFocusTrap(panel, true, onClose);
  return (
    <div ref={panel}>
      <input aria-label="first" />
      <input aria-label="second" />
      <button type="button" onClick={() => setTick((value) => value + 1)}>
        re-render {tick}
      </button>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('does not steal focus back to the first field on a background re-render', () => {
    // The escape handler is a fresh closure every render, which is the shape the
    // real callers pass. Before the ref fix this re-ran the effect and pulled
    // focus back to the first field on every render behind the overlay.
    function Host(): ReactNode {
      const [, setState] = useState(0);
      return (
        <>
          <Trapped onClose={() => setState((value) => value + 1)} />
          <button type="button" aria-label="outside" onClick={() => setState((value) => value + 1)}>
            churn
          </button>
        </>
      );
    }
    const { getByLabelText, getByText } = render(<Host />);

    const second = getByLabelText('second');
    second.focus();
    expect(document.activeElement).toBe(second);

    // Something behind the overlay re-renders the tree.
    fireEvent.click(getByText('churn'));

    expect(document.activeElement).toBe(second);
  });

  it('runs the latest escape handler', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Trapped onClose={first} />);
    rerender(<Trapped onClose={second} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
