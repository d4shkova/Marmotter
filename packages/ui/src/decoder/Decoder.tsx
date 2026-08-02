import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../lib/cn.js';
import { type Explained, type ModeContext, explain, explainToText } from './explain.js';

export interface DecoderProps {
  /** The arcana as it appeared: `+mnt`, `473`, `VERSION`, `SASL`. */
  readonly token: string;
  /** What to show in the flow of the interface. Defaults to the token. */
  readonly children?: ReactNode;
  /** The network's own mode grouping, where the caller has it. */
  readonly context?: ModeContext;
  /** Overrides the automatic lookup, for a caller that knows the kind. */
  readonly explained?: Explained;
  readonly className?: string;
}

/** How long a press has to last, on touch, before the panel opens. */
const LONG_PRESS_MS = 450;

/**
 * The decoder — the signature element.
 *
 * Any piece of IRC arcana in the interface is hoverable on desktop and
 * long-pressable on touch, and expands into plain English. This is the feature
 * that most directly serves the project's reason for existing, so it is the one
 * place the design spends visual boldness.
 *
 * It is a `button` rather than a hover target with a tooltip, deliberately: the
 * explanation has to be reachable by keyboard and by screen reader, and a
 * hover-only affordance is available to neither. The plain-English text is also
 * attached to the trigger with `aria-describedby` while open, so a screen
 * reader reads the meaning rather than the mode letters.
 */
export function Decoder({
  token,
  children,
  context,
  explained,
  className,
}: DecoderProps): ReactNode {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapper = useRef<HTMLSpanElement>(null);

  const result = explained ?? explain(token, context);
  const summary = explainToText(result);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent): void => {
      if (wrapper.current !== null && !wrapper.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const startPress = (): void => {
    pressTimer.current = setTimeout(() => setOpen(true), LONG_PRESS_MS);
  };
  const cancelPress = (): void => clearTimeout(pressTimer.current);

  return (
    <span ref={wrapper} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        // The meaning, not the token, is what a screen reader should read.
        aria-describedby={open ? panelId : undefined}
        aria-label={result.unknown ? undefined : `${token}: ${summary}`}
        onClick={() => setOpen((current) => !current)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onTouchStart={startPress}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cn(
          'font-mono text-[0.95em] text-[var(--accent)]',
          // A dotted underline is the long-standing "there is more here"
          // convention, and unlike a hover-only highlight it is visible before
          // the pointer arrives — which is the whole point on touch.
          'decoration-dotted underline underline-offset-[3px]',
          'rounded-[4px] px-0.5 hover:bg-[var(--accent-muted)]',
        )}
      >
        {children ?? token}
      </button>

      {open && !result.unknown ? (
        <span
          id={panelId}
          role="tooltip"
          className={cn(
            'absolute bottom-full left-0 z-40 mb-2 w-max max-w-80',
            'rounded-card border border-[var(--accent-muted)] p-3',
            'bg-[var(--bg-elevated-3)] [backdrop-filter:var(--blur-vibrancy)] shadow-xl',
          )}
        >
          <span className="flex flex-col gap-2.5">
            {result.parts.map((part) => (
              <span key={part.token} className="flex flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="font-mono text-caption-1 text-[var(--accent)]">
                    {part.token}
                  </span>
                  <span className="text-footnote font-semibold text-[var(--label-primary)]">
                    {part.explanation.title}
                  </span>
                </span>
                <span className="text-footnote text-[var(--label-secondary)]">
                  {part.explanation.detail}
                </span>
                {part.explanation.caveat === undefined ? null : (
                  <span className="text-caption-1 text-[var(--label-tertiary)]">
                    {part.explanation.caveat}
                  </span>
                )}
              </span>
            ))}
          </span>
        </span>
      ) : null}
    </span>
  );
}
