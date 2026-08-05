import { type ReactNode, useId } from 'react';
import { cn } from '../lib/cn.js';

export interface RadioOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /**
   * The consequence of choosing this, in plain language.
   *
   * The "Add a network" TLS choice is the reason this exists: "Connect without
   * encryption" needs to say what that means, and a tooltip would hide it from
   * exactly the person who needs to read it.
   */
  readonly description?: string;
  readonly disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  readonly legend: string;
  readonly legendHidden?: boolean;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly options: readonly RadioOption<T>[];
  readonly name?: string;
  readonly className?: string;
}

/**
 * A radio group.
 *
 * Native inputs, because the browser already implements roving arrow-key focus
 * within a group and every hand-rolled version has to reimplement it.
 */
export function RadioGroup<T extends string>({
  legend,
  legendHidden = false,
  value,
  onChange,
  options,
  name,
  className,
}: RadioGroupProps<T>): ReactNode {
  const generated = useId();
  const groupName = name ?? generated;

  return (
    <fieldset className={cn('flex flex-col gap-2 border-0 p-0', className)}>
      <legend
        className={cn('mb-1 text-subhead text-[var(--label-secondary)]', legendHidden && 'sr-only')}
      >
        {legend}
      </legend>

      {options.map((option) => {
        const optionId = `${groupName}-${option.value}`;
        const describedBy = option.description === undefined ? undefined : `${optionId}-desc`;

        return (
          // `text-body` puts the radio on its label's font-size baseline, so
          // the em-based size below tracks the surrounding text.
          <div key={option.value} className="flex items-start gap-2.5 text-body">
            <input
              type="radio"
              id={optionId}
              name={groupName}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              aria-describedby={describedBy}
              onChange={() => onChange(option.value)}
              className={cn(
                // 1.18em ≈ 20px at the 17px body default, and shrinks with
                // the token in a scope that dials body down.
                'mt-0.5 size-[1.18em] shrink-0 appearance-none rounded-full border',
                'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
                'disabled:cursor-not-allowed disabled:opacity-40',
                'border-[var(--separator-opaque)] bg-[var(--fill-tertiary)]',
                'checked:border-[0.35em] checked:border-[var(--accent)] checked:bg-[var(--bg-base)]',
              )}
            />
            <div className="flex flex-col gap-0.5">
              <label htmlFor={optionId} className="text-body text-[var(--label-primary)]">
                {option.label}
              </label>
              {option.description === undefined ? null : (
                <p id={describedBy} className="text-footnote text-[var(--label-tertiary)]">
                  {option.description}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}
