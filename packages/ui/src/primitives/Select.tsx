import { type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cn } from '../lib/cn.js';
import { Field, describedBy, inputClasses } from './Field.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'className' | 'id' | 'children'
> {
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly hint?: string;
  readonly error?: string;
  readonly options: readonly SelectOption[];
  readonly id?: string;
  readonly className?: string;
}

/**
 * A native `select`.
 *
 * Deliberately native rather than a custom listbox: the platform one already
 * handles keyboard, screen readers, and — on mobile — the system picker, and
 * every hand-built replacement gets at least one of those wrong.
 */
export function Select({
  label,
  labelHidden,
  hint,
  error,
  options,
  id,
  className,
  ...rest
}: SelectProps): ReactNode {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <Field
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      className={className}
      labelHidden={labelHidden}
    >
      <select
        {...rest}
        id={fieldId}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={cn(inputClasses(error !== undefined), 'appearance-none pr-8')}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
