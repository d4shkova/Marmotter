import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NavBar } from './NavBar.js';

afterEach(cleanup);

describe('NavBar', () => {
  it('names the conversation it is showing', () => {
    render(<NavBar title="#marmotter" />);

    expect(screen.getByRole('heading', { name: '#marmotter' })).toBeDefined();
  });

  it('draws no heading when there is nothing to name', () => {
    // An empty heading reads as a heading with no text to a screen reader,
    // which is worse than no heading: the column below carries its own.
    render(<NavBar title="" />);

    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('keeps its controls when it has no title', () => {
    render(<NavBar title="" trailing={<button type="button">Show the member list</button>} />);

    expect(screen.getByRole('button', { name: 'Show the member list' })).toBeDefined();
  });
});
