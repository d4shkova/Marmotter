import { type ReactNode, useId, useRef } from 'react';
import { cn } from '../lib/cn.js';

export interface TabDefinition<T extends string> {
  readonly value: T;
  readonly label: string;
  /** A count beside the label, e.g. the number of bans in the list. */
  readonly count?: number;
}

export interface TabsProps<T extends string> {
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly tabs: readonly TabDefinition<T>[];
  /** Names the set, e.g. "Channel moderation". */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Tabs that show and hide panels — the Channel Moderation panel's shape.
 *
 * Real tab semantics, unlike `SegmentedControl`: each tab controls a panel, so
 * `aria-controls` and `role="tabpanel"` are what a screen reader needs to know
 * the content changed. Arrow keys move and activate together, which is the
 * automatic-activation pattern and the right one when switching is cheap.
 */
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
  children,
  className,
}: TabsProps<T>): ReactNode {
  const base = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const tabId = (tab: T): string => `${base}-tab-${tab}`;
  const panelId = (tab: T): string => `${base}-panel-${tab}`;

  const step = (delta: number): void => {
    const index = tabs.findIndex((tab) => tab.value === value);
    const next = (index + delta + tabs.length) % tabs.length;
    const tab = tabs[next];
    if (tab !== undefined) {
      onChange(tab.value);
      buttons.current[next]?.focus();
    }
  };

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 border-b border-[var(--separator)]"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            step(1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            step(-1);
          }
        }}
      >
        {tabs.map((tab, index) => {
          const selected = tab.value === value;
          return (
            <button
              key={tab.value}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={tabId(tab.value)}
              aria-selected={selected}
              aria-controls={panelId(tab.value)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.value)}
              className={cn(
                'relative px-3 py-2 text-subhead',
                'transition-colors duration-[var(--duration-press)] ease-[var(--easing-press)]',
                selected
                  ? 'font-medium text-[var(--label-primary)]'
                  : 'text-[var(--label-secondary)] hover:text-[var(--label-primary)]',
              )}
            >
              {tab.label}
              {tab.count === undefined ? null : (
                <span className="ml-1.5 text-caption-1 tabular-nums text-[var(--label-tertiary)]">
                  {tab.count}
                </span>
              )}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[var(--accent)]"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId(value)} aria-labelledby={tabId(value)} tabIndex={0}>
        {children}
      </div>
    </div>
  );
}
