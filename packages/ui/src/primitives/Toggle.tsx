import { type ReactNode, useId } from 'react';
import { cn } from '../lib/cn.js';

export interface ToggleProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  /** Named by what the user controls, never by protocol mechanism. */
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

/**
 * The iOS switch.
 *
 * A `button` with `role="switch"` rather than a styled checkbox: the state a
 * screen reader announces should be "on"/"off", which is what a switch says
 * and what a checkbox does not.
 */
export function Toggle({
  checked,
  onChange,
  label,
  labelHidden = false,
  hint,
  disabled = false,
  id,
  className,
}: ToggleProps): ReactNode {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className={cn('flex flex-col gap-0.5', labelHidden && 'sr-only')}>
        <label htmlFor={fieldId} className="text-body text-[var(--label-primary)]">
          {label}
        </label>
        {hint === undefined ? null : (
          <p id={hintId} className="text-footnote text-[var(--label-tertiary)]">
            {hint}
          </p>
        )}
      </div>

      <button
        id={fieldId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={labelHidden ? label : undefined}
        aria-describedby={hint === undefined || labelHidden ? undefined : hintId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-[31px] w-[51px] shrink-0 rounded-full',
          'transition-colors duration-[var(--duration-sheet)] ease-[var(--easing-sheet)]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          checked ? 'bg-[var(--accent)]' : 'bg-[var(--fill-secondary)]',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[2px] left-[2px] size-[27px] rounded-full bg-[var(--control-knob)] shadow-sm',
            // The duration token is 0ms under reduced motion, so the state
            // change survives and only the slide goes.
            'transition-transform duration-[var(--duration-sheet)] ease-[var(--easing-sheet)]',
            checked && 'translate-x-[20px]',
          )}
        />
      </button>
    </div>
  );
}
