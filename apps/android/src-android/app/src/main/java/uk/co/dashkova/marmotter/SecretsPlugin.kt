package uk.co.dashkova.marmotter

import android.app.Activity
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
internal class KeyArgs {
    lateinit var key: String
}

@InvokeArg
internal class SetArgs {
    lateinit var key: String
    lateinit var value: String
}

/**
 * Passwords, held under a key the app never sees.
 *
 * The Kotlin half of `src/secrets.rs`. `EncryptedSharedPreferences` encrypts
 * both the names and the values with keys derived from a master key in the
 * Android Keystore — held by the platform, backed by hardware where the device
 * has a secure element, and never readable by this process. What lands on disk
 * is ciphertext, and CLAUDE.md's rule that a password never goes in a settings
 * file holds here the same way it holds on a desktop keychain.
 *
 * Deliberately not a general-purpose store: it holds what the front end asks it
 * to hold, under keys the front end chose, and it does not know what a network
 * or a password is.
 *
 * **Every operation may legitimately fail and none of them are fatal.** A
 * device with no secure lock screen has no key to derive. A keystore can also
 * be invalidated wholesale when the user changes their lock screen, which
 * Android documents and which makes yesterday's ciphertext unreadable today. In
 * both cases the answer is the same as on a Linux box with no Secret Service:
 * say so, and let the client ask for the password again. What must never happen
 * is a failure that reads as a forgotten password.
 */
@TauriPlugin
class SecretsPlugin(private val activity: Activity) : Plugin(activity) {
    private companion object {
        const val TAG = "MarmotterSecrets"

        /**
         * One file for the whole app, so "what has Marmotter stored" is one
         * thing to look at and clearing it is one operation rather than a hunt.
         */
        const val FILE = "marmotter-secrets"
    }

    /**
     * Opened once, lazily, and never reopened after a failure.
     *
     * Building this is what asks the keystore for the master key, so it is also
     * what fails on a device that has none. Null means exactly that, and every
     * command below reads it as "this device cannot keep a password".
     */
    private val store: EncryptedSharedPreferences? by lazy {
        try {
            val masterKey = MasterKey.Builder(activity)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()

            EncryptedSharedPreferences.create(
                activity,
                FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            ) as EncryptedSharedPreferences
        } catch (error: Exception) {
            // Broad on purpose. The failures here are a GeneralSecurityException
            // from the keystore, an IOException from the file, and on some
            // devices an IllegalStateException from a master key that no longer
            // matches the file it encrypted. All three mean the same thing to
            // the caller, and none of them is worth crashing the app over.
            Log.w(TAG, "The keystore would not open; passwords will not be kept.", error)
            null
        }
    }

    /**
     * Whether this device has somewhere to keep a password.
     *
     * Asked once by the client, so it can say up front that a password will not
     * be remembered rather than letting somebody find out on the next launch.
     */
    @Command
    fun available(invoke: Invoke) {
        val result = JSObject()
        result.put("available", store != null)
        invoke.resolve(result)
    }

    @Command
    fun set(invoke: Invoke) {
        val args = invoke.parseArgs(SetArgs::class.java)
        val prefs = store
        if (prefs == null) {
            invoke.reject("This device has nowhere to keep a password.")
            return
        }
        try {
            prefs.edit().putString(args.key, args.value).apply()
            invoke.resolve()
        } catch (error: Exception) {
            Log.w(TAG, "Could not write a secret.", error)
            invoke.reject("The device would not keep that password.")
        }
    }

    @Command
    fun get(invoke: Invoke) {
        val args = invoke.parseArgs(KeyArgs::class.java)
        val result = JSObject()
        try {
            // A null here is the ordinary "nothing filed under that key", which
            // is also what a keystore the app cannot open looks like. Both mean
            // the client asks for the password, so neither is an error.
            result.put("value", store?.getString(args.key, null))
        } catch (error: Exception) {
            Log.w(TAG, "Could not read a secret.", error)
            result.put("value", null)
        }
        invoke.resolve(result)
    }

    @Command
    fun delete(invoke: Invoke) {
        val args = invoke.parseArgs(KeyArgs::class.java)
        try {
            store?.edit()?.remove(args.key)?.apply()
        } catch (error: Exception) {
            // Forgetting something that is already unreachable has the outcome
            // the caller wanted, so this is not reported as a failure.
            Log.w(TAG, "Could not forget a secret.", error)
        }
        invoke.resolve()
    }
}
