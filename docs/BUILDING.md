# Building Marmotter — cheat sheet

One codebase, two desktop builds. There is no cross-compiling: **build Linux on
Linux and Windows on Windows.** For both without installing anything, push a tag
and let CI do it.

Everything below is run from the repository root.

---

## Get the source

```sh
git clone https://github.com/d4shkova/Marmotter.git
cd Marmotter
```

Submodules aren't used, so a plain clone is enough. If you already have a
checkout, `git pull` before building.

---

## Common to both

| Tool | Version | Get it                                                   |
| ---- | ------- | -------------------------------------------------------- |
| Node | 22+     | nodejs.org, nvm, or your package manager                 |
| pnpm | 10+     | `corepack enable && corepack prepare pnpm@10 --activate` |
| Rust | stable  | [rustup.rs](https://rustup.rs/)                          |

```sh
pnpm install          # once, and after any dependency change
pnpm tauri build      # the whole thing: frontend, Rust, bundles
```

The workspace packages do **not** need building first — Vite resolves them to
source. `pnpm install && pnpm tauri build` works from a clean checkout.

---

## Linux

### Prerequisites — Debian / Ubuntu

```sh
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
```

### Prerequisites — CachyOS / Arch

```sh
sudo pacman -Syu --needed \
  base-devel \
  webkit2gtk-4.1 \
  gtk3 \
  libayatana-appindicator \
  librsvg \
  patchelf \
  rustup \
  nodejs-lts-jod \
  pnpm

rustup default stable
```

`base-devel` covers the C toolchain Rust links against. `nodejs-lts-jod` is Node
22 in the Arch repos; if you already manage Node with `nvm` or Volta, skip that
and `pnpm`, and use `corepack enable && corepack prepare pnpm@10 --activate`
instead. CachyOS's x86_64-v3/v4 repos need no special handling — `pacman`
resolves the right variant on its own.

Other distros: the equivalents are in
[Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

### Build

```sh
pnpm install
pnpm tauri build
```

Around four minutes for the Rust compile — the release profile is `lto = true`,
`codegen-units = 1`, `opt-level = "s"` — and a few seconds for the frontend.

### Out

| Path                                                            | Size |
| --------------------------------------------------------------- | ---- |
| `target/release/bundle/deb/Marmotter_0.1.0_amd64.deb`           | 2.9M |
| `target/release/bundle/rpm/Marmotter-0.1.0-1.x86_64.rpm`        | 2.9M |
| `target/release/bundle/appimage/Marmotter_0.1.0_amd64.AppImage` | 75M  |
| `target/release/marmotter-desktop`                              | 5.8M |

The last one runs on its own, no install needed.

### Pick fewer formats

```sh
pnpm tauri build --bundles deb           # deb only
pnpm tauri build --bundles deb,rpm       # skip the AppImage
```

### Install and run

Debian / Ubuntu:

```sh
sudo apt install ./target/release/bundle/deb/Marmotter_0.1.0_amd64.deb
marmotter-desktop
```

CachyOS / Arch — the `.rpm` won't install here, so use the standalone binary
or the AppImage:

```sh
./target/release/marmotter-desktop
# or
chmod +x ./target/release/bundle/appimage/Marmotter_0.1.0_amd64.AppImage
./target/release/bundle/appimage/Marmotter_0.1.0_amd64.AppImage
```

The command is `marmotter-desktop`, not `marmotter` — the package is named
`marmotter` but the binary keeps the crate name. It also appears in the
applications menu as Marmotter.

### Two things that catch people out

- **The AppImage bundler downloads `linuxdeploy`** and its GTK plugin on first
  use, so that format needs network access at bundle time. `deb` and `rpm` do
  not.
- **The `.deb` depends on `libwebkit2gtk-4.1-0` and `libgtk-3-0`**, so it
  installs on Debian 12 and Ubuntu 22.04 or newer — not on anything still
  shipping the WebKitGTK 4.0 series.

Verified on Ubuntu 24.04 by hand, Ubuntu 22.04 in CI, and CachyOS by hand.

---

## Windows

### Prerequisites

| Needed                                                    | Why                                          |
| --------------------------------------------------------- | -------------------------------------------- |
| [Rust](https://rustup.rs/), MSVC toolchain                | The transport is Rust; the shell is Tauri    |
| Visual Studio Build Tools, "Desktop development with C++" | What Rust links against on Windows           |
| WebView2 runtime                                          | Already on Windows 11 and current Windows 10 |

### Build

```powershell
pnpm install
pnpm tauri build
```

### Out

```
target\release\bundle\msi\      MSI installer
target\release\bundle\nsis\     NSIS installer
target\release\marmotter-desktop.exe
```

Both installers, because NSIS installs per-user without an admin prompt and MSI
is what a managed desktop expects. `--bundles msi` or `--bundles nsis` for one.

These are the paths and flags the release workflow uses; the Linux figures above
were measured from a real build, the Windows ones were not.

---

## Let CI build both

```sh
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` builds Linux (deb, AppImage) and Windows (MSI,
NSIS) and attaches the installers to a **draft** release — so nothing is public
until you publish it.

---

## While working

```sh
pnpm tauri dev     # desktop shell, frontend hot-reloads, no bundle step
pnpm dev:web       # browser build on http://localhost:5173
```

## Before pushing

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

All four are what CI runs. Rust and Go have their own:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cd relay && go vet ./...
```

---

## When it goes wrong

| Symptom                                                                  | Cause                                                                                                        |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `failed to run custom build command for tauri`, missing `webkit2gtk-4.1` | System libraries not installed. See the apt list above.                                                      |
| AppImage step hangs or fails to download                                 | No network at bundle time. Build `--bundles deb,rpm` instead.                                                |
| `pnpm: command not found` after `corepack enable`                        | Open a new shell, or `corepack prepare pnpm@10 --activate` again.                                            |
| `cargo: command not found` in a fresh shell                              | `. "$HOME/.cargo/env"`, or reopen the shell after installing rustup.                                         |
| Bundle installs but will not start on an older distro                    | WebKitGTK 4.0 vs 4.1. Build on a distro as old as the oldest you ship to.                                    |
| Frontend changes not showing in `tauri dev`                              | Vite reads package **sources**, so this should not happen — if it does, the dev server is stale. Restart it. |
