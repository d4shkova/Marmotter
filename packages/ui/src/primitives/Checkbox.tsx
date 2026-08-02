import { type ReactNode, useId } from 'react';
import { cn } from '../lib/cn.js';

export interface CheckboxProps {
  readonly checked: boolean;
  /**
   * Neither checked nor unchecked.
   *
   * The channel permissions grid needs this: a capability some members have
   * and others do not is not "off", and showing it as off invites the user to
   * turn it on and silently revoke it from everyone else.
   */
  readonly indeterminate?: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  labelHidden = false,
  disabled = false,
  id,
  className,
}: CheckboxProps): ReactNode {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <button
        id={fieldId}
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        aria-label={labelHidden ? label : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-[6px] border',
          'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          checked || indeterminate
            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]'
            : 'border-[var(--separator-opaque)] bg-[var(--fill-tertiary)]',
        )}
      >
        <Mark checked={checked} indeterminate={indeterminate} />
      </button>
      {labelHidden ? null : (
        <label htmlFor={fieldId} className="text-body text-[var(--label-primary)]">
          {label}
        </label>
      )}
    </div>
  );
}

function Mark({ checked, indeterminate }: { checked: boolean; indeterminate: boolean }): ReactNode {
  if (indeterminate) {
    return <span aria-hidden="true" className="h-[2px] w-2.5 rounded-full bg-current" />;
  }
  if (!checked) {
    return null;
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 14 14" className="size-3.5 fill-none stroke-current">
      <path d="M3 7.5 6 10.5 11 4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
