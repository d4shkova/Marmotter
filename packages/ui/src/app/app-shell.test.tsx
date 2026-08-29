import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
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

/**
 * The two panels live off the sides of a phone screen, and the handle against
 * each edge is both the way in and the thing that says there is a way in. A
 * gesture cannot say that, which is why these are buttons rather than a swipe.
 */
describe('the handles that open the side panels', () => {
  // jsdom reports a 1024px window, which is the three-column layout. These
  // handles are the single-column one, so the width has to say so.
  const width = window.innerWidth;
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  });

  const mobile = {
    sidebar: <nav />,
    main: <p>Messages</p>,
    aside: <aside />,
    asideOpen: false,
  };

  it('offers one for each panel that has somewhere to open from', () => {
    render(<AppShell {...mobile} onOpenSidebar={() => {}} onOpenAside={() => {}} />);

    expect(screen.getByRole('button', { name: 'Show channels' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the member list' })).toBeTruthy();
  });

  it('draws none the shell was given no way to open', () => {
    render(<AppShell {...mobile} />);

    expect(screen.queryByRole('button', { name: 'Show channels' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show the member list' })).toBeNull();
  });

  it('steps out of the way while its own panel is open', () => {
    render(<AppShell {...mobile} sidebarOpen onOpenSidebar={() => {}} onOpenAside={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Show channels' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Show the member list' })).toBeTruthy();
  });

  /**
   * The shell is handed no `aside` until the member list is open, so the handle
   * cannot wait for one — it would be waiting on the thing it exists to open.
   * What says a conversation has members is being given a way to open them.
   */
  it('offers the member list before there is one to show', () => {
    render(<AppShell sidebar={<nav />} main={<p>Messages</p>} onOpenAside={() => {}} />);

    expect(screen.getByRole('button', { name: 'Show the member list' })).toBeTruthy();
  });

  it('offers no member list where the conversation has none', () => {
    render(<AppShell sidebar={<nav />} main={<p>Messages</p>} onOpenSidebar={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Show the member list' })).toBeNull();
  });
});
