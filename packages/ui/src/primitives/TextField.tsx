import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { Field, describedBy, inputClasses } from './Field.js';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'id'
> {
  readonly label: string;
  // Spelled out as `| undefined` for the reason `Field` gives: the project runs
  // with `exactOptionalPropertyTypes`, and JSX passes an omitted prop through
  // as an explicit `undefined`. Without it a caller cannot forward a value that
  // may or may not be there — which is exactly the shape of a field error.
  readonly labelHidden?: boolean | undefined;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
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
