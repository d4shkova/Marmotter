// `icons/icon.ico` sits beside this file and nothing on Android reads it.
//
// tauri-build generates a Windows resource for every Tauri crate when the host
// is Windows, and it looks for an `.ico` whether or not the crate will ever run
// there. So `cargo check --workspace` on a Windows machine builds this crate
// for the host and fails without one — which is how a developer on Windows
// first meets the Android app, and a confusing way to meet it.
//
// It is deliberately not listed in `tauri.conf.json`'s `bundle.icon`. That list
// is what the Android bundler reads, and it has no use for a Windows icon. The
// launcher icons Android actually uses are `res/mipmap-*` in gen/android, from
// `icons/android`.
fn main() {
    tauri_build::build()
}
