/**
 * A Marmotter window, an inch across, drawn in one theme.
 *
 * The three-chip swatch beside a theme's name answers "what colours" and not
 * "what will this look like", and those are different questions: a person
 * picking a theme is asking whether they can read a channel in it, which three
 * rectangles cannot say. So this is the window itself in miniature — sidebar,
 * a conversation with names in it, a composer — laid out with the same tokens
 * and the same shapes as the real one, at a size that fits in a dropdown row.
 *
 * It draws no colours of its own, for the same reason the swatch does not:
 * `data-theme` on the frame makes every alias below it re-resolve against that
 * theme's primitives, so this cannot drift from the window it is previewing.
 * If a theme's nick colours are hard to tell apart, they are hard to tell apart
 * here too, which is the whole point of showing it.
 *
 * Inert and hidden from assistive technology: the row it sits in is already a
 * radio carrying the theme's name and description, and a screen reader reading
 * out a fake channel list after each one would be noise.
 */

import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import type { ThemeId } from '../themes.js';

/**
 * The made-up conversation.
 *
 * Names rather than lorem, because what a person is judging is whether eight
 * hashed nick colours read as eight people — and that needs names in different
 * colours sitting next to each other, which is exactly what a channel is.
 */
const LINES: readonly { readonly nick: string; readonly tone: string; readonly text: string }[] = [
  { nick: 'tamsin', tone: 'var(--nick-1)', text: 'morning all' },
  { nick: 'rook', tone: 'var(--nick-4)', text: 'is the build green yet' },
  { nick: 'iris', tone: 'var(--nick-6)', text: 'just went green' },
  { nick: 'tamsin', tone: 'var(--nick-1)', text: 'nice' },
];

export interface ThemePreviewProps {
  readonly theme: ThemeId;
  /**
   * `row` is the one that fits in a picker row; `panel` is the larger one under
   * the Theme setting, which has the room to show more of the window.
   */
  readonly size?: 'row' | 'panel';
  readonly className?: string;
}

export function ThemePreview({ theme, size = 'row', className }: ThemePreviewProps): ReactNode {
  const panel = size === 'panel';
  const lines = panel ? LINES : LINES.slice(0, 3);

  return (
    <div
      data-theme={theme}
      aria-hidden="true"
      className={cn(
        'flex shrink-0 overflow-hidden rounded-[6px] border border-[var(--separator)]',
        'bg-[var(--bg-base)] select-none',
        panel ? 'h-28 w-full' : 'h-11 w-[72px]',
        className,
      )}
    >
      {/* The sidebar: a network, then its channels, in the colours that tell a
          channel from a person. */}
      <div
        className={cn(
          'flex shrink-0 flex-col justify-start gap-[2px] bg-[var(--bg-elevated)] py-[3px]',
          panel ? 'w-20 gap-[3px] px-2 py-2' : 'w-[18px] px-[3px]',
        )}
      >
        <span
          className={cn('block rounded-full bg-[var(--status-connected)]', panel ? 'h-2' : 'h-1')}
          style={{ width: panel ? '60%' : '80%' }}
        />
        <span
          className={cn('block rounded-full bg-[var(--label-channel)]', panel ? 'h-2' : 'h-1')}
          style={{ width: panel ? '85%' : '100%' }}
        />
        <span
          className={cn('block rounded-full bg-[var(--label-channel)]', panel ? 'h-2' : 'h-1')}
          style={{ width: panel ? '70%' : '85%' }}
        />
        <span
          className={cn('block rounded-full bg-[var(--label-person)]', panel ? 'h-2' : 'h-1')}
          style={{ width: panel ? '50%' : '65%' }}
        />
      </div>

      {/* The conversation, and the composer under it. */}
      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div
          className={cn(
            'flex min-w-0 flex-col justify-start',
            panel ? 'gap-[3px] px-2 pt-2' : 'gap-[2px] px-[3px] pt-[3px]',
          )}
        >
          {lines.map((line, index) => (
            <div
              key={`${line.nick}-${index}`}
              className={cn('flex min-w-0 items-center', panel ? 'gap-1.5' : 'gap-[2px]')}
            >
              {panel ? (
                <>
                  <span
                    className="shrink-0 truncate text-right font-mono text-caption-2"
                    style={{ color: line.tone, width: 44 }}
                  >
                    {line.nick}
                  </span>
                  <span className="min-w-0 truncate font-mono text-caption-2 text-[var(--label-primary)]">
                    {line.text}
                  </span>
                </>
              ) : (
                // Too small for glyphs, so the columns are drawn as bars: the
                // nick keeps its own colour, which is the part being judged.
                <>
                  <span
                    className="block h-[3px] shrink-0 rounded-full"
                    style={{ background: line.tone, width: 16 }}
                  />
                  <span
                    className="block h-[3px] min-w-0 flex-1 rounded-full bg-[var(--label-primary)]"
                    style={{ opacity: 0.75 }}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* The composer, with the send button in the accent — the one place a
            theme's action colour is seen against its own surface. */}
        <div
          className={cn(
            'flex items-center',
            panel ? 'gap-1.5 px-2 pb-2' : 'gap-[2px] px-[3px] pb-[3px]',
          )}
        >
          <span
            className={cn(
              'block min-w-0 flex-1 rounded-full bg-[var(--fill-tertiary)]',
              panel ? 'h-3.5' : 'h-[5px]',
            )}
          />
          <span
            className={cn(
              'block shrink-0 rounded-full bg-[var(--accent)]',
              panel ? 'h-3.5 w-6' : 'h-[5px] w-2',
            )}
          />
        </div>
      </div>
    </div>
  );
}
