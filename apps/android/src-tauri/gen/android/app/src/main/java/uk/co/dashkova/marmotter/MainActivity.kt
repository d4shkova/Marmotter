package uk.co.dashkova.marmotter

import android.os.Bundle
import androidx.core.view.WindowCompat

/**
 * The activity Tauri runs the webview in.
 *
 * `TauriActivity` is not imported because it is not a library class: `wry`
 * writes `WryActivity` and Tauri writes `TauriActivity` into this very package
 * during the Android cargo build, from templates inside their crates. They sit
 * beside this file, generated and gitignored, which is why there is nothing to
 * import and nothing to look up in a dependency.
 *
 * What this adds to them is edge-to-edge, the Android half of the safe-area
 * handling. Without it the page is letterboxed between the system bars,
 * `env(safe-area-inset-*)` is zero everywhere, and the padding `packages/ui`
 * applies has nothing to apply. With it the page runs under the status bar and
 * the gesture handle, and the interface holds itself clear of them.
 */
class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        super.onCreate(savedInstanceState)
    }
}
