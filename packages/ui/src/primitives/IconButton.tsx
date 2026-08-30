import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type IconButtonSize = 'small' | 'medium' | 'large';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children'
> {
  /**
   * What the button does, in the same words the action uses elsewhere.
   *
   * Required, not optional: an icon-only control with no name is invisible to
   * a screen reader, and this is the accessibility floor CLAUDE.md sets.
   */
  readonly label: string;
  readonly icon: ReactNode;
  readonly size?: IconButtonSize;
  /** Destructive actions, and only those, are red. */
  readonly destructive?: boolean;
  /** Pressed state for a toggle, e.g. the member-list button. */
  readonly pressed?: boolean;
  readonly className?: string;
}

/**
 * How big the target is, at each size and under each kind of pointer.
 *
 * The sizes are chosen for a pointer: dense enough that a bar of them is not a
 * toolbar, because a mouse aims to the pixel. A finger does not — the platforms
 * both put the floor at 44px, and every one of these sat under it — so where
 * the pointer is coarse each size grows a step and the largest reaches the
 * floor. It is the same button either way: nothing moves, nothing is hidden,
 * and a laptop with a touchscreen gets the roomier one, which is the right
 * answer for the person using the touchscreen.
 */
const SIZES: Record<IconButtonSize, string> = {
  small: 'size-7 pointer-coarse:size-9',
  medium: 'size-9 pointer-coarse:size-11',
  large: 'size-11',
};

export function IconButton({
  label,
  icon,
  size = 'medium',
  destructive = false,
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-control',
        // Stops a double-tap zooming the page instead of pressing the button.
        'touch-manipulation',
        'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
        'hover:bg-[var(--fill-quaternary)] active:bg-[var(--fill-tertiary)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        destructive ? 'text-[var(--danger)]' : 'text-[var(--label-secondary)]',
        pressed === true && 'bg-[var(--fill-tertiary)] text-[var(--accent)]',
        SIZES[size],
        className,
      )}
    >
      <span aria-hidden="true" className="grid place-items-center">
        {icon}
      </span>
    </button>
  );
}
