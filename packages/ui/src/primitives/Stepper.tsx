import { type ReactNode, useId } from 'react';
import { cn } from '../lib/cn.js';

export interface StepperProps {
  readonly value: number;
  readonly onChange: (value: number) => void;
  readonly label: string;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** Shown instead of the bare number, e.g. "No limit" at zero. */
  readonly format?: (value: number) => string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

/**
 * The iOS +/− stepper, used for the member-limit control.
 *
 * `role="spinbutton"` on the value rather than two nameless buttons: a screen
 * reader then announces the current number when it changes, which is the whole
 * point of the control.
 */
export function Stepper({
  value,
  onChange,
  label,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  format,
  disabled = false,
  id,
  className,
}: StepperProps): ReactNode {
  const generated = useId();
  const fieldId = id ?? generated;
  const labelId = `${fieldId}-label`;

  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const set = (next: number): void => {
    const clamped = clamp(next);
    if (clamped !== value) {
      onChange(clamped);
    }
  };

  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      {/* A span, not a label: `for` only names a form control, and the value
          here is a span with a spinbutton role. `aria-labelledby` does name it. */}
      <span id={labelId} className="text-body text-[var(--label-primary)]">
        {label}
      </span>

      <div className="flex items-center gap-3">
        <span
          id={fieldId}
          role="spinbutton"
          aria-labelledby={labelId}
          tabIndex={disabled ? -1 : 0}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max === Number.MAX_SAFE_INTEGER ? undefined : max}
          aria-valuetext={format?.(value)}
          aria-disabled={disabled || undefined}
          onKeyDown={(event) => {
            if (disabled) {
              return;
            }
            if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
              event.preventDefault();
              set(value + step);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
              event.preventDefault();
              set(value - step);
            }
          }}
          className="min-w-12 text-right font-mono text-body tabular-nums text-[var(--label-primary)]"
        >
          {format === undefined ? value : format(value)}
        </span>

        <span className="inline-flex overflow-hidden rounded-control bg-[var(--fill-secondary)]">
          <StepButton
            label={`Decrease ${label}`}
            glyph="−"
            disabled={disabled || value <= min}
            onClick={() => set(value - step)}
          />
          <span aria-hidden="true" className="w-px self-stretch bg-[var(--separator)]" />
          <StepButton
            label={`Increase ${label}`}
            glyph="+"
            disabled={disabled || value >= max}
            onClick={() => set(value + step)}
          />
        </span>
      </div>
    </div>
  );
}

function StepButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'grid h-9 w-11 place-items-center text-title-3 text-[var(--label-primary)]',
        'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
        'hover:bg-[var(--fill-primary)] active:bg-[var(--fill-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
