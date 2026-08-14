import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '../themes.js';
import { ThemePicker } from './ThemePicker.js';

afterEach(cleanup);

describe('choosing a theme', () => {
  it('names the theme in use without opening anything', () => {
    render(<ThemePicker value="nebula" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Nebula/ })).toBeDefined();
  });

  it('offers every theme, as one choice among them', () => {
    render(<ThemePicker value="midnight" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));

    const options = screen.getAllByRole('radio');
    expect(options).toHaveLength(THEMES.length);
    expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('hands back the theme that was picked, and closes', () => {
    const onChange = vi.fn();
    render(<ThemePicker value="midnight" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Paper/ }));

    expect(onChange).toHaveBeenCalledWith('paper');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  // The swatch is drawn by putting the theme on the element and reading the
  // same aliases the window reads. Naming its colours here instead would be a
  // second copy of the palette, free to disagree with the first.
  it('draws each swatch in the theme it names', () => {
    const { container } = render(<ThemePicker value="midnight" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));

    for (const theme of THEMES) {
      expect(container.ownerDocument.querySelector(`[data-theme='${theme.id}']`)).not.toBeNull();
    }
  });
});
