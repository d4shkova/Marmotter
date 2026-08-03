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
  /** A few words beside the label saying how it is operated. */
  readonly labelNote?: string;
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
  labelNote,
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
      labelNote={labelNote}
    >
      {/* `appearance-none` takes the platform's arrow away, and `pr-8` holds
          the space it used to sit in — so without this the control is a text
          field with an unexplained gap on the right, and nothing about it says
          it opens. The chevron is what makes it read as a menu. */}
      <div className="relative">
        <select
          {...rest}
          id={fieldId}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy(fieldId, hint, error)}
          className={cn(inputClasses(error !== undefined), 'cursor-pointer appearance-none pr-9')}
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

        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 right-3 -translate-y-1/2',
            'text-caption-1 text-[var(--label-tertiary)]',
          )}
        >
          ▾
        </span>
      </div>
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
