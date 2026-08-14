/**
 * Choosing the colours.
 *
 * A dropdown rather than six rows of radio buttons, because Settings is already
 * long and a theme is a one-line decision. What each one is called is not much
 * use on its own — nobody knows what "Nebula" looks like — so every row carries
 * a swatch of the theme's own surface, accent and text.
 *
 * Those swatches are the reason this is not a `select`. A native option cannot
 * hold anything but text, and a picker of theme names with no colours in it is
 * a list of guesses. What a `select` would have brought for free is put back by
 * hand: the panel traps focus, closes on Escape or a click outside, and its
 * options are radios, so it is announced as one choice among six.
 *
 * The panel is positioned `fixed` and measured from the trigger rather than
 * laid out beside it. A settings group is a rounded card with
 * `overflow: hidden`, and an absolutely-positioned panel inside one is clipped
 * to the row it opened from — five of the six themes cut off at the edge.
 */

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { useDismissOnOutsideClick, useFocusTrap } from '../lib/focus.js';
import { type Placement, fit } from '../lib/placement.js';
import { Button } from '../primitives/Button.js';
import { THEMES, type ThemeId } from '../themes.js';

export interface ThemePickerProps {
  readonly value: ThemeId;
  readonly onChange: (theme: ThemeId) => void;
  readonly className?: string;
}

/** How wide the panel is drawn, and what its placement is measured against. */
const PANEL_WIDTH = 300;

/**
 * Three chips in a theme's own colours.
 *
 * `data-theme` on the wrapper is what makes this honest: the aliases below it
 * re-resolve against that theme's primitives, so a swatch cannot drift from the
 * theme it names — it is drawn by the same tokens the window would be.
 */
function Swatch({ theme }: { theme: ThemeId }): ReactNode {
  return (
    <span
      data-theme={theme}
      aria-hidden="true"
      className="flex shrink-0 items-center overflow-hidden rounded-[6px] border border-[var(--separator)]"
    >
      {['var(--bg-base)', 'var(--accent)', 'var(--label-primary)'].map((color) => (
        <span key={color} className="block h-5 w-3" style={{ background: color }} />
      ))}
    </span>
  );
}

export function ThemePicker({ value, onChange, className }: ThemePickerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | undefined>(undefined);
  const wrapper = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(panel, open, close);
  useDismissOnOutsideClick(wrapper, open, close);

  // Measured before paint, so the panel never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(undefined);
      return;
    }

    const place = (): void => {
      const anchor = wrapper.current?.getBoundingClientRect();
      const element = panel.current;
      if (anchor === undefined || element === null) {
        return;
      }
      setPlacement(
        // Anchored to the trigger's trailing edge, which is where the control
        // sits in a settings row.
        fit(
          { x: anchor.right - PANEL_WIDTH, y: anchor.bottom + 4 },
          { width: PANEL_WIDTH, height: element.scrollHeight },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  const current = THEMES.find((theme) => theme.id === value) ?? THEMES[0];

  return (
    <div ref={wrapper} className={cn('relative inline-block', className)}>
      <Button size="small" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}>
        <span className="flex items-center gap-2">
          <Swatch theme={value} />
          {current?.name ?? 'Theme'}
          <span aria-hidden="true" className="text-caption-1 text-[var(--label-tertiary)]">
            ▾
          </span>
        </span>
      </Button>

      {!open ? null : (
        <div
          ref={panel}
          role="radiogroup"
          aria-label="Theme"
          tabIndex={-1}
          style={{
            position: 'fixed',
            width: PANEL_WIDTH,
            left: placement?.left ?? 0,
            top: placement?.top ?? 0,
            ...(placement === undefined
              ? // Kept out of sight until it has been measured, rather than
                // drawn at the top-left of the window for one frame.
                { visibility: 'hidden' as const }
              : { maxHeight: placement.maxHeight }),
          }}
          className={cn(
            'z-50 flex flex-col overflow-y-auto rounded-card p-1',
            'bg-[var(--bg-elevated-2)] [backdrop-filter:var(--blur-vibrancy)]',
            'border border-[var(--separator)] shadow-xl',
          )}
        >
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={theme.id === value}
              onClick={() => {
                onChange(theme.id);
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-3 rounded-control px-2 py-2 text-left',
                'hover:bg-[var(--fill-quaternary)]',
                theme.id === value && 'bg-[var(--accent-muted)]',
              )}
            >
              <Swatch theme={theme.id} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-subhead text-[var(--label-primary)]">
                  {theme.name}
                </span>
                <span className="truncate text-caption-1 text-[var(--label-tertiary)]">
                  {theme.description}
                </span>
              </span>
              {theme.id === value ? (
                <span aria-hidden="true" className="text-[var(--accent)]">
                  ✓
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
