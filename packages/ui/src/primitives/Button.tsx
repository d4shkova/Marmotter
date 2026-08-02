import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Spinner } from './Spinner.js';

/**
 * The three roles a button can have.
 *
 * `destructive` is the only one that reaches for red, because red means one
 * thing in this interface and spending it on emphasis would dilute it.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'destructive';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Fills its container, as a sheet's confirm button does. */
  readonly full?: boolean;
  /**
   * Shows a spinner and blocks activation.
   *
   * The label stays in place rather than being replaced, so the button does not
   * change width and the surrounding layout does not jump.
   */
  readonly busy?: boolean;
  readonly leading?: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)]',
  secondary:
    'bg-[var(--fill-secondary)] text-[var(--label-primary)] hover:bg-[var(--fill-primary)] active:bg-[var(--fill-primary)]',
  plain:
    'bg-transparent text-[var(--accent)] hover:bg-[var(--fill-quaternary)] active:bg-[var(--fill-tertiary)]',
  destructive:
    'bg-[var(--danger)] text-[var(--on-accent)] hover:bg-[var(--danger-hover)] active:bg-[var(--danger-hover)]',
};

const SIZES: Record<ButtonSize, string> = {
  small: 'h-7 px-3 text-footnote gap-1',
  medium: 'h-9 px-4 text-callout gap-1.5',
  large: 'h-11 px-5 text-body gap-2',
};

export function Button({
  variant = 'secondary',
  size = 'medium',
  full = false,
  busy = false,
  leading,
  trailing,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled === true || busy}
      // Announced rather than only drawn, so the wait is not invisible to a
      // screen reader.
      aria-busy={busy || undefined}
      className={cn(
        'relative inline-flex items-center justify-center rounded-control font-medium',
        'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        full && 'w-full',
        className,
      )}
    >
      {busy ? (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={size === 'large' ? 'medium' : 'small'} label="Working" />
        </span>
      ) : null}
      <span className={cn('inline-flex items-center gap-[inherit]', busy && 'invisible')}>
        {leading}
        {children}
        {trailing}
      </span>
    </button>
  );
}
