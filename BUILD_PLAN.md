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

- The `Transport` interface exactly as specified in `CLAUDE.md`.
- **`crates/marmotter-transport`**: Rust TCP + TLS via `tokio` and `rustls`. Exposed
  as Tauri commands with a line-oriented event channel to the front end. Supports
  certificate verification on, off, and fingerprint-pinned; client certificates
  for CertFP; SNI; connection timeouts. It does not parse IRC.
- **`TauriTransport`**, **`WebSocketTransport`** implementations.
- **`relay/`**: the Go stateless WSS↔TCP relay, honouring every constraint in
  `CLAUDE.md`. Include a Dockerfile, a systemd unit, and a README covering
  deployment behind nginx on dashkova.co.uk with per-IP limits and the
  host allowlist policy.
- **`RelayTransport`** implementation.
- Reconnection with exponential backoff and jitter, endpoint failover through the
  profile's server list, and correct teardown so no socket or listener leaks.

**Acceptance:** An integration test connects to a locally-spawned ergo over
plaintext, over TLS with a self-signed cert plus pinned fingerprint, and via the
relay, completing registration and joining a channel in all three cases. Killing
the server mid-session triggers backoff reconnection without leaking handles.

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

- DCC in any form.
- Any end-to-end encryption, or any UI implying messages are private from the
  server operator.
- Server-side accounts, user databases, or hosted message retention.
- A scripting or plugin API. Design `packages/client` cleanly enough that one is
  possible later, but ship no API surface now.
- Push notification infrastructure.
- macOS and iOS builds. Tauri makes them cheap to add later; they need signing
  hardware and are not a v1 target.
- Theming beyond the shipped iOS dark palette. A light mode may follow, but the
  tokens must be structured so it is a token swap and not a refactor.
