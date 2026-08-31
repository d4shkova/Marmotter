# Marmotter — Project Context

## What this is

A modern, multi-network IRC client with a GUI shell that hides IRC's command-line
surface behind conventional chat-app interactions. Runs as a Linux desktop app,
Windows desktop app, browser web app, and (later) Android APK from one codebase.

The thesis: IRC is excellent technology with a hostile learning curve. Almost all
of that curve is incidental — raw numeric replies, mode strings, services
`/msg` incantations. None of it needs to be user-facing. Marmotter exposes the full
capability of the protocol through a UI a person can use without reading a manual,
while keeping every raw escape hatch available for people who want it.

## What this is NOT

- **Not a secure messenger.** IRC has no end-to-end encryption. Messages are
  plaintext on the server. Do not add, imply, or design around E2EE. Transport
  security is TLS only, configured per-network.
- **Not a hosted service.** Marmotter stores no user data server-side. There is no
  account system, no user database, no message retention on any server we run.
- **Not a bouncer.** If a user wants persistent presence, they point Marmotter at
  their own ZNC or soju as a normal network profile.
- **Not tied to any single network.** `irc.dashkova.co.uk` is one profile among
  many. Libera.Chat, OFTC, and arbitrary user-specified servers are first-class.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| UI | React 19 + TypeScript (strict) | |
| Build | Vite | |
| Desktop shell | Tauri v2 | Linux + Windows from one codebase |
| Mobile shell | Tauri v2 mobile | Android, later phase |
| Styling | Tailwind CSS v4 + CSS custom properties | Tokens defined as CSS vars, see Design |
| State | Zustand | One store per network, plus a root registry |
| Virtualization | `@tanstack/react-virtual` | Required for the message list |
| Local DB | SQLite via `tauri-plugin-sql` | Desktop/mobile only, never web |
| Relay (web only) | Go, single binary | Stateless WSS↔TCP pipe |

Package manager: **pnpm**. Monorepo via pnpm workspaces.

## Repository layout

```
marmotter/
├── packages/
│   ├── protocol/        # Pure TS. No I/O, no React. IRC parser + IRCv3.
│   ├── client/          # Connection state machine, event → state reduction
│   ├── ui/              # React components, design system
│   ├── shared/          # Types shared across packages
│   └── platform-tauri/  # Capabilities the two Tauri shells share
├── apps/
│   ├── desktop/         # Tauri v2 app (Linux, Windows)
│   ├── web/             # Vite web build
│   └── android/         # Tauri v2 mobile
├── crates/
│   ├── marmotter-transport/ # Rust: TCP/TLS sockets
│   └── marmotter-shell/     # Tauri commands both shells share
└── relay/               # Go stateless WSS↔TCP relay
```

`platform-tauri` and `marmotter-shell` are the same decision made twice, once
per language. The desktop and Android apps are two shells over one interface,
and most of what they give the shell is the same code calling the same
commands — the socket, the log files, the settings file, the notification
service. Duplicating that would mean two copies of the log stores and the
preference parser, which are the files where a quiet divergence loses somebody
their scrollback or their networks. What stays in each app is what only that
platform has: window chrome on desktop; the keystore, the link intent and the
foreground service on Android.

**The web build imports neither, and must keep importing neither.** That
absence is what guarantees a browser tab cannot persist message content.

## Critical architectural rule

**All IRC protocol logic lives in TypeScript, in `packages/protocol`.**

Rust does exactly one job: open a TCP socket, negotiate TLS, and stream bytes
in both directions. It does not parse IRC. It does not know what a channel is.

Reason: the web build has no Rust. If protocol logic lives in Rust, it must be
reimplemented for the browser, and the two implementations will diverge. Keeping
parsing in TS means desktop, web, and Android share one battle-tested parser.

## Transport model

`packages/client` depends on a `Transport` interface, never on a concrete
implementation:

```ts
interface Transport {
  connect(opts: ConnectOptions): Promise<void>;
  send(line: string): void;
  onLine(cb: (line: string) => void): () => void;
  onClose(cb: (reason: CloseReason) => void): () => void;
  disconnect(): void;
}
```

Three implementations:

| Impl | Platform | Path |
|---|---|---|
| `TauriTransport` | Desktop, Android | Tauri command → Rust TCP/TLS → any network directly |
| `WebSocketTransport` | Web | Direct WSS, for networks that expose a WS listener |
| `RelayTransport` | Web | WSS to our Go relay → TCP, for networks that don't |

The web app picks `WebSocketTransport` when the network profile specifies a
`wss://` endpoint, otherwise `RelayTransport`. Desktop always uses
`TauriTransport` and never touches the relay.

### The relay

`relay/` is a Go binary that accepts a WSS connection, opens a TCP/TLS
connection to the host and port the client requests, and pipes bytes between
them. Constraints, which are product requirements not implementation details:

- Stores nothing. No disk writes, no database, no message buffer beyond the
  in-flight socket buffer.
- Logs no message content, no nicks, no channel names. Connection-level
  counters and errors only.
- Holds no state across connections. When the WebSocket closes, the TCP
  connection closes and everything is discarded.
- Enforces an allowlist-or-any policy configurable at deploy time, plus
  per-IP connection limits, to avoid being an open proxy.

## Protocol requirements

### IRCv3 capabilities to request

Non-negotiable — the UX depends on these:

`sasl` (PLAIN, EXTERNAL, SCRAM-SHA-256), `server-time`, `echo-message`,
`message-tags`, `batch`, `labeled-response`, `multi-prefix`, `extended-join`,
`away-notify`, `account-notify`, `account-tag`, `chghost`, `setname`,
`invite-notify`, `standard-replies`, `draft/chathistory`, `cap-notify`,
`draft/message-redaction`, `+draft/reply`, `+draft/react`, `draft/typing`,
`draft/read-marker`.

Every capability must degrade gracefully. A network supporting none of these
must still be fully usable — features light up when the server advertises them.
Never assume a cap is present.

### Numeric handling

Numeric replies are **never rendered raw** in the message list. Each numeric is
either consumed into state or mapped to a human-readable UI event. Reference
`packages/protocol/src/numerics.ts` for the full map. Categories:

- **Registration** (001–005, 251–255, 265–266): consumed into connection state.
  RPL_ISUPPORT (005) must be parsed thoroughly — `PREFIX`, `CHANMODES`,
  `CHANTYPES`, `CASEMAPPING`, `TARGMAX`, `NETWORK`, `CHANLIMIT`, `MAXLIST`,
  `MODES`, `STATUSMSG`, `MONITOR`, `WATCH`, `EXTBAN`, `WHOX`, `UTF8ONLY`.
  Behaviour must adapt to it rather than hardcoding assumptions. `EXTBAN`
  matters more than it looks: the prefix differs by ircd (`~` on UnrealIRCd,
  `$` on solanum), so the ban builder reads it rather than assuming, and a
  network that cannot enforce a ban type is never offered it.
- **Names/topic** (332, 333, 353, 366): consumed into channel state.
- **MOTD** (372, 375, 376, 422): collapsed into one expandable server-notice item.
- **WHOIS/WHOWAS** (311–319, 330, 338, 671): assembled into a user profile card.
- **Lists** (367/368 bans, 346/347 invex, 348/349 excepts, 728/729 quiets):
  assembled into sortable tables with remove actions.
- **Errors** (401, 403, 404, 421, 432, 433, 437, 441, 442, 461, 471–478, 482,
  484): mapped to plain-English messages with a suggested action. See
  "Interface copy" below.

### Nick collision

On 433/436/437 during registration, fall back through the profile's alt-nick
list, then append underscores. Surface it as a quiet inline notice, not a modal.
Never silently connect under a nick the user didn't expect without telling them.

## Network profile schema

Multi-network is a day-one requirement. Retrofitting it is painful, so the store
is keyed by network from the first commit — there is no "current server" global.

```ts
interface NetworkProfile {
  id: string;
  name: string;                    // "Libera.Chat"
  servers: ServerEndpoint[];       // tried in order, with backoff
  identity: {
    nick: string;
    altNicks: string[];
    username: string;
    realname: string;
  };
  auth?:
    | { type: 'sasl-plain'; account: string; password: SecretRef }
    | { type: 'sasl-external'; certPath: string }   // CertFP
    | { type: 'sasl-scram'; account: string; password: SecretRef }
    | { type: 'server-password'; password: SecretRef }
    | { type: 'nickserv'; account: string; password: SecretRef }; // legacy fallback
  autojoin: { target: string; key?: SecretRef }[];
  connectCommands: string[];       // raw lines sent post-registration
  encoding: string;                // default 'utf-8', fallback for legacy nets
  autoReconnect: boolean;
  logging: LoggingPolicy;          // see Logging
}

interface ServerEndpoint {
  host: string;
  port: number;
  tls: TlsConfig;
}

type TlsConfig =
  | { mode: 'off' }
  | { mode: 'tls'; verifyCert: true }
  | { mode: 'tls'; verifyCert: false; pinnedFingerprint?: string }  // SHA-256
  | { mode: 'websocket'; url: string };   // wss:// direct, no relay
```

TLS is chosen **per server endpoint at profile-creation time**, surfaced in the
"Add a network" form as a clear choice with the security implication stated in
plain language. Default for a new profile: port 6697, TLS on, certificate
verification on. Self-signed acceptance requires an explicit opt-in and offers
fingerprint pinning; never silently accept an unverified certificate.

Secrets (`SecretRef`) go to the OS keychain via `tauri-plugin-stronghold` or
platform keyring on desktop. On web, secrets live in memory for the session only
and are never persisted.

## Settings export and import

The same person runs this on a desktop, a phone and in a browser, and setting up
the second one must not mean typing the first one's networks in again. Settings
travels as one JSON document, built and read in
`packages/ui/src/app/config-transfer.ts` — pure functions, no I/O, testable on
their own — and shown by the two sheets in `ConfigTransfer.tsx`.

Three rules, all of them load-bearing:

- **No secret is ever in it.** A profile carries a `SecretRef` and never a
  password, and the document carries the reference for the same reason the
  settings file does: it keeps "this network signs in with SASL as tamsin"
  intact while the value stays in the platform's keychain. The password is typed
  once on the receiving device; re-importing on the device that wrote the file
  finds its own keychain entries under those references and needs nothing typed.
  The sheets say so in as many words rather than letting somebody assume a
  backup includes their passwords.
- **No path that belongs to one device.** The download folder and the log folder
  are stripped on the way out and filled in from the receiving device on the way
  in — a phone has neither of a desktop's, and on Android neither is the user's
  to choose at all.
- **No message content, on any platform.** Logs are not settings.

Reading is deliberately forgiving, because the two ends will be on different
releases more often than not: every field falls back to its own default, so a
document from a build that did not have a setting yet is not a document that
fails to load. What is refused is only what cannot be understood — text that is
not JSON, or JSON that does not say it is one of these. The document's own
`version` is separate from the app's, and a newer one is read rather than
refused.

**Copying the text is the feature; the file is the extra.** Every platform can
put text on a clipboard, and only some have file dialogs — so the export is a
text box with a Copy button everywhere, and desktop additionally gets Save and
Load through `ConfigFileAccess` (`crates/marmotter-shell/src/textfile.rs`,
registered on desktop alone). A feature that needed a file would have been a
desktop feature with a phone footnote, which is the opposite of the point.

Importing replaces the networks and every setting on the screen, registers each
profile **without connecting it** — the same reasoning as a restart — and says
what it is about to do before it does it.

## Logging and retention

Model this on mIRC and HexChat: the user owns their logs, stored locally, in
their control. We are never a custodian.

```ts
interface LoggingPolicy {
  enabled: boolean;
  scope: { channels: boolean; privateMessages: boolean; serverNotices: boolean };
  format: 'sqlite' | 'plaintext';   // plaintext mirrors HexChat's layout
  retentionDays: number | 'forever';
  path?: string;                     // user-selectable, defaults to app data dir
}
```

Platform behaviour, non-negotiable:

- **Desktop / Android**: logging available, **off by default**. When enabled,
  writes to local SQLite or plaintext files. Settings expose retention purge,
  per-network overrides, "open log folder", and export.
- **Web**: no persistence whatsoever. Scrollback lives in memory and dies with
  the tab. No `localStorage`, no `IndexedDB`, no cookies holding message content.
  History beyond the session comes only from server-side `draft/chathistory`
  where the network supports it. If it doesn't, scrollback starts empty and the
  empty state says so plainly.

## Design

The brief pins the direction: **modern iOS dark**. Follow Apple's actual system
values rather than approximating. Define all of these as CSS custom properties in
`packages/ui/src/tokens.css` and reference them everywhere — no hardcoded colors
in components.

### Color

The palette is **one blue family, plus red**. Hue carries no decorative meaning,
so red is reserved: it appears only for errors, alerts, and destructive actions.
Seeing red anywhere in the interface always means the same thing. There is no
green, amber, purple, or pink primitive to reach for — adding a colour means
adding a semantic alias and justifying it, not picking a hue.

Tokens live in `packages/ui/src/tokens.css` in **two layers**:

1. **Primitives** — the raw ramp. Every literal colour in the product is here
   and nowhere else.
2. **Semantic aliases** — what components actually reference. These point at
   primitives through `var()`, never at literals.

A theme redefines the primitives; the aliases follow. That is what makes later
theming a token swap rather than a refactor.

```
/* primitives: the blue ramp */
--blue-050: #F2F8FF    --blue-500: #0A84FF   /* systemBlue dark */
--blue-100: #DCECFF    --blue-600: #0A6FD8
--blue-200: #BFDDFF    --blue-700: #0A5AB0
--blue-300: #8CC4FF    --blue-800: #0B4586
--blue-400: #5AABFF    --blue-900: #0A2F5C

/* primitives: the ends of the family, for nick variety */
--cyan-300: #7FE2F5    --periwinkle-300: #C3CCFF
--cyan-400: #4FD1E8    --periwinkle-400: #A9B6FF
--cyan-500: #40C8E0    --indigo-400:     #8280FF

/* primitives: blue-biased neutrals */
--ink-000: #000000     --ink-800: #1A2430
--ink-900: #101720     --ink-700: #26333F   --ink-600: #33414F

/* primitives: alarm, and the only non-blue in the system */
--red-400: #FF6961     --red-500: #FF453A   --red-900: #3A0F0C

/* semantic aliases */
--bg-base / --bg-elevated / --bg-elevated-2 / --bg-elevated-3
--fill-primary … --fill-quaternary
--label-primary … --label-quaternary
--separator, --separator-opaque
--accent, --accent-hover, --accent-pressed, --accent-muted, --on-accent
--danger, --danger-hover, --danger-muted
--status-connected, --status-connecting, --status-failed
--nick-1 … --nick-8
```

Connection health is shown in blue — connected is bright, connecting is dim —
so red is never spent on a state that is merely in progress.

Nick colours are hashed from the normalised nick across `--nick-1`–`--nick-8`.
Within a single hue family they separate mostly by lightness, which is a real
constraint: `packages/ui/src/tokens.test.ts` checks every one clears 4.5:1
against `--bg-base` and that no two are perceptually closer than a set
threshold. Widening the palette means widening that ramp, not adding hues.

### Themes

The description above is the default theme, **Midnight**. Twelve more ship
beside it — Monochrome, Ember, Blossom, Paper, Nebula, and the seven named in
French: Menthe, Lagune, Néon, Sapin, Crépuscule, Orage, Brume — and each is
exactly what this section promises a theme is: a block of primitives under
`[data-theme='…']` in `tokens.css`, with the alias layer written once for all of
them. Adding one means adding a block and a row in
`packages/ui/src/themes.ts`; it must never mean touching a component.

Three rules hold across all of them. The alias layer is selected by `:root` and
by `[data-theme]`, so a theme applied to a nested element re-resolves against
its own primitives — that is what lets the picker draw each swatch in the theme
it names. Translucent tokens are mixed from a primitive with `color-mix` rather
than written as `rgba`, so a light theme inverts its scrim, fills and labels
from one value each. And every theme is held to the same accessibility floor as
the default: `tokens.test.ts` checks the eight voices, the label colours, the
accent and the status colours for each one.

Ember and Paper are built on red, which is the one place the reserved-hue rule
bends — somebody asked for those palettes. Alarm stays distinguishable in both:
the danger red is a different red from the accent, far enough from it to read as
one, and the test asserts that rather than trusting it. The same test holds the
line the other way for the themes whose accent family is green or teal: alarm is
still the one warm colour in the interface, whether that is a red or, in Menthe,
the single hot pink the palette keeps for it.

### Typography

`-apple-system, "SF Pro Text", "Inter var", system-ui, sans-serif` for UI.
`"SF Mono", "JetBrains Mono", ui-monospace, monospace` for nicks, message body,
and raw log.

iOS text styles, as `size/line-height weight`:

```
large-title  34/41 700     headline  17/22 600
title-1      28/34 700     body      17/22 400
title-2      22/28 700     callout   16/21 400
title-3      20/25 600     subhead   15/20 400
                           footnote  13/18 400
                           caption-1 12/16 400
                           caption-2 11/13 400
```

### Geometry and motion

4px spacing grid. 16px screen margins. Radii: 10px controls, 14px cards,
20px sheets. `backdrop-filter: blur(20px) saturate(180%)` on nav bars, sheets,
and the composer, over a translucent `--bg-elevated`.

Motion: 200ms `cubic-bezier(0.32, 0.72, 0, 1)` for sheets and transitions,
120ms ease-out for hover and press states. Respect `prefers-reduced-motion` by
cutting transforms and keeping opacity changes only.

### Layout

- **Desktop (≥1024px)**: three columns — network/channel sidebar, message list,
  collapsible member list. Sidebar collapsible to icons.
- **Tablet (768–1023px)**: two columns, member list becomes a sheet.
- **Mobile (<768px)**: single column, bottom tab bar, channel list as a
  slide-over, member list as a bottom sheet with a grabber. Swipe actions on
  list rows.

### The signature element

The **decoder**. Any piece of IRC arcana that appears in the interface — a mode
string, a numeric-derived error, a services response, a CTCP exchange — is
hoverable (long-press on touch) and expands into one plain-English sentence
explaining what it means and what it does. `+mnt` becomes "Only voiced users can
speak. Outside messages are blocked. Only ops can change the topic."

This is the one place to spend visual boldness. Everything else stays quiet and
disciplined. It is also the feature that most directly serves the project's
reason for existing, so it ships in the first UI phase, not as a later polish item.

## The abstraction layer

The core product work. Every row below is a requirement, and in every case the
underlying raw command must remain available via the command bar.

| IRC reality | Marmotter interface |
|---|---|
| `MODE #c +b nick!user@host` | Right-click member → Ban. Ban builder offers host/account/nick scope with a preview of the resulting mask. |
| `MODE #c +q`, `+I`, `+e` | Mute / Invite exceptions / Ban exceptions, as tabs in a Channel Moderation panel with tables and Remove buttons. |
| `MODE #c +mtnsiкl` | Channel Settings panel: labelled toggles. `+k` is a "Password" field, `+l` a "Member limit" stepper. Parse `CHANMODES` from ISUPPORT rather than hardcoding. |
| `MODE #c +o/+h/+v` | Role dropdown per member: Owner / Admin / Operator / Half-op / Voice / Member, filtered by what `PREFIX` advertises. |
| `KICK`, `KICK` + ban | Remove / Remove and ban, with an optional reason field. |
| `/msg NickServ REGISTER`, `IDENTIFY`, `SET` | Account panel. Registration wizard, password change, email, cloak request. SASL preferred; NickServ used only where SASL is unavailable. |
| `/msg ChanServ FLAGS/ACCESS` | Channel permissions grid: members down the side, capabilities across the top, checkboxes. Translates to whichever services package the network runs (Atheme, Anope, ergo built-in) detected from version replies. |
| `WHOIS` | User profile card: account, real host, channels, idle, away, server, bot flag, secure connection indicator. |
| `LIST` | Searchable, sortable channel browser with user counts and topics, paginated, with a warning-free progress state on large networks. |
| `NAMES` / `WHO`+WHOX | Member list with role icons, away dimming, account badges. Uses WHOX where advertised. |
| `AWAY` | Status control: Available / Away with message, in the account menu. |
| `NOTICE` | Distinct styling, routed to a server tab or the relevant channel, never mistakable for a normal message. |
| `CTCP VERSION/PING/TIME` | Answered automatically, configurable; requests surfaced as a quiet notice, not a message. |
| `DCC` / `XDCC` | **Receive-only. Desktop and Android; never web.** A file monitor (off by default, enabled under Settings → User options) lists files in a panel and downloads them on request. It sees files two ways: a direct `DCC SEND`, and XDCC pack advertisements — the `#N Ngx [size] name` catalogue lines serving bots post in a channel (`packages/protocol/src/xdcc.ts`). Downloading a pack sends `XDCC SEND #N` to the bot; its answering `DCC SEND` (`packages/protocol/src/dcc.ts`) is matched back to that row and fetched. Two things come between those, because in practice they are what decides whether a file arrives. A bot answers a request with a notice long before it answers with a file — a queue position, or a refusal — so those are read (`parseXdccResponse`) and turned into the row's own words (`applyXdccResponse`): a queue position keeps it waiting, "you must be on a known channel" fails it with the thing to do about it, and a request nobody is waiting for any more is withdrawn rather than left in the bot's queue to be answered into nothing — `XDCC REMOVE` for a queue place, `XDCC CANCEL` for a transfer the bot has already opened, which is also sent before a retry, since a bot holding a pending transfer answers the next request with "you have a DCC pending" until its own timeout. A pack is asked for by typing the message at least as often as by pressing the button — every index prints the message, not a button — so an outgoing `xdcc send #N` is recognised wherever it was typed and registered as the same request, and an offer for a listed row that nothing here started is announced rather than fetched on the sender's say-so or dropped in silence. And a pack request is more often pasted than browsed — every index on the web hands out an `irc://` link and a literal `/msg Bot xdcc send #N` — so `parseXdccRequest` reads that pair, the link picks the network among those connected and joins the channel it names, and the row that results behaves from then on like one the monitor saw advertised. An offer that claims to be a file and cannot be read as one is listed as a failed row carrying the raw line rather than dropped, because a person who asked for a file and got nothing cannot otherwise tell an unanswered request from an answer this client did not understand. The socket-to-file download is `crates/marmotter-transport/src/dcc.rs`, behind a Tauri command shared by both shells (`crates/marmotter-shell/src/dcc.rs`), and it reads the offer's variant rather than assuming the plain one: an `SSEND` is a TLS socket and is dialled as one — the certificate cannot be verified against an address and is not, so what the handshake buys is confidentiality in transit — and a `TSEND` sender never reads its socket, so the four-byte acknowledgements are omitted for it rather than filling its window until our write blocks. Both were previously dialled as ordinary sends, which fails in the way that looks exactly like a firewall. The two shells differ only around it: desktop picks the download folder with a dialog and can reveal a saved file in the file manager, and Android does neither — an app there writes inside its own storage or asks for a permission that would let it read the whole device, and no file manager will open that storage — so the shell names the folder itself and the reveal button is absent rather than drawn and broken. Web has no file monitor at all: a browser tab has no folder and cannot open the direct socket. A transfer that broke part-way is continued rather than started again: bytes go to a `.part` file that survives a failure (a cancel discards it — stopping a download is somebody saying they do not want it), and the next attempt asks the sender to resume from what is there (`buildDccResume`) and begins at the position the sender names back (`parseDccAccept`), which is not always the one asked for. A sender that never answers is not one that refused: the file simply starts again. Passive (reverse) offers are received too, because they are how a sender that cannot be connected to hands over a file, and refusing them made a whole class of bot unusable for reasons the interface then had to describe as somebody else's fault. There the socket is ours: the shell binds one, the reply carries the port and the offer's token back (`buildPassiveAccept`), and only the sender's own address is accepted on it — the port is advertised in a message anybody may be reading, and the alternative is that the first stranger to dial it decides what lands in the download folder. It needs an address the sender can reach, which the shell reads off the route to them and which behind a router is not the one this machine knows about, so Settings can name the address to give out and a transfer with neither says so rather than timing out. **Sending and DCC CHAT remain out of scope**; their security surface is disproportionate to value. |
| `INVITE` | Invite button in the channel menu with a nick picker; incoming invites become an actionable notification. |
| `MONITOR` / `WATCH` | Notify list: a "Friends" panel showing online/offline, using MONITOR where advertised, polled WHOIS as fallback. |
| `IGNORE` | Client-side mute list, per-network, with mask builder and expiry. |

### Escape hatches

Both required, both accessible from the first release:

1. **Command bar.** Every standard slash command works, including `/quote` and
   `/raw` for arbitrary lines. Autocomplete with inline documentation for each.
2. **Raw log tab.** Per-network, showing the full bidirectional line stream with
   send/receive direction, timestamps, filter, and copy. This is how a power
   user trusts the client, and how bugs get reported.

## Message list

Compact IRC-native lines, not chat bubbles.

- Virtualized. Channels reach tens of thousands of lines.
- Fixed-width timestamp and nick columns so message text is left-aligned into a
  single readable edge. Nick column width user-configurable, with a
  "right-align nicks" option as in HexChat.
- Deterministic nick coloring, hashed from the normalized nick, from a palette
  contrast-checked to at least 4.5:1 against `--bg-base`.
- Consecutive messages from one nick collapse the nick column.
- Join/part/quit/nick-change events fold into a single collapsible summary row
  ("8 people joined") rather than one row each. Configurable per channel.
- `ACTION` renders in italic with the nick inline.
- Hover actions right-aligned: reply, react, copy, more. Absolutely no layout
  shift on hover.
- Replies render as a single-line quote chip above the message, using
  `+draft/reply`. No nested threading UI.
- Own-message state: optimistic render, reconciled against `echo-message` where
  available, with a clear un-acknowledged indicator otherwise.
- Timestamps from `server-time` when present, local clock otherwise, with the
  distinction visible on hover.
- Link detection, with an inline unfurl that is **off by default** — unfurling
  leaks the user's IP to arbitrary hosts and that tradeoff must be the user's
  explicit choice.

## Interface copy

The client's purpose is approachability, so copy is functional, not decorative.

- Plain verbs, sentence case, active voice. Buttons name what happens: "Join
  channel", not "Submit".
- Name things by what the user controls, never by protocol mechanism. "Only
  members can send messages", not "channel mode +n".
- An action keeps its name through the whole flow. "Ban" produces "Banned".
- Errors state what happened and what to do, in the interface's voice, and never
  apologize. `473 ERR_INVITEONLYCHAN` becomes "#channel is invite-only. You'll
  need an invitation from someone already in the channel." with a "Request an
  invite" action where possible.
- Empty states are invitations to act, not decoration. An empty channel list
  says "You haven't joined any channels yet" with a Browse action.
- Never surface a numeric, a mode letter, or a raw protocol token in primary
  copy. Those belong in the decoder and the raw log.

## Conventions

- TypeScript strict. No `any`. No non-null assertions outside tests.
- `packages/protocol` has zero dependencies and zero I/O. It is pure functions
  and classes over strings and objects, and must be testable in isolation.
- Vitest for unit tests. Playwright for end-to-end against a local ergo instance.
- Conventional commits.
- No `localStorage` or `IndexedDB` for message content on any platform, ever.
- Accessibility floor, not negotiable: full keyboard navigation, visible focus
  rings, correct ARIA roles on the message log (`log`/`feed`), screen-reader
  announcements for new messages in the focused channel, respected reduced
  motion, and text scaling to 200% without loss of function.
