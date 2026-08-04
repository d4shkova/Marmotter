// Prevents an additional console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK 2.44+ ships a DMABUF renderer that draws an empty black window
    // on a lot of Linux setups (Nvidia proprietary, several Wayland stacks).
    // The whole app is invisible without this; leave it opt-out for anyone who
    // has already set the variable themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    marmotter_desktop_lib::run()
}
