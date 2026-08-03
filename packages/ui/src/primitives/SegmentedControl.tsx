import { type ReactNode, useRef } from 'react';
import { cn } from '../lib/cn.js';

export interface Segment<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly segments: readonly Segment<T>[];
  /** Names the whole control, e.g. "Ban scope". */
  readonly label: string;
  readonly full?: boolean;
  readonly className?: string;
}

/**
 * The iOS segmented control, for two to four exclusive choices.
 *
 * A radio group in tabs' clothing, so it uses `role="radiogroup"` rather than
 * tab semantics: nothing is being shown or hidden, a value is being picked.
 * Arrow keys move and select together, which is what a radio group does.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  segments,
  label,
  full = false,
  className,
}: SegmentedControlProps<T>): ReactNode {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const step = (delta: number): void => {
    const index = segments.findIndex((segment) => segment.value === value);
    const next = (index + delta + segments.length) % segments.length;
    const segment = segments[next];
    if (segment !== undefined) {
      onChange(segment.value);
      buttons.current[next]?.focus();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex gap-0.5 rounded-control bg-[var(--fill-tertiary)] p-0.5',
        full && 'flex w-full',
        className,
      )}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          step(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          step(-1);
        }
      }}
    >
      {segments.map((segment, index) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            // Only the selected segment is in the tab order; the arrow keys
            // move within the group, as a radio group does.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(segment.value)}
            className={cn(
              'rounded-[8px] px-3 py-1 text-subhead',
              'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
              full && 'flex-1',
              selected
                ? 'bg-[var(--bg-elevated-2)] font-medium text-[var(--label-primary)] shadow-sm'
                : 'text-[var(--label-secondary)] hover:text-[var(--label-primary)]',
            )}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
