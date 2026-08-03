import { type InputHTMLAttributes, type ReactNode, useId } from 'react';
import { cn } from '../lib/cn.js';

export interface SearchFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'className' | 'id' | 'type' | 'onChange'
> {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Names what is being searched, e.g. "Search channels". */
  readonly label: string;
  readonly id?: string;
  readonly className?: string;
}

export function SearchField({
  value,
  onValueChange,
  label,
  id,
  className,
  placeholder,
  ...rest
}: SearchFieldProps): ReactNode {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <div className={cn('relative', className)}>
      <label htmlFor={fieldId} className="sr-only">
        {label}
      </label>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[var(--label-tertiary)]"
      >
        <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-current stroke-2">
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" strokeLinecap="round" />
        </svg>
      </span>

      <input
        {...rest}
        id={fieldId}
        type="search"
        value={value}
        placeholder={placeholder ?? label}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          'w-full rounded-control bg-[var(--fill-tertiary)] py-2 pr-9 pl-9',
          'text-body text-[var(--label-primary)] placeholder:text-[var(--label-quaternary)]',
          'border border-transparent hover:border-[var(--separator)]',
          'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
          // The native clear affordance differs per browser and is not
          // keyboard-reachable in all of them, so we draw our own.
          '[&::-webkit-search-cancel-button]:hidden',
        )}
      />

      {value === '' ? null : (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onValueChange('')}
          className={cn(
            'absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center',
            'rounded-full text-[var(--label-tertiary)] hover:bg-[var(--fill-secondary)]',
          )}
        >
          <span aria-hidden="true">
            <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-2">
              <path d="m4 4 8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
