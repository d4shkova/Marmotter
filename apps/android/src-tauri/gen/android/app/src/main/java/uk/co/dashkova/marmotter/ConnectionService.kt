package uk.co.dashkova.marmotter

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * Holds the app alive while it has a connection and is not in front.
 *
 * Android freezes a backgrounded process and then reclaims it, and a frozen
 * process is one whose sockets stop being read. A foreground service is the
 * platform's sanctioned way to say "this app is doing something for the user
 * right now" — and the persistent notification it requires is a feature, not a
 * tax: it is how somebody sees that Marmotter is holding connections open and
 * how they stop it.
 *
 * `dataSync` is the service type, which is what Android 14 and later demand a
 * declared reason for. Reading and writing a socket on the user's behalf is
 * exactly that.
 *
 * **This does not make delivery reliable, and nothing here pretends it does.**
 * Android may still stop the service under memory pressure or a battery saver,
 * and a doze window suspends the network long before the process goes. Reliable
 * presence means a bouncer — the user's own ZNC or soju, added as an ordinary
 * network profile.
 */
class ConnectionService : Service() {
    companion object {
        private const val CHANNEL_ID = "marmotter-connection"
        private const val NOTIFICATION_ID = 1

        /** How many networks are connected, for the notification's text. */
        const val EXTRA_CONNECTED = "connected"

        fun start(context: Context, connected: Int) {
            val intent = Intent(context, ConnectionService::class.java)
                .putExtra(EXTRA_CONNECTED, connected)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, ConnectionService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val connected = intent?.getIntExtra(EXTRA_CONNECTED, 0) ?: 0
        if (connected <= 0) {
            stopSelf()
            return START_NOT_STICKY
        }

        createChannel()
        startForeground(NOTIFICATION_ID, notification(connected))

        // Deliberately not START_STICKY. If Android stops this to reclaim
        // memory, the connections went with the process, and restarting the
        // service without them would put a notification in the shade claiming
        // a connection that does not exist.
        return START_NOT_STICKY
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            // What the user sees in the app's notification settings, where they
            // may well want to turn this one off and keep mentions on.
            "Staying connected",
            // Low: it is a status, not an event. It must never make a sound or
            // appear as a heads-up notification — it is there all the time.
            NotificationManager.IMPORTANCE_LOW,
        )
        channel.description = "Shown while Marmotter is holding a connection open in the background."
        channel.setShowBadge(false)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun notification(connected: Int): Notification {
        val open = packageManager.getLaunchIntentForPackage(packageName)
        val tap = if (open == null) {
            null
        } else {
            PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle(
                if (connected == 1) "Connected to 1 network" else "Connected to $connected networks",
            )
            // Says what it is for rather than restating the title. Somebody
            // reading this in their shade at midnight wants to know why their
            // phone is awake.
            .setContentText("Marmotter is staying connected in the background.")
            // The app's own glyph. This used to be the platform's Bluetooth
            // data icon, which is a thing a person reads in their shade as
            // their phone having connected to something on its own.
            .setSmallIcon(R.drawable.ic_stat_connected)
            .setOngoing(true)
            .setShowWhen(false)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }
        if (tap != null) {
            builder.setContentIntent(tap)
        }

        return builder.build()
    }
}
