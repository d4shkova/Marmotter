import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '../themes.js';
import { ThemePicker } from './ThemePicker.js';
import { ThemePreview } from './ThemePreview.js';

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
    // One is chosen and the rest are not, however many there are: the list
    // grows every time a theme is added, and a hand-written column of 'false'
    // would only ever be a count of how many there were the day it was written.
    expect(options.map((option) => option.getAttribute('aria-checked'))).toEqual(
      THEMES.map((theme) => (theme.id === 'midnight' ? 'true' : 'false')),
    );
  });

  it('hands back the theme that was picked, and closes', () => {
    const onChange = vi.fn();
    render(<ThemePicker value="midnight" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));
    // Matched against the description too, because 'Paper' alone now names two
    // themes — the light page and its dark twin — and a picker that offers both
    // must not be tested by a pattern that cannot tell them apart.
    fireEvent.click(screen.getByRole('radio', { name: /^PaperA white page/ }));

    expect(onChange).toHaveBeenCalledWith('paper');
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  // The preview is drawn by putting the theme on the element and reading the
  // same aliases the window reads. Naming its colours here instead would be a
  // second copy of the palette, free to disagree with the first.
  it('draws each preview in the theme it names', () => {
    const { container } = render(<ThemePicker value="midnight" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Midnight/ }));

    for (const theme of THEMES) {
      expect(container.ownerDocument.querySelector(`[data-theme='${theme.id}']`)).not.toBeNull();
    }
  });
});

describe('the demo window', () => {
  // What the preview is for. Three chips say which colours a theme has; the
  // question a person is actually asking is whether they can read a channel in
  // it, and that needs the parts of the window they will be reading.
  it('draws the window in the theme it names, at both sizes', () => {
    for (const size of ['row', 'panel'] as const) {
      const { container, unmount } = render(<ThemePreview theme="brume-dark" size={size} />);
      const frame = container.querySelector("[data-theme='brume-dark']");
      expect(frame, size).not.toBeNull();
      // Every colour in it comes from that theme's own aliases. A literal here
      // would be a palette that could disagree with the window.
      expect(container.innerHTML, size).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\(/i);
      unmount();
    }
  });

  // The row it sits in is already a radio carrying the theme's name and its
  // description. A screen reader reading out a made-up channel after each one
  // would be noise, and the names in it are not real people.
  it('says nothing to a screen reader', () => {
    const { container } = render(<ThemePreview theme="midnight" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
