import type { ChannelState, Member, NetworkState } from '@marmotter/client';
import { sortMembers } from '@marmotter/client';
import { fold, prefixRank } from '@marmotter/protocol';
import { type ReactNode, useMemo, useState } from 'react';
import { cn } from '../lib/cn.js';
import { nickColorVar } from '../lib/nick-color.js';
import { Badge } from '../primitives/Badge.js';
import { ContextMenu, type MenuItem } from '../primitives/ContextMenu.js';
import { SearchField } from '../primitives/SearchField.js';

export interface MemberListProps {
  readonly network: NetworkState;
  readonly channel: ChannelState;
  /** Built by the caller, which knows what the user is allowed to do. */
  readonly menuFor?: (member: Member) => readonly MenuItem[];
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
      <div className="flex flex-col gap-2 px-3 py-2">
        <h2 className="text-footnote font-medium tracking-wide text-[var(--label-tertiary)] uppercase">
          {members.length} {members.length === 1 ? 'person' : 'people'}
          {away > 0 ? ` · ${away} away` : ''}
        </h2>
        <SearchField label="Search members" value={query} onValueChange={setQuery} />
      </div>

      <ul className="flex-1 overflow-y-auto pb-2">
        {filtered.map((member) => (
          <li key={member.nick}>
            <button
              type="button"
              onClick={() => onOpenProfile?.(member.nick)}
              onContextMenu={(event) => {
                if (menuFor === undefined) {
                  return;
                }
                event.preventDefault();
                setMenu({ member, x: event.clientX, y: event.clientY });
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1 text-left',
                'hover:bg-[var(--fill-quaternary)]',
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
          </li>
        ))}
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
