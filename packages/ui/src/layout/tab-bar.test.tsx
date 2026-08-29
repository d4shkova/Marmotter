import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TabBar } from './TabBar.js';

afterEach(cleanup);

const items = [
  { value: 'chats' as const, label: 'Chats', icon: <span /> },
  { value: 'settings' as const, label: 'Settings', icon: <span /> },
];

describe('the bottom bar', () => {
  it('puts what it is given at either end, beside the tabs', () => {
    render(
      <TabBar
        value="chats"
        onChange={() => {}}
        items={items}
        leading={<button type="button">Show channels</button>}
        trailing={<button type="button">Show the member list</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Show channels' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the member list' })).toBeTruthy();
  });

  /**
   * The panels are things to pull open, not places to go, so they sit outside
   * the tabs — being `aria-current` would say something about them that can
   * never be true.
   */
  it('marks only a tab as the current one', () => {
    render(
      <TabBar
        value="chats"
        onChange={() => {}}
        items={items}
        leading={<button type="button">Show channels</button>}
      />,
    );

    const current = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-current'));
    expect(current.map((b) => b.textContent)).toEqual(['Chats']);
  });

  it('draws neither end where it was given nothing', () => {
    render(<TabBar value="chats" onChange={() => {}} items={items} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
