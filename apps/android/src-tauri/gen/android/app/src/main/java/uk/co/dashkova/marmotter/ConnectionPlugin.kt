package uk.co.dashkova.marmotter

import android.app.Activity
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
internal class HoldArgs {
    var connected: Int = 0
}

/**
 * Starts and stops [ConnectionService] as connections come and go.
 *
 * The Kotlin half of `src/connection.rs`. It holds no policy of its own: the
 * front end counts the networks that are actually registered and says so, and
 * this turns a non-zero count into a running service and a zero into a stopped
 * one.
 */
@TauriPlugin
class ConnectionPlugin(private val activity: Activity) : Plugin(activity) {
    private companion object {
        const val TAG = "MarmotterConnection"
    }

    @Command
    fun hold(invoke: Invoke) {
        val args = invoke.parseArgs(HoldArgs::class.java)
        try {
            if (args.connected > 0) {
                ConnectionService.start(activity, args.connected)
            } else {
                ConnectionService.stop(activity)
            }
        } catch (error: Exception) {
            // A device that refuses to start the service — a battery saver, a
            // background restriction the user set — drops the connection sooner
            // when the app leaves the screen. That is worse, and it is not
            // something the caller can fix mid-session, so it is logged rather
            // than raised into the conversation the user is having.
            Log.w(TAG, "Could not update the connection service.", error)
        }
        invoke.resolve()
    }
}
