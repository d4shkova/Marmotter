import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { Field, describedBy, inputClasses } from './Field.js';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'id'
> {
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly hint?: string;
  readonly error?: string;
  readonly id?: string;
  readonly className?: string;
}

export function TextField({
  label,
  labelHidden,
  hint,
  error,
  id,
  className,
  type = 'text',
  ...rest
}: TextFieldProps): ReactNode {
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
      <input
        {...rest}
        id={fieldId}
        type={type}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={inputClasses(error !== undefined)}
      />
    </Field>
  );
}
