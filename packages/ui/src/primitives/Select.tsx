import { type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cn } from '../lib/cn.js';
import { Field, describedBy, inputClasses } from './Field.js';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /**
   * Heading this option is filed under.
   *
   * Options carrying one are grouped in the order the groups first appear.
   * A list long enough to need headings — a directory of networks, say — is
   * unreadable without them, and the native `optgroup` is what screen readers
   * and the mobile picker already know how to announce.
   */
  readonly group?: string;
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
        {groupsOf(options).map(([group, entries]) =>
          group === undefined ? (
            entries.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))
          ) : (
            <optgroup key={group} label={group}>
              {entries.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ),
        )}
      </select>
    </Field>
  );
}

/** Options in their groups, in the order each group first appears. */
function groupsOf(
  options: readonly SelectOption[],
): readonly (readonly [string | undefined, readonly SelectOption[]])[] {
  const groups: [string | undefined, SelectOption[]][] = [];
  for (const option of options) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0] === option.group) {
      last[1].push(option);
    } else {
      groups.push([option.group, [option]]);
    }
  }
  return groups;
}
