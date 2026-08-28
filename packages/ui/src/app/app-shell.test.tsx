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

  /**
   * A phone's status bar, gesture handle and camera cutout are drawn over the
   * page, because the Android build asks for `viewport-fit=cover`. Padding the
   * frame is what keeps every column out from under them at once — including
   * the slide-over channel list, which is positioned against the frame's edges
   * and would otherwise start underneath the status bar.
   *
   * `env()` is zero in a desktop window and an ordinary browser tab, so this
   * costs those nothing and neither needs to know it is here.
   */
  it('keeps every column clear of the edges the platform has claimed', () => {
    const { container } = render(<AppShell sidebar={<nav />} main={<p>Messages</p>} />);

    const frame = container.firstElementChild;
    expect(frame?.className).toContain('pt-[var(--safe-top)]');
    expect(frame?.className).toContain('pl-[var(--safe-left)]');
    expect(frame?.className).toContain('pr-[var(--safe-right)]');
  });
});
