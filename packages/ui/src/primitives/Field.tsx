import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  /**
   * Hides the label visually while leaving it for screen readers.
   *
   * Optional props here spell out `| undefined` because the project runs with
   * `exactOptionalPropertyTypes`, and JSX passes an omitted prop through as an
   * explicit `undefined`.
   */
  readonly labelHidden?: boolean | undefined;
  /**
   * Explanatory text under the control.
   *
   * iOS grouped lists put the explanation in a footer rather than a tooltip,
   * and so does this: the reason a setting exists should not be hidden behind
   * a hover a touch user cannot perform.
   */
  readonly hint?: string | undefined;
  /** What went wrong and what to do, in the interface's voice. */
  readonly error?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * The label, hint, and error wrapper every form control shares.
 *
 * Kept in one place so the `aria-describedby` wiring is written once. Every
 * control below passes the same two IDs, so an error is always announced.
 */
export function Field({
  id,
  label,
  labelHidden = false,
  hint,
  error,
  children,
  className,
}: FieldProps): ReactNode {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cn('text-subhead text-[var(--label-secondary)]', labelHidden && 'sr-only')}
      >
        {label}
      </label>
      {children}
      {hint !== undefined && error === undefined ? (
        <p id={hintId(id)} className="text-footnote text-[var(--label-tertiary)]">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        // Announced when it appears, because a validation message a screen
        // reader user never hears is the same as no message at all.
        <p id={errorId(id)} role="alert" className="text-footnote text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const hintId = (id: string): string => `${id}-hint`;
export const errorId = (id: string): string => `${id}-error`;

/** The `aria-describedby` value for a control inside a `Field`. */
export function describedBy(
  id: string,
  hint: string | undefined,
  error: string | undefined,
): string | undefined {
  if (error !== undefined) {
    return errorId(id);
  }
  return hint === undefined ? undefined : hintId(id);
}

/** The shared look of a text-entry control. */
export const inputClasses = (invalid: boolean): string =>
  cn(
    'w-full rounded-control bg-[var(--fill-tertiary)] px-3 py-2',
    'text-body text-[var(--label-primary)] placeholder:text-[var(--label-quaternary)]',
    'border transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
    'disabled:cursor-not-allowed disabled:opacity-40',
    invalid ? 'border-[var(--danger)]' : 'border-transparent hover:border-[var(--separator)]',
  );
