import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppShell } from './AppShell.js';

afterEach(cleanup);

describe('the window frame', () => {
  it('keeps the columns filling the viewport when the OS draws the title bar', () => {
    const { container } = render(<AppShell sidebar={<nav />} main={<p>Messages</p>} />);

    const columns = container.firstElementChild;
    expect(columns?.className).toContain('h-dvh');
  });

  it('gives a title bar its own row and hands the columns the rest', () => {
    const { container } = render(
      <AppShell titleBar={<div data-testid="chrome" />} sidebar={<nav />} main={<p>Messages</p>} />,
    );

    const frame = container.firstElementChild;
    expect(frame?.className).toContain('h-dvh');
    // The bar comes first, so nothing scrolls out from under the window buttons.
    expect(frame?.firstElementChild).toBe(screen.getByTestId('chrome'));

    const columns = frame?.lastElementChild;
    expect(columns?.className).toContain('flex-1');
    expect(columns?.className).not.toContain('h-dvh');
  });
});
