package uk.co.dashkova.marmotter

import android.os.Bundle
import androidx.core.view.WindowCompat

/**
 * The activity Tauri runs the webview in.
 *
 * `WryActivity` does the work; what this adds is edge-to-edge, which is the
 * Android half of the safe-area handling. Without it the page is letterboxed
 * between the system bars, `env(safe-area-inset-*)` is zero everywhere, and the
 * padding `packages/ui` applies has nothing to apply. With it the page runs
 * under the status bar and the gesture handle, and the interface holds itself
 * clear of them.
 */
class MainActivity : app.tauri.WryActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        super.onCreate(savedInstanceState)
    }
}
