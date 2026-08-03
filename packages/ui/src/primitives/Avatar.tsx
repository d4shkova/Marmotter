import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { nickColorVar } from '../lib/nick-color.js';

export type AvatarSize = 'small' | 'medium' | 'large';

export interface AvatarProps {
  readonly nick: string;
  readonly size?: AvatarSize;
  /** Dims the avatar, matching how an away member's row reads. */
  readonly away?: boolean;
  readonly className?: string;
}

const SIZES: Record<AvatarSize, string> = {
  small: 'size-6 text-caption-2',
  medium: 'size-8 text-footnote',
  large: 'size-11 text-callout',
};

/**
 * An initial in a tinted circle.
 *
 * IRC has no avatars, so there is nothing to fetch — which is a feature: a
 * client that loaded a picture per nick would leak the user's IP to whoever
 * hosted it, and CLAUDE.md makes that tradeoff the user's explicit choice
 * everywhere else too.
 */
export function Avatar({ nick, size = 'medium', away = false, className }: AvatarProps): ReactNode {
  const initial = [...nick].find((character) => /\p{L}|\p{N}/u.test(character)) ?? nick[0] ?? '?';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-medium',
        'bg-[var(--fill-secondary)]',
        away && 'opacity-50',
        SIZES[size],
        className,
      )}
      style={{ color: `var(${nickColorVar(nick)})` }}
    >
      {initial.toUpperCase()}
    </span>
  );
}
