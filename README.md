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

Without it the transport tests skip rather than fail.

The end-to-end run also exercises the panels against a second services package
— Anope on InspIRCd — because the translation layer is only proven by two
implementations that disagree:

```sh
sudo apt-get install -y inspircd anope
# Anope's packaged config is root:irc 0640, and the suite reads it as you.
sudo chmod a+r /etc/anope/*.conf
# Both ship an AppArmor profile confining the daemon to the directories it was
# installed with; the suite runs throwaway servers from generated configs in
# the workspace.
sudo apparmor_parser -R /etc/apparmor.d/usr.sbin.inspircd
sudo apparmor_parser -R /etc/apparmor.d/usr.sbin.anope
```

Then, which starts every server it needs and the app itself:

```sh
pnpm e2e
```

## Building an installable app

One command, from a clean checkout:

```sh
pnpm install
pnpm tauri build
```

The bundler produces whatever the machine you are on can make. There is no
cross-compiling here: a Linux build has to run on Linux and a Windows build on
Windows.

### Linux

Three things first, none of which are Marmotter's. On Debian or Ubuntu:

```sh
# 1. The Tauri system libraries. WebKitGTK is the webview the shell renders in.
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf

# 2. Rust, for the transport crate and the shell.
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"

# 3. Node 22+ and pnpm 10+, however you normally install them.
corepack enable && corepack prepare pnpm@10 --activate
```

Then:

```sh
pnpm install
pnpm tauri build
```

That produces all three Linux formats:

```
target/release/bundle/deb/Marmotter_0.1.0_amd64.deb
target/release/bundle/rpm/Marmotter-0.1.0-1.x86_64.rpm
target/release/bundle/appimage/Marmotter_0.1.0_amd64.AppImage
```

with the unbundled binary at `target/release/marmotter-desktop`, which runs on
its own if you would rather not install anything.

Pick a subset when you do not want all three — the AppImage takes the longest
and is by far the largest, because it carries its own GTK and WebKit:

```sh
pnpm tauri build --bundles deb           # deb only
pnpm tauri build --bundles deb,rpm       # both packages, no AppImage
```

Two things worth knowing. The AppImage bundler downloads `linuxdeploy` and its
GTK plugin on first use, so that one format needs network access at bundle
time; `deb` and `rpm` do not. And the `.deb` declares `libwebkit2gtk-4.1-0` and
`libgtk-3-0` as its runtime dependencies, so it installs on Debian 12 and
Ubuntu 22.04 or newer, but not on anything still shipping the WebKitGTK 4.0
series.

Install and run what you built:

```sh
sudo apt install ./target/release/bundle/deb/Marmotter_0.1.0_amd64.deb
marmotter-desktop
```

It also lands in the applications menu as Marmotter.

Verified on Ubuntu 22.04 in CI and on Ubuntu 24.04 by hand. For other distros,
the equivalent packages are listed in
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

### Windows

| Needed                                                    | Why                                                   |
| --------------------------------------------------------- | ----------------------------------------------------- |
| [Rust](https://rustup.rs/), MSVC toolchain                | The transport is Rust; the shell is Tauri.            |
| Visual Studio Build Tools, "Desktop development with C++" | What Rust links against on Windows.                   |
| WebView2 runtime                                          | Already present on Windows 11 and current Windows 10. |

`pnpm tauri build` then produces an MSI and an NSIS installer, in
`target\release\bundle\msi\` and `target\release\bundle\nsis\`.

### Or let CI do it

For a build without installing any of the above, push a tag:

```sh
git tag v0.1.0 && git push origin v0.1.0
```

The release workflow builds Windows and Linux and attaches the installers to a
draft release.

While working on the app itself, `pnpm tauri dev` is faster — it runs the same
shell with the frontend hot-reloading, and no bundle step.

## Requirements

| Tool | Version | Needed for                     |
| ---- | ------- | ------------------------------ |
| Node | 22+     | everything                     |
| pnpm | 10+     | everything                     |
| Rust | stable  | desktop shell, transport crate |
| Go   | 1.24+   | the web relay                  |

The desktop shell also needs its platform's system libraries — WebKitGTK and
friends on Linux, the MSVC toolchain and WebView2 on Windows. Both are in
[Building an installable app](#building-an-installable-app), which is the one
place they are written down.

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
