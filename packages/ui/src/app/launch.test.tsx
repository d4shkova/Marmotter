import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Launch, type LaunchNetwork, initialSelection } from './Launch.js';

afterEach(cleanup);

const net = (id: string, overrides: Partial<LaunchNetwork> = {}): LaunchNetwork => ({
  id,
  name: id,
  status: 'offline',
  statusText: 'Not connected',
  autojoin: [],
  ...overrides,
});

const show = (networks: readonly LaunchNetwork[]) => {
  const onConnect = vi.fn();
  const onSkip = vi.fn();
  render(
    <Launch networks={networks} onConnect={onConnect} onSkip={onSkip} onAddNetwork={vi.fn()} />,
  );
  return { onConnect, onSkip };
};

describe('what a launch starts with ticked', () => {
  it('ticks everything that is not already connected', () => {
    expect(
      initialSelection([net('libera'), net('oftc'), net('up', { status: 'connected' })]),
    ).toEqual(['libera', 'oftc']);
  });

  it('ticks a network that failed last time, since retrying is the point', () => {
    expect(initialSelection([net('libera', { status: 'failed' })])).toEqual(['libera']);
  });
});

describe('the launch screen', () => {
  it('connects to everything in one press', () => {
    const { onConnect } = show([net('libera'), net('oftc')]);

    fireEvent.click(screen.getByRole('button', { name: 'Connect to all of them' }));

    expect(onConnect).toHaveBeenCalledWith(['libera', 'oftc']);
  });

  it('connects only to what was left ticked', () => {
    const { onConnect } = show([net('libera'), net('oftc')]);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Connect to oftc' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith(['libera']);
  });

  // The screen exists because restored networks are deliberately not connected.
  // It must still be possible to say no and get to the window.
  it('takes no for an answer', () => {
    const { onSkip, onConnect } = show([net('libera')]);

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(onSkip).toHaveBeenCalled();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('never offers to connect a network that already is', () => {
    const { onConnect } = show([net('libera', { status: 'connected' }), net('oftc')]);

    expect(
      (screen.getByRole('checkbox', { name: 'Connect to libera' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(onConnect).toHaveBeenCalledWith(['oftc']);
  });

  it('says what a network will join, so the choice is an informed one', () => {
    show([net('libera', { autojoin: ['#marmotter', '#irc'] })]);
    expect(screen.getByText(/#marmotter, #irc/)).toBeDefined();
  });
});
