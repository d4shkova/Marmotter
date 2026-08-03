import { Children, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface SectionHeaderProps {
  readonly children: ReactNode;
  /** An action on the trailing edge, e.g. "Edit". */
  readonly action?: ReactNode;
  readonly className?: string;
}

/** The uppercase header above a grouped list. */
export function SectionHeader({ children, action, className }: SectionHeaderProps): ReactNode {
  return (
    <div className={cn('flex items-end justify-between gap-4 px-4 pb-1.5', className)}>
      <h2 className="text-footnote font-medium tracking-wide text-[var(--label-tertiary)] uppercase">
        {children}
      </h2>
      {action}
    </div>
  );
}

export interface ListGroupProps {
  readonly header?: ReactNode;
  /**
   * Explanatory text under the group.
   *
   * This is where a setting's consequence goes. iOS puts it here rather than
   * in a tooltip, which matters on touch, where there is no hover to reveal it.
   */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  /** Announced as a named region, for the settings screens. */
  readonly label?: string;
}

/**
 * An inset rounded group with hairline separators.
 *
 * The separators stop short of the leading edge, which is the iOS convention
 * and is what lets the eye read the leading column — icon or avatar — as a
 * continuous run down the group.
 */
export function ListGroup({
  header,
  footer,
  children,
  className,
  label,
}: ListGroupProps): ReactNode {
  const rows = Children.toArray(children);

  return (
    <section aria-label={label} className={cn('flex flex-col', className)}>
      {header === undefined ? null : <SectionHeader>{header}</SectionHeader>}

      <div className="overflow-hidden rounded-card bg-[var(--bg-elevated)]">
        {rows.map((row, index) => (
          // The index is the key on purpose: these are layout slots the caller
          // controls, and the separator belongs between slots rather than to
          // any one child.
          <div key={index}>
            {index === 0 ? null : (
              <div
                aria-hidden="true"
                className="ml-4 h-px bg-[var(--separator)]"
                style={{ height: 'var(--hairline)' }}
              />
            )}
            {row}
          </div>
        ))}
      </div>

      {footer === undefined ? null : (
        <p className="px-4 pt-1.5 text-footnote text-[var(--label-tertiary)]">{footer}</p>
      )}
    </section>
  );
}
