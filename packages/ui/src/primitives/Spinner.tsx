import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export type SpinnerSize = 'small' | 'medium' | 'large';

export interface SpinnerProps {
  readonly size?: SpinnerSize;
  /**
   * What is being waited for.
   *
   * Announced to screen readers, so a wait is never silent. Pass an empty
   * string only when a visible label already says it.
   */
  readonly label?: string;
  readonly className?: string;
}

const SIZES: Record<SpinnerSize, string> = {
  small: 'size-3.5 border-[1.5px]',
  medium: 'size-5 border-2',
  large: 'size-8 border-[3px]',
};

export function Spinner({
  size = 'medium',
  label = 'Loading',
  className,
}: SpinnerProps): ReactNode {
  return (
    <span role="status" className={cn('inline-flex items-center', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-block animate-spin rounded-full',
          // The gap in the ring is what reads as motion; under reduced motion
          // the ring stops and stays a neutral, non-alarming shape.
          'border-[var(--fill-secondary)] border-t-[var(--accent)]',
          'motion-reduce:animate-none motion-reduce:border-t-[var(--fill-secondary)]',
          SIZES[size],
        )}
      />
      {label === '' ? null : <span className="sr-only">{label}</span>}
    </span>
  );
}
