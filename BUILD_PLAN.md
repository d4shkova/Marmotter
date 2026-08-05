# Marmotter — Build Plan

Read `CLAUDE.md` first. It is the source of truth for stack, architecture, design
tokens, and product rules.

Work one phase at a time. Do not begin a phase until the previous phase's
acceptance criteria all pass. Each phase ends with a commit and a short written
summary of what was built and any deviation from this plan.

If a phase's instructions conflict with something discovered during
implementation, stop and say so rather than improvising a workaround.

---

## Phase 0 — Scaffold

Set up the monorepo exactly as laid out in `CLAUDE.md`.

- pnpm workspaces, the four `packages/`, `apps/desktop` and `apps/web`, an empty
  `crates/marmotter-transport`, an empty `relay/`.
- TypeScript strict config shared via a base tsconfig.
- Vite for both apps. Tauri v2 initialized in `apps/desktop`, targeting Linux and
  Windows.
- Tailwind v4 wired up, consuming the token CSS custom properties.
- Vitest configured. ESLint + Prettier. Husky pre-commit running lint and tests.
- GitHub Actions: a build matrix producing a Linux AppImage/deb and a Windows
  MSI on tag, plus a lint-and-test job on every push.

**Acceptance:** `pnpm install && pnpm test && pnpm build` succeeds from a clean
checkout. `pnpm tauri dev` opens an empty window on Linux. CI is green.

---

## Phase 1 — Protocol core

This is the foundation everything else rests on. It gets built and tested before
a single pixel of UI. `packages/protocol`, pure TypeScript, no I/O.

Build:

- **Line parser and serializer.** Full RFC 1459 / 2812 message grammar plus
  IRCv3 message tags: tag escaping and unescaping, prefixes, trailing
  parameters, 512-byte limits, and correct handling of malformed input without
  throwing.
- **Capability negotiation state machine.** `CAP LS 302`, multi-line responses,
  `CAP REQ`/`ACK`/`NAK`, `CAP NEW`/`DEL` via `cap-notify`, values on caps.
- **SASL.** PLAIN, EXTERNAL, and SCRAM-SHA-256, including the 400-byte
  base64 chunking rules and `AUTHENTICATE +`.
- **ISUPPORT parser** covering every token listed in `CLAUDE.md`, exposing a
  typed capability object that the rest of the app reads instead of assuming
  defaults.
- **Casemapping** implementations: `ascii`, `rfc1459`, `rfc1459-strict`. All
  target comparison and map keying goes through this, never `toLowerCase()`.
- **Numeric map.** Every numeric in `CLAUDE.md`'s numeric-handling section mapped
  to a typed, structured event. No numeric reaches a consumer as a raw string.
- **Mode parser.** Applies mode changes using ISUPPORT `CHANMODES` and `PREFIX`
  to determine which modes take parameters. Must handle compound changes like
  `+o-v+b nick1 nick2 mask` correctly.
- **CTCP** encode and decode, including quoting.
- **Batch** and **labeled-response** correlation.
- **Standard replies** (`FAIL`/`WARN`/`NOTE`) parsing.

Testing is the deliverable as much as the code:

- Import the official `ircdocs/parser-tests` vectors (msg-split, msg-join,
  userhost-split, mode-parsing) and run them all as fixtures. All must pass.
- Property-based round-trip test: serialize(parse(line)) === line for valid input.
- Hand-written fixture files of real session transcripts from Libera, OFTC, and
  ergo, replayed through the parser.
- Fuzz the parser with malformed input; it must never throw, only produce a
  typed parse failure.

**Acceptance:** All parser-tests vectors pass. Coverage on `packages/protocol`
above 90%. Zero dependencies in its `package.json`. Zero React or I/O imports.

---

## Phase 2 — Transport

> **Sequencing decision, 2026-07-30.** The relay and `RelayTransport` move to
> Phase 8, where the web app is built. Desktop uses `TauriTransport` and never
> touches the relay, so nothing in Phases 1–7 needs it; deferring avoids running
> an internet-facing proxy for months before a client can exercise it. The
> `Transport` interface and the `relay/` directory stay in place so the move
> costs no restructuring. Items marked *(deferred)* below are Phase 8 work.

- The `Transport` interface exactly as specified in `CLAUDE.md`.
- **`crates/marmotter-transport`**: Rust TCP + TLS via `tokio` and `rustls`. Exposed
  as Tauri commands with a line-oriented event channel to the front end. Supports
  certificate verification on, off, and fingerprint-pinned; client certificates
  for CertFP; SNI; connection timeouts. It does not parse IRC.
- **`TauriTransport`**, **`WebSocketTransport`** implementations.
- *(deferred to Phase 8)* **`relay/`**: the Go stateless WSS↔TCP relay,
  honouring every constraint in `CLAUDE.md`. Include a Dockerfile, a systemd
  unit, and a README covering deployment behind nginx on dashkova.co.uk with
  per-IP limits and the host allowlist policy.
- *(deferred to Phase 8)* **`RelayTransport`** implementation.
- Reconnection with exponential backoff and jitter, endpoint failover through the
  profile's server list, and correct teardown so no socket or listener leaks.

**Acceptance:** An integration test connects to a locally-spawned ergo over
plaintext and over TLS with a self-signed cert plus pinned fingerprint,
completing registration and joining a channel in both cases. Killing the server
mid-session triggers backoff reconnection without leaking handles. The relay
path is covered by Phase 8's acceptance instead.

---

## Phase 3 — Client state

`packages/client`. Consumes `packages/protocol` events and a `Transport`,
produces observable state. Still no React.

- Zustand store keyed by network ID from the outset. No global "current server".
- Per-network state: connection lifecycle, ISUPPORT, negotiated caps, own
  nick and modes, channels, queries, notify list, ignore list.
- Per-channel state: topic with setter and timestamp, modes, member list with
  prefixes and away and account status, ban/quiet/invex/except lists, message
  buffer.
- Member list correctness is a common source of bugs — drive it from
  `extended-join`, `account-notify`, `away-notify`, `chghost`, `setname`, and
  `multi-prefix` where available, with `WHO`/WHOX polling as the fallback.
- Message buffer with stable IDs (`msgid` tag where present, generated
  otherwise), deduplication, and correct ordering under `server-time`.
- `draft/chathistory` integration: backfill on join, paginated load-on-scroll,
  gap detection between local and server history.
- Optimistic send reconciled against `echo-message`.
- Nick collision fallback per `CLAUDE.md`.

**Acceptance:** A headless test harness drives a scripted session transcript
through the store and asserts final state. Specific cases covered: netsplit and
rejoin, mass `QUIT`, nick change of a channel operator, mode change while the
member list is loading, and `chathistory` backfill overlapping the live buffer
without duplicates.

> **Notes from implementation, 2026-08-02.** Phase 3 complete. Four things
> worth recording, because each was a decision rather than a transcription:
>
> - **The reducer is pure; a `Session` wraps it.** `reduce` takes one parsed
>   message and returns new state plus lines to send, with no I/O and no
>   timers, which is what makes the transcript harness possible. SASL cannot
>   live there — SCRAM derives keys through WebCrypto and returns a promise —
>   so the reducer reports `start-sasl` and `session.ts` drives the exchange.
> - **Sessions are not in the store.** The Zustand registry holds
>   `NetworkProfile` and reduced `NetworkState` keyed by network ID; the
>   `Session` objects, which own sockets and listeners, live beside it. There is
>   no "current network" in the store — selection is two fields nothing in
>   `packages/client` reads.
> - **`CHATHISTORY` moved into `packages/protocol`.** Request construction reads
>   `CHATHISTORY` and `MSGREFTYPES` from ISUPPORT, so a server that only accepts
>   timestamps is never sent a `msgid=` selector, and page sizes are clamped to
>   what the server will serve. Completeness and gaps are inferred from what
>   came back, since no server states either.
> - **WATCH joined MONITOR in the numeric map.** UnrealIRCd — including
>   `irc.dashkova.co.uk` — offers WATCH where Libera offers MONITOR. Both reduce
>   to the same `monitor` event, so the Friends panel in Phase 5 never learns
>   which mechanism it is running on, and a network with neither falls back to
>   polled `WHOIS`.
>
> One protocol bug found and fixed on the way: the session was sending its SASL
> initial response immediately after `AUTHENTICATE <MECH>` instead of waiting
> for the server's empty challenge.

---

## Phase 4 — Design system

`packages/ui`. Build the primitives before the app, so the app is assembled from
a consistent kit rather than one-off styling.

- `tokens.css` with every custom property from `CLAUDE.md`.
- Primitives: Button, IconButton, TextField, Select, Toggle, Stepper, Checkbox,
  Radio, ListRow, SectionHeader, Sheet, Modal, Popover, ContextMenu, Toast,
  Tooltip, Badge, Avatar, Spinner, EmptyState, SegmentedControl, SearchField,
  Table, Tabs.
- iOS grouped-list conventions: inset rounded groups, hairline separators that
  stop short of the leading edge, chevron affordances, footer explanatory text.
- Nav bar with large-title collapse, and a bottom tab bar for mobile widths.
- Blur/vibrancy layers per the design section.
- **The decoder component.** Hover on desktop, long-press on touch, rendering a
  plain-English explanation of any protocol token. Backed by an explanation
  dictionary covering mode letters, numerics, and common services responses.
- Storybook, with a story per component and per state, plus light-on-dark
  contrast checks in CI.

**Acceptance:** Storybook builds and covers every component. Every component
passes axe with no violations. No hardcoded hex value exists anywhere in
`packages/ui` outside `tokens.css`. Keyboard focus is visible on every
interactive element.

> **Notes from implementation, 2026-08-02.** Phase 4 complete.
>
> - **The acceptance criteria are tests, not review items.** `no-literals.test.ts`
>   scans every source file for hex, `rgb()`, and Tailwind's own palette;
>   `stories.test.ts` asserts every exported component appears in a story;
>   `a11y.test.tsx` renders each component and runs axe over it. A rule that is
>   only written down decays, and these three are exactly the kind nobody
>   notices breaking.
> - **Contrast is checked where axe cannot see it.** jsdom has no layout and no
>   computed colours, so axe's contrast rule is switched off there and
>   `tokens.test.ts` checks the ramp arithmetically instead — which is stronger,
>   since it covers combinations no story happens to render.
> - **Two colour tokens were added**, `--control-knob` and `--scrim`. Both were
>   about to become a literal `white` and a literal `rgba(0,0,0,0.5)` at a call
>   site, which is exactly what the no-literals rule exists to prevent.
> - **axe found three real defects** while the components were being written: a
>   `<label for>` pointing at a span with a `spinbutton` role, an `aria-label` on
>   a plain span where it is ignored, and `aria-expanded` on a wrapper with no
>   widget role. All three would have shipped invisibly.
> - **Storybook's a11y addon is the interactive panel, not the gate.** The gate
>   is the vitest suite, which runs in CI already; adding the Storybook test
>   runner would mean a second browser install for a check that is covered.
>
> The decoder reads the network's own `PREFIX` and `CHANMODES` where the caller
> passes them, because `+q` is channel ownership on some ircds and a mute list
> on others — and a decoder that guesses is worse than none.

---

## Phase 5 — Core application shell

Wire Phases 3 and 4 into a usable client.

- Three-column responsive layout, collapsing per the breakpoints in `CLAUDE.md`.
- Network and channel sidebar with unread and highlight indicators, drag
  reordering, and per-network grouping.
- Virtualized compact message list implementing every bullet in the message list
  section of `CLAUDE.md`.
- Composer: multi-line, nick tab-completion, channel completion, emoji, drafts
  preserved per target, `draft/typing` indicators.
- Member list with role icons, away dimming, search, and a context menu.
- "Add a network" flow, including the per-endpoint TLS choice with the security
  implications written in plain language, and a set of preset profiles for
  Libera.Chat, OFTC, and `irc.dashkova.co.uk`.
- Command bar with autocomplete and inline docs, including `/raw` and `/quote`.
- Per-network raw log tab with direction indicators, filtering, and copy.
- Settings: appearance, notifications, logging policy, ignore list, per-network
  overrides.
- Desktop notifications with highlight-word matching.

**Acceptance:** A person who has never used IRC can install the desktop app,
connect to Libera.Chat with SASL, join a channel, send and receive messages,
and see a member list — without typing a slash command or encountering a raw
numeric. Playwright covers this path end to end against local ergo.

> **Progress, 2026-08-02. Phase 5 is part-done; this is what is and is not in.**
>
> **In:** the responsive shell at all three breakpoints; the sidebar with
> unread and highlight badges, per-network grouping, drag reordering and a
> keyboard equivalent; the virtualized message list with folded events, day
> separators, collapsed nick columns, the unread marker, hover actions with no
> layout shift, and history paging that preserves scroll position; the composer
> with tab completion, per-target drafts, input history and typing indicators;
> the member list with `PREFIX`-derived roles, away dimming, search and a
> context menu; the "Add a network" flow with the security choice in plain
> language and the three presets; the command set with `/raw` and `/quote`; and
> the raw log with direction, filtering and copy. Both apps mount one shared
> `Marmotter` component, so desktop and web cannot drift.
>
> **Not yet in:** the settings screens, desktop notifications, the channel
> browser, emoji entry, the command bar's autocomplete surface (the command
> table and parser are done and tested; what is missing is the popup that shows
> them while typing), and the Playwright run against local ergo. The acceptance
> criterion above is therefore not yet met and Phase 6 must not start.
>
> **Phase 5 complete, 2026-08-03.** The Playwright run against a local ergo now
> exists and passes, which closes the last item. It drives the *browser* build,
> because ergo speaks WebSocket and a browser is far cheaper to automate than a
> Tauri window — and both builds mount the same `Marmotter` component, so what
> is under test is the desktop client's own interface with a different socket
> under it. The acceptance sentence is asserted in two halves: the whole path is
> driven through the interface with no slash command, and the message list is
> then scanned for numerics and mode strings.
>
> Setting it up found a real hole. The "Add a network" form had no way to enter
> a WebSocket endpoint, so the web build could not add a network it was capable
> of reaching — the one transport it has. It has one now.
>
> **Progress, 2026-08-03.** The settings screen landed earlier; this pass adds
> the remaining four. What is left of Phase 5 is the Playwright run against a
> local ergo, and nothing else.
>
> - **The command bar's autocomplete surface.** `suggest.ts` is a pure function
>   of the text and the caret, which is what makes the offset arithmetic
>   testable without a DOM — and that arithmetic is where this feature goes
>   wrong, because a wrong `from` silently eats what somebody typed. The popup
>   shows each command's parameters, its one-sentence summary, and where the
>   same thing lives in the interface, so `/mode` teaches that the channel
>   settings panel exists rather than just completing.
> - **Emoji entry**, both ways: `:shortcode` completion through the same popup,
>   and a picker on the composer. Shortcodes resolve on send, so typing the
>   whole thing and picking from the list produce the same line. The set is
>   hand-picked rather than the full Unicode table — several hundred kilobytes
>   of bundle for a long tail nobody reaches for is a bad trade, and the system
>   emoji keyboard still covers everything.
> - **Desktop notifications.** Mentions and direct messages only, and only when
>   the window is not in front. Two things needed care: WebView2 has no web
>   `Notification` API, so Windows goes through `tauri-plugin-notification` and
>   the browser path would have silently done nothing; and a `chathistory`
>   backfill must not arrive as a burst of notifications, which is why the
>   shell records a conversation's tail on first sight without acting on it.
> - **The channel browser**, which is Phase 6 work pulled forward because
>   `/list` had nowhere to put its answer — a numeric per channel is exactly
>   what CLAUDE.md says never to render. `RPL_LIST` now reduces into a
>   `directory` on the network state, capped at twenty thousand rows with the
>   truncation stated plainly rather than silently shown as if it were the whole
>   network. Rows render as they arrive; search filters client-side, because
>   every ircd spells the server-side `LIST` filter differently.
>
> The a11y and story gates from Phase 4 caught two defects on the way, which is
> the second time they have paid for themselves: `role="combobox"` is not
> allowed on a textarea, and the browser had no story.
>
> Two notes on decisions taken along the way:
>
> - **The shell lives in `packages/ui`, not a new package.** It needs both the
>   design system and `@marmotter/client`, and CLAUDE.md's repository layout has
>   no fourth package for it. `packages/ui/src/app/` depends on `client`;
>   `primitives/` still does not.
> - **Interface state is a second store.** Selection, drafts, unread counts and
>   appearance are not network state, and putting "have I read this" in the
>   reducer would make the reducer answer questions it cannot know. It holds no
>   message content, on any platform.

---

## Phase 6 — The abstraction layer

Now build the differentiating product surface: every row of the abstraction table
in `CLAUDE.md`.

- Channel Settings panel driven by ISUPPORT `CHANMODES`.
- Channel Moderation panel: bans, quiets, invite exceptions, ban exceptions, each
  a table with a mask builder and remove actions.
- Member role assignment filtered by advertised `PREFIX`.
- Remove / remove-and-ban with reason.
- User profile card from WHOIS.
- Channel browser from LIST, searchable and sortable.
- Account panel: SASL setup, NickServ registration wizard where SASL is
  unavailable, password and email management, cloak requests.
- Channel permissions grid over ChanServ FLAGS/ACCESS, with services-package
  detection and a graceful degradation path when the package is unrecognized.
- Notify list over MONITOR with WHOIS-polling fallback.
- Client-side ignore with mask builder and expiry.
- Away status control.
- Invite send and receive.
- Automatic CTCP responses, configurable.

Every one of these keeps the raw command working in parallel. Every one surfaces
errors as plain-English guidance per the interface copy rules.

**Acceptance:** Each panel round-trips against a local ergo instance and against
a local Atheme-backed InspIRCd instance, verifying the abstraction works across
two different services implementations. Every error path in the panels shows a
human sentence, not a numeric — assert this in tests.

> **Progress, 2026-08-03. Every row of the abstraction table is now built.**
>
> **Phase 6 complete, 2026-08-03.** Both halves of the acceptance now run, in
> `e2e/`. Against ergo, through the interface: a channel setting is changed in
> the settings panel and read back from what the server actually applied, the
> browser lists what the network has, and a second real client joins, speaks and
> leaves while the member list follows. Against **Anope on InspIRCd** — a
> different services package on a different ircd, which is what the criterion is
> actually about — the account and permissions commands are accepted and the
> replies are fed through the same parsers the panels use.
>
> Anope rather than Atheme because that is what `irc.dashkova.co.uk` runs, so it
> is the package this client has to be right about first. The criterion asks for
> two implementations that disagree; these two disagree plenty.
>
> **It found two real defects immediately, which is the entire argument for
> testing against something other than one server:**
>
> - **Services detection was built on the wrong signal.** It read the MOTD and
>   server notices for a package name. Against a real Anope, *nothing a client
>   sees during registration names the services package* — not the MOTD, not
>   `RPL_MYINFO`, not ISUPPORT. It only appeared to work locally because the
>   test server's own MOTD said "Anope", a false positive of my own making. The
>   plan said "detected from version replies" and meant it: asking NickServ for
>   its version answers plainly, so that is what the panels do now, once, when
>   they open. The MOTD reading survives as a fallback for networks that do say.
> - **The Anope access list was parsed for a shape Anope does not print.** The
>   parser expected a numeric level (`1  10  tamsin`); real Anope with its XOP
>   module — which is the normal configuration — names the role instead
>   (`1  AOP  member`). The grid silently showed nothing on a channel that had
>   entries. Both shapes are read now, and the tests carry the output captured
>   verbatim from Anope 2.0.12 rather than a guess.
>
> Everything else the panels send was confirmed accepted as written: `REGISTER`,
> `SET PASSWORD`, `SET EMAIL`, `HostServ REQUEST`, `AOP ... ADD`, `ACCESS ... LIST`.
>
> Two things the end-to-end run turned up, both worth recording:
>
> - **The browse-channels action was unreachable once you had joined a channel.**
>   It lived only in the sidebar's empty state, so the person most likely to want
>   it — somebody looking for a second channel — could not find it. It is in the
>   network header now, beside "join".
> - **`echo-message` made the client answer its own CTCP requests.** Our own
>   outgoing request comes back as an echo, and the reducer treated it as a
>   question from ourselves: a spurious reply on the wire and a notice claiming
>   we had been asked something. Found by watching the raw log during an
>   end-to-end run, which is exactly what CLAUDE.md says the raw log is for.
>
> One limitation, recorded because it looks like a bug and is not ours: **ergo's
> WebSocket listener doubles the `\u0001` CTCP delimiter** when relaying from a
> TCP client. It reproduces with a raw WebSocket and no Marmotter code in the
> loop. Accepting a doubled delimiter would mean a parser that disagrees with
> the CTCP spec, so the request path is covered by unit tests instead and the
> desktop build's TCP transport is unaffected.
>
> Four decisions worth recording:
>
> - **A mode letter nobody can describe gets no control.** The panel builds
>   itself from `CHANMODES`, but only shows a switch where the decoder has a
>   sentence for the letter. Inventing a label would put a control in front of
>   somebody with no way to know what it does; those letters stay reachable
>   from the command bar, and the panel's footer says so. Same rule for the
>   tabs: a network with no mute list gets no Muted tab.
> - **Replacing a channel password takes two changes, not one.** Most ircds
>   refuse a second `+k` rather than replacing the key, so the diff emits
>   `-k+k old new`. This is the kind of thing that works against the one server
>   you tested and fails everywhere else, which is why it is a test and not a
>   comment.
> - **`EXTBAN` decides whether an account ban is offered at all.** The prefix
>   differs by ircd, and a network advertising no `a` extban never sees the
>   option — per CLAUDE.md, a ban type the network cannot enforce is never
>   offered. Cloaks widen from the right (`libera/staff/*`) and DNS names from
>   the left (`*.isp.example`), because the two read in opposite directions;
>   IPv6 is never widened, since guessing a prefix length from text is how a
>   client bans a continent.
> - **List modes are fetched when their tab is opened**, not on join. Four
>   `MODE +b` queries per channel at join time is a burst of traffic for tables
>   most people never open, and some networks rate-limit it.
>
> **The people surface.** Away is a switch with a message beside it, and coming
> back is a thing you press — the state moves when the server says so, never
> when we ask. The friends list runs on MONITOR, WATCH, or a slow WHOIS poll and
> never says which, because it changes nothing a person can act on. Ignoring
> somebody gets scope checkboxes and a duration rather than a timestamp.
> Invitations became state, not a line that scrolls away: an `invite-notify`
> about somebody else is not ours to accept, walking in answers the invitation
> however the join happened, and dismissing sends nothing, because IRC has no
> way to decline and a button that claimed otherwise would be lying.
>
> **The account surface.** Services are the least discoverable part of IRC, and
> the packages disagree about everything. Detection reads ISUPPORT first (the
> only signal that arrives before anyone speaks) then the network's own words,
> and an unrecognised package still gets a working panel on the forms Atheme and
> Anope share — while saying it is guessing. This matters more than it sounds:
> ergo takes the email *before* the password, so sending Atheme's `REGISTER`
> form would register somebody's password as their email address.
>
> **CTCP replies** finally exist. The protocol layer has been ready since Phase
> 1; the reducer was not. `PING` echoes the asker's own payload because they are
> timing it, `CLIENTINFO` advertises only what is switched on, a CTCP reply is
> never itself answered, and none of it reaches the message list — a request is
> a quiet notice naming what was asked in plain English.
>
> **The permissions grid follows the package rather than the spec.** CLAUDE.md
> asks for members down the side and capabilities across the top, which is the
> right shape for Atheme — and a lie on Anope and ergo, which store roles and
> levels. A grid there would round somebody's choices to the nearest role and
> silently discard the rest, so those packages get a role per person instead.
> Two further rules: the grid diffs only the columns it displays, so it can
> never strip a flag set by hand that it does not show; and services output is
> parsed forgivingly and narrowly, showing the reply verbatim rather than a
> confidently wrong table, because services output is not a protocol.

---

## Phase 7 — Local logging

- SQLite schema and plaintext writer, both implementing `LoggingPolicy`.
- Off by default. Enabling it is an explicit, informed choice.
- Retention purge job, per-network overrides, open-log-folder, export.
- Local full-text search across logs.
- **Verify by test** that the web build contains no persistence path: assert the
  bundle has no `localStorage`, `IndexedDB`, or SQLite reference reachable from
  message handling code.

**Acceptance:** Logs write, purge on schedule, export correctly, and search
returns accurate results across networks. The web bundle test passes.

---

## Phase 8 — Web app

- `apps/web` builds and deploys to dashkova.co.uk.
- Transport selection: direct `WebSocketTransport` when the profile specifies a
  `wss://` endpoint, `RelayTransport` otherwise.
- Session-only state. Nothing persisted. A clear, non-alarming notice in the UI
  explaining that history is not stored in the browser and where it does come
  from.
- Profiles configurable per session, with the presets available. Optional
  export/import of a profile as a file the user holds, containing no secrets.
- Service worker for asset caching only — never message content.
- Deployment docs: nginx config, relay deployment, TLS termination, CSP headers.

**Acceptance:** The web app connects to `irc.dashkova.co.uk` directly over WSS
and to Libera.Chat through the relay, in current Firefox, Chrome, and Safari.
After a hard reload, no message content is recoverable from any browser storage —
verify by inspection in a test.

---

## Phase 9 — Android

- Tauri v2 mobile target. `TauriTransport` works unchanged.
- Mobile layout: bottom tabs, slide-over channel list, bottom-sheet member list,
  swipe actions, safe-area insets, keyboard avoidance.
- Foreground service to hold the connection while the app is visible or recently
  backgrounded, with honest documentation of Android's background limits.
- **No push infrastructure.** Where a user wants reliable delivery, the app
  documents pointing Marmotter at their own ZNC or soju as a network profile, and
  the connection UI makes that a first-class option rather than an afterthought.
- Signed APK in CI.

**Acceptance:** APK installs and runs on Android 13+, connects, and survives a
screen rotation and a short backgrounding with the session intact.

---

## Explicitly out of scope for v1

Do not build these, and do not leave partial implementations behind:

- DCC sending, DCC CHAT, and passive/reverse transfers. (A **receive-only** DCC
  file monitor — desktop only, off by default — was added after v1 scoping;
  see the DCC row in `CLAUDE.md`. Sending and the interactive/reverse modes stay
  out: their security surface is disproportionate to value.)
- Any end-to-end encryption, or any UI implying messages are private from the
  server operator.
- Server-side accounts, user databases, or hosted message retention.
- A scripting or plugin API. Design `packages/client` cleanly enough that one is
  possible later, but ship no API surface now.
- Push notification infrastructure.
- macOS and iOS builds. Tauri makes them cheap to add later; they need signing
  hardware and are not a v1 target.
- Theming beyond the shipped blue dark palette. **User-selectable themes are a
  planned follow-up, not a v1 feature** (decided 2026-07-30). Ship one palette,
  but keep the two-layer token structure in `CLAUDE.md` intact — primitives and
  semantic aliases — so adding a theme later is a token swap and not a refactor.
  Do not build theme-switching UI, a theme file format, or persistence for it
  now; do reject any component that reaches past an alias to a primitive, or
  hardcodes a colour, because each one is a thing a future theme cannot move.
