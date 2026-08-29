import type { ChannelState, Member, NetworkState } from '@marmotter/client';
import { sortMembers } from '@marmotter/client';
import { fold, prefixRank } from '@marmotter/protocol';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../lib/cn.js';
import { nickColorVar } from '../lib/nick-color.js';
import { Badge } from '../primitives/Badge.js';
import { ContextMenu, type MenuItem } from '../primitives/ContextMenu.js';
import { SearchField } from '../primitives/SearchField.js';
import { useLongPress } from '../lib/long-press.js';

export interface MemberListProps {
  readonly network: NetworkState;
  readonly channel: ChannelState;
  /** Built by the caller, which knows what the user is allowed to do. */
  readonly menuFor?: (member: Member) => readonly MenuItem[];
  /** Double-clicking a name messages them, as in most chat apps. */
  readonly onMessage?: (nick: string) => void;
  readonly onOpenProfile?: (nick: string) => void;
  readonly className?: string;
}

/**
 * The member list.
 *
 * Role icons come from the network's own `PREFIX` rather than a hardcoded
 * `@%+`, because networks add owner and admin prefixes in their own order and
 * a client that assumes one is wrong on half of them.
 */
export function MemberList({
  network,
  channel,
  menuFor,
  onMessage,
  onOpenProfile,
  className,
}: MemberListProps): ReactNode {
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<
    { readonly member: Member; readonly x: number; readonly y: number } | undefined
  >(undefined);

  const members = useMemo(
    () => sortMembers(channel.members, network.support),
    [channel.members, network.support],
  );

  const filtered = useMemo(() => {
    if (query === '') {
      return members;
    }
    const needle = fold(query, network.support.caseMapping);
    return members.filter((member) =>
      fold(member.nick, network.support.caseMapping).includes(needle),
    );
  }, [members, query, network.support.caseMapping]);

  const away = members.filter((member) => member.away).length;

  return (
    <aside
      aria-label={`Members of ${channel.name}`}
      className={cn(
        'flex h-full w-full flex-col border-l border-[var(--separator)] bg-[var(--bg-elevated)]',
        className,
      )}
    >
      <div className="flex shrink-0 flex-col gap-2 px-3 py-2">
        <h2 className="text-footnote font-medium tracking-wide text-[var(--label-tertiary)] uppercase">
          {members.length} {members.length === 1 ? 'person' : 'people'}
          {away > 0 ? ` · ${away} away` : ''}
        </h2>
        <SearchField label="Search members" value={query} onValueChange={setQuery} />
      </div>

      {/* `min-h-0` is what lets this shrink below its content and scroll:
          without it a flex item is floored at its content height, which on a
          busy channel means the list runs past the bottom of whatever is
          holding it and the names at the end cannot be reached at all. */}
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {filtered.map((member) => {
          const openMenu = (x: number, y: number): void => {
            if (menuFor !== undefined) {
              setMenu({ member, x, y });
            }
          };

          return (
            <MemberRow
              key={member.nick}
              member={member}
              network={network}
              openMenu={openMenu}
              hasMenu={menuFor !== undefined}
              {...(onMessage === undefined ? {} : { onMessage })}
              {...(onOpenProfile === undefined ? {} : { onOpenProfile })}
            />
          );
        })}
      </ul>

      {menu === undefined || menuFor === undefined ? null : (
        <ContextMenu
          open
          label={`Actions for ${menu.member.nick}`}
          at={{ x: menu.x, y: menu.y }}
          items={menuFor(menu.member)}
          onClose={() => setMenu(undefined)}
        />
      )}
    </aside>
  );
}

/**
 * One name in the list, with every way there is to reach its actions.
 *
 * Three of them, because three kinds of input reach this row: right-click for a
 * pointer, the `⋯` button for a keyboard, and a long press for a finger. The
 * button is drawn on hover for a pointer and always where the pointer is
 * coarse — a control revealed by a hover that a touch screen cannot perform is
 * a control a phone does not have.
 */
function MemberRow({
  member,
  network,
  openMenu,
  hasMenu,
  onMessage,
  onOpenProfile,
}: {
  member: Member;
  network: NetworkState;
  openMenu: (x: number, y: number) => void;
  hasMenu: boolean;
  onMessage?: (nick: string) => void;
  onOpenProfile?: (nick: string) => void;
}): ReactNode {
  const longPress = useLongPress(hasMenu ? (at) => openMenu(at.x, at.y) : undefined);

  return (
    <li className="group/member relative">
      <button
        type="button"
        // Double-click messages them — the convention the interface
        // copy calls out. A single click opens their details.
        onDoubleClick={() => onMessage?.(member.nick)}
        onClick={() => onOpenProfile?.(member.nick)}
        onContextMenu={(event) => {
          if (!hasMenu) {
            return;
          }
          event.preventDefault();
          openMenu(event.clientX, event.clientY);
        }}
        {...longPress}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-1 text-left',
          // Roomier where a finger is doing the aiming. A 24px row is
          // fine under a pointer and is half a touch target.
          'pointer-coarse:min-h-11 pointer-coarse:py-2',
          'hover:bg-[var(--fill-quaternary)] active:bg-[var(--fill-tertiary)]',
          // Held names must not turn into a text selection or the
          // system's own copy menu part-way through the gesture.
          'pointer-coarse:touch-manipulation pointer-coarse:select-none',
          member.away && 'opacity-50',
        )}
      >
        <RoleGlyph member={member} network={network} />
        <span
          className="min-w-0 flex-1 truncate font-mono text-footnote"
          style={{
            color: `var(${nickColorVar(member.nick, fold(member.nick, network.support.caseMapping))})`,
          }}
        >
          {member.nick}
        </span>
        {member.bot ? <Badge>Bot</Badge> : null}
        {member.account === undefined ? null : (
          <span
            title={`Logged in as ${member.account}`}
            className="text-caption-2 text-[var(--label-quaternary)]"
          >
            <span aria-hidden="true">✓</span>
            <span className="sr-only">Logged in as {member.account}</span>
          </span>
        )}
      </button>

      {/* A visible way to reach the actions, since right-click is not
                  discoverable and touch has no right-click at all. */}
      {!hasMenu ? null : (
        <button
          type="button"
          aria-label={`Actions for ${member.nick}`}
          onClick={(event) => openMenu(event.clientX, event.clientY)}
          className={cn(
            'absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full',
            'pointer-coarse:size-11 pointer-coarse:right-1',
            'text-[var(--label-tertiary)] hover:bg-[var(--fill-secondary)]',
            'opacity-0 group-hover/member:opacity-100 focus:opacity-100',
            // Nothing hovers on a phone, so nothing would ever reveal
            // it there.
            'pointer-coarse:opacity-100',
          )}
        >
          <span aria-hidden="true">⋯</span>
        </button>
      )}
    </li>
  );
}

/**
 * The role marker beside a nick.
 *
 * The prefix character itself is what every other IRC client shows and what a
 * long-time user recognises, so it stays — with the role's name attached for
 * everyone else and for screen readers.
 */
function RoleGlyph({ member, network }: { member: Member; network: NetworkState }): ReactNode {
  const prefix = member.prefixes[0];
  if (prefix === undefined) {
    return <span aria-hidden="true" className="w-3 shrink-0" />;
  }

  const rank = prefixRank(prefix, network.support);
  const name = ROLE_NAMES[network.support.prefixes.length - 1 - rank] ?? 'Role';

  return (
    <span
      title={name}
      className="w-3 shrink-0 text-center font-mono text-footnote text-[var(--accent)]"
    >
      <span aria-hidden="true">{prefix}</span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

/** Names for the prefixes in the order a network advertises them. */
const ROLE_NAMES = ['Owner', 'Admin', 'Operator', 'Half-op', 'Voice'];
