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

const SIZES: Record<IconButtonSize, string> = {
  // Touch targets stay at least 44px on the two larger sizes; the small one is
  // for dense hover rows on desktop, where a pointer is doing the aiming.
  small: 'size-7',
  medium: 'size-9',
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
        'inline-grid place-items-center rounded-control',
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
