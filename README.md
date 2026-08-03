# Marmotter

A modern, multi-network IRC client. Linux and Windows desktop, browser web app,
and Android later, from one codebase.

IRC is excellent technology with a hostile learning curve, and almost all of that
curve is incidental. Marmotter exposes the full capability of the protocol
through an interface you can use without reading a manual, and keeps every raw
escape hatch available for people who want it.

Read [`CLAUDE.md`](./CLAUDE.md) for the architecture, design tokens, and product
rules. Read [`BUILD_PLAN.md`](./BUILD_PLAN.md) for the phase-by-phase plan.

## Status

Phases 0 through 5 are complete. Phase 6 — the abstraction layer — is built and
passes against ergo; it is not finished until it has also been run against an
Atheme-backed InspIRCd, which is what proves the services translation works
across two packages.

`packages/protocol` implements the line parser and serializer, IRCv3 capability
negotiation, SASL (PLAIN, EXTERNAL, SCRAM-SHA-256), ISUPPORT, casemapping, the
numeric map, the mode parser, CTCP, batch and labeled-response correlation, and
standard replies. It passes the official `ircdocs/parser-tests` vectors, and
SCRAM reproduces the RFC 7677 test vector.

`crates/marmotter-transport` opens TCP and TLS sockets over tokio and rustls,
with certificate verification full, off, or pinned to a SHA-256 fingerprint,
client certificates for CertFP, SNI, and connection timeouts. It frames lines
and nothing more. `packages/client` adds the `TauriTransport` and
`WebSocketTransport` implementations plus reconnection with exponential backoff,
jitter, and endpoint failover, and reduces the event stream into per-network
state.

`packages/ui` holds the design system and the application shell — both apps
mount the same `Marmotter` component, so desktop and web cannot drift. What a
person can do without typing a command: connect, join, talk, browse the
network's channels, change a channel's settings and its ban, mute, invite and
allow lists, build a ban by scope with a preview of who it would catch, remove
somebody with a reason, register and manage a network account, request a cloak,
set who can do what in a channel, keep a friends list and a mute list, go away
and come back, and send and receive invitations. Every raw command still works,
and the raw log shows both directions of the wire.

## Testing

Unit and component tests run without anything installed:

```sh
pnpm test
```

The transport integration tests and the end-to-end run both need a real ergo:

```sh
curl -sSL -o ergo.tar.gz \
  https://github.com/ergochat/ergo/releases/download/v2.15.0/ergo-2.15.0-linux-x86_64.tar.gz
tar xzf ergo.tar.gz && sudo install -m 755 ergo-*/ergo /usr/local/bin/ergo
ergo initdb --conf e2e/ergo.yaml
```

Without it the transport tests skip rather than fail. The end-to-end run drives
the browser build against that ergo, and starts both the server and the app
itself:

```sh
pnpm e2e
```

## Requirements

| Tool | Version | Needed for                     |
| ---- | ------- | ------------------------------ |
| Node | 22+     | everything                     |
| pnpm | 10+     | everything                     |
| Rust | stable  | desktop shell, transport crate |
| Go   | 1.24+   | the web relay                  |

On Debian or Ubuntu the desktop shell also needs the Tauri system libraries:

```sh
sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf
```

## Getting started

```sh
pnpm install
pnpm test          # vitest across every package
pnpm build         # packages, then both app bundles
pnpm dev:web       # the web app on http://localhost:5173
pnpm tauri dev     # the desktop app
```

Other useful scripts:

```sh
pnpm lint          # eslint
pnpm typecheck     # tsc across the whole workspace, including tests
pnpm coverage      # vitest with v8 coverage and the protocol threshold
pnpm format        # prettier
```

Rust and Go are checked with their own toolchains:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd relay && go vet ./...
```

## Layout

```
marmotter/
├── packages/
│   ├── protocol/            # Pure TS. No I/O, no React. IRC parser + IRCv3.
│   ├── client/              # Connection state machine, event → state reduction
│   ├── ui/                  # React components, design system, tokens.css
│   └── shared/              # Types shared across packages
├── apps/
│   ├── desktop/             # Tauri v2 app (Linux, Windows)
│   └── web/                 # Vite web build
├── crates/
│   └── marmotter-transport/ # Rust: TCP/TLS sockets, exposed as Tauri commands
└── relay/                   # Go stateless WSS↔TCP relay
```

All IRC protocol logic lives in TypeScript, in `packages/protocol`. Rust opens
sockets and streams bytes; it never parses IRC. The web build has no Rust, and a
second protocol implementation would inevitably diverge from the first.

## Guardrails enforced by the build

These rules from `CLAUDE.md` fail the build rather than the review:

- `packages/protocol` declares no dependencies of any kind, and lint forbids it
  importing React, Node built-ins, workspace packages, or I/O globals.
- `packages/client` cannot reference `localStorage`, `sessionStorage`, or
  `indexedDB`. Message content is never persisted to web storage.
- No hardcoded colour may appear in `packages/ui` outside `tokens.css`, and the
  token values are asserted against the palette in `CLAUDE.md`.
- Coverage on `packages/protocol` must stay above 90%.
- TypeScript strict, no `any`, no non-null assertions outside tests.

## Icons

`apps/desktop/src-tauri/app-icon.png` is the 1024px source. Regenerate the
platform icon set with:

```sh
pnpm --filter @marmotter/desktop tauri icon src-tauri/app-icon.png
```

## Licence

MIT.
