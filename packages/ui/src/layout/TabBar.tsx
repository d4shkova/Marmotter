import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Badge } from '../primitives/Badge.js';

export interface TabBarItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon: ReactNode;
  /** Unread count. Zero and undefined both mean no badge. */
  readonly badge?: number;
  /** Draws the badge in red, for a highlight rather than ordinary unreads. */
  readonly highlighted?: boolean;
}

export interface TabBarProps<T extends string> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly items: readonly TabBarItem<T>[];
  readonly label?: string;
  readonly className?: string;
}

/**
 * The bottom tab bar, below 768px.
 *
 * Navigation rather than tabs: each item takes the user to a different part of
 * the app, so it is a `nav` with `aria-current`, not a tablist. Labels are
 * always visible — an icon-only bar is a guessing game, and this app's whole
 * premise is not making people guess.
 */
export function TabBar<T extends string>({
  value,
  onChange,
  items,
  label = 'Sections',
  className,
}: TabBarProps<T>): ReactNode {
  return (
    <nav
      aria-label={label}
      className={cn(
        'sticky bottom-0 z-30 flex items-stretch',
        'bg-[var(--bg-elevated)]/80 [backdrop-filter:var(--blur-vibrancy)]',
        'border-t border-[var(--separator)] pb-[var(--safe-bottom)]',
        className,
      )}
    >
      {items.map((item) => {
        const current = item.value === value;
        const count = item.badge ?? 0;

        return (
          <button
            key={item.value}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative flex flex-1 flex-col items-center gap-0.5 py-1.5',
              'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
              current ? 'text-[var(--accent)]' : 'text-[var(--label-tertiary)]',
            )}
          >
            <span aria-hidden="true" className="grid size-6 place-items-center">
              {item.icon}
            </span>
            <span className="text-caption-2">{item.label}</span>

            {count > 0 ? (
              <span className="absolute top-0.5 right-[calc(50%-1.5rem)]">
                <Badge
                  tone={item.highlighted === true ? 'alert' : 'count'}
                  label={`${count} unread in ${item.label}`}
                >
                  {count > 99 ? '99+' : count}
                </Badge>
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
