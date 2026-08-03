import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('web shell', () => {
  it('renders', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Marmotter' })).toBeDefined();
  });
});
