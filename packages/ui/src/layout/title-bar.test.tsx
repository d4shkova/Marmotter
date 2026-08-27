import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleBar } from './TitleBar.js';

afterEach(cleanup);

describe('TitleBar', () => {
  it('drives the window from its three buttons', async () => {
    const minimize = vi.fn();
    const toggleMaximize = vi.fn();
    const close = vi.fn();
    const user = userEvent.setup();

    render(
      <TitleBar
        title="Marmotter"
        controls="custom"
        onMinimize={minimize}
        onToggleMaximize={toggleMaximize}
        onClose={close}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Minimize this window' }));
    await user.click(screen.getByRole('button', { name: 'Maximize this window' }));
    await user.click(screen.getByRole('button', { name: 'Close this window' }));

    expect(minimize).toHaveBeenCalledOnce();
    expect(toggleMaximize).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('names what the middle button will do, rather than what it did', () => {
    render(<TitleBar title="Marmotter" controls="custom" maximized />);

    expect(screen.getByRole('button', { name: 'Restore this window' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Maximize this window' })).toBeNull();
  });

  it('leaves the buttons to macOS, which draws its own', () => {
    render(<TitleBar title="Marmotter" controls="native-inset" />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Marmotter')).toBeDefined();
  });

  it('draws no window buttons where there is no window', () => {
    // The web build's guarantee: a browser tab cannot close its own window, so
    // a button offering to would be a lie.
    render(<TitleBar title="Marmotter" />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('spreads the shell drag attributes onto the bar and the title', () => {
    // Passed in rather than hardcoded, so this package stays free of any one
    // desktop shell's conventions.
    const { container } = render(
      <TitleBar
        title="Marmotter"
        controls="custom"
        dragProps={{ 'data-tauri-drag-region': true }}
      />,
    );

    expect(container.querySelectorAll('[data-tauri-drag-region]')).toHaveLength(2);
    // Tauri starts a drag when the pressed element itself carries the
    // attribute, so the window buttons must not carry it.
    for (const button of screen.getAllByRole('button')) {
      expect(button.hasAttribute('data-tauri-drag-region')).toBe(false);
    }
  });
});
