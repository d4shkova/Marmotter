# Building Marmotter — cheat sheet

One codebase, two desktop builds and an APK. There is no cross-compiling
between the desktops: **build Linux on Linux and Windows on Windows.** Android
does cross-compile, from either. For all of them without installing anything,
push a tag and let CI do it.

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

## Common to all of them

| Tool | Version | Get it                                                   |
| ---- | ------- | -------------------------------------------------------- |
| Node | 22+     | nodejs.org, nvm, or your package manager                 |
| pnpm | 10+     | `corepack enable && corepack prepare pnpm@10 --activate` |
| Rust | stable  | [rustup.rs](https://rustup.rs/)                          |

```sh
pnpm install          # once, and after any dependency change
pnpm tauri build      # the desktop app: frontend, Rust, bundles
```

The workspace packages do **not** need building first — Vite resolves them to
source. `pnpm install && pnpm tauri build` works from a clean checkout. Android
is the exception and is spelled out below: its Gradle build does not run Vite,
so the frontend has to be built first.

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

## Android

### Prerequisites

The Android SDK, an NDK, and a JDK. Android Studio installs all three; on a
headless machine, the command-line tools plus:

```sh
export ANDROID_HOME="$HOME/Android/Sdk"     # wherever yours actually lives
sdkmanager --install "ndk;27.2.12479018" "platforms;android-35" "build-tools;35.0.0"
```

Setting `ANDROID_NDK_HOME` is optional: with `ANDROID_HOME` set, the Gradle
plugin uses the highest NDK installed under it. Set it when you have several
and want a particular one — which is what CI does, so a release is always built
against a known NDK rather than whichever the runner happened to have.

Then the Rust targets:

```sh
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
```

### Build

```sh
pnpm -r --filter=./packages/* build
pnpm --filter @marmotter/android build      # the frontend, into apps/android/dist
cd apps/android/src-tauri/gen/android
gradle wrapper                              # once; the wrapper jar is not committed
./gradlew assembleDebug
```

**`pnpm --filter @marmotter/android build` has to run before Gradle does.**
`tauri::generate_context!` embeds whatever `frontendDist` points at into the
Rust library at compile time, so a missing `dist/` is not an error — it is a
build that succeeds and ships a blank window.

### Out

`apps/android/src-tauri/gen/android/app/build/outputs/apk/debug/`, one APK per
ABI plus a universal one. Install with:

```sh
adb install -r app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

### Debug, not release, until there is a keystore

**`assembleRelease` produces APKs nothing can install.** Android has no "allow
unsigned" setting: an APK with no signature is refused by the package installer
and by `adb install` alike, and the refusal is silent in a file manager. A debug
build is signed, with a keystore Gradle generates for you, which is why it is
the one to put on a phone.

Release is still worth building — it is what runs R8 and the resource shrinker —
it just cannot leave your machine. Wiring a real keystore is a follow-up; it is
deliberately not half-done, because a build that looks signed and is not is
worse than one that plainly is not.

### What the app does and does not do in the background

Marmotter runs a foreground service while any network is connected, which is
the only way Android will let a backgrounded app keep a socket open. The
ongoing notification it puts in the shade is not decoration — it is how you see
that the app is holding connections open, and how you stop it.

It still is not reliable presence, and the app does not pretend otherwise.
Android may stop the service under memory pressure or a battery saver, and a
doze window suspends the network long before the process goes. **If you want to
be sure you are still in the channel an hour later, point Marmotter at a
bouncer** — your own [ZNC](https://znc.in) or [soju](https://soju.im) — and add
it as an ordinary network profile:

- Host and port: your bouncer's, with TLS on.
- Password: for ZNC, `username/network:password`; for soju,
  `username/network` with your password. Either goes in the profile's
  server-password field, or SASL PLAIN where your bouncer supports it.

The bouncer stays connected, holds the backlog, and replays it when the phone
comes back. That is what it is for, and it is a better answer than any amount
of fighting the platform's power management — which is why there is no push
infrastructure here and never will be. See CLAUDE.md.

### Two things that catch people out

- **A blank window** almost always means `dist/` was stale or missing when
  cargo ran. Rebuild the frontend, then Gradle.
- **"This app isn't 16 KB compatible"** means the native library was linked
  with the old 4 KB page alignment. The build asks for 16 KB explicitly; if you
  see this, check whether `RUSTFLAGS` is set in your shell in a way that
  displaced it, and confirm with:

  ```sh
  llvm-readelf -l lib/arm64-v8a/libmarmotter_android_lib.so | grep LOAD
  ```

  The `Align` column should read `0x4000`, not `0x1000`.

- **A black screen and no error** usually means the page loaded and rendered
  nothing, because `--bg-base` is black. Open `chrome://inspect/#devices` in
  Chrome on the desktop with the app running: a debug build has webview
  DevTools, so the console is right there. The Rust profile follows the Gradle
  variant, so `assembleDebug` is what makes that possible —
  `-Pmarmotter.cargoProfile=debug` forces it if you are building some other
  task.
- **`No NDK is installed under …`** means exactly that; the message names the
  `sdkmanager` line to fix it. The plugin will find an installed NDK on its own
  but will not invent a path to one, because a wrong path produces a library
  that fails to load on the phone rather than a build error.
- **`icons/icon.ico not found`** from `cargo check --workspace` on Windows is
  not an Android problem. tauri-build generates a Windows resource for every
  Tauri crate when the host is Windows, including this one, so the `.ico` is
  kept beside the app for that reason alone. If it goes missing, copy
  `apps/desktop/src-tauri/icons/icon.ico` back into
  `apps/android/src-tauri/icons/`.

---

## Let CI build both

```sh
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` builds Linux (deb, AppImage) and Windows (MSI,
NSIS) and attaches the installers to a **draft** release — so nothing is public
until you publish it. It also builds the Android APKs and uploads them as a
workflow artifact rather than attaching them to the release, because they are
unsigned.

---

## While working

```sh
pnpm tauri dev     # desktop shell, frontend hot-reloads, no bundle step
pnpm dev:web       # browser build on http://localhost:5173
pnpm --filter @marmotter/android dev   # the Android frontend, on :1421
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
