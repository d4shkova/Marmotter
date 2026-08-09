import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast.js';

afterEach(cleanup);

describe('Toast', () => {
  it('dismisses when the body is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t1" text="Saved marmot-photos.zip." onDismiss={onDismiss} />);

    fireEvent.click(screen.getByText('Saved marmot-photos.zip.'));
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
    expect(onDismiss).toHaveBeenCalledWith('t2');
  });

  it('still has an explicit close button', () => {
    const onDismiss = vi.fn();
    render(<Toast id="t3" text="Requested pack #7 from mybot." onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('t3');
  });
});
