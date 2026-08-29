package uk.co.dashkova.marmotter

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import java.io.File

/**
 * One Android ABI, and the two different names the toolchains give it.
 *
 * `triple` is what Rust calls the target. `clangPrefix` is what the NDK calls
 * its wrapper for the same thing, and the two are not always equal: 32-bit ARM
 * is `armv7-linux-androideabi` to Rust and `armv7a-linux-androideabi` to the
 * NDK — one letter apart, and the sort of difference that is invisible until a
 * build fails on exactly one ABI.
 */
private data class Abi(val name: String, val triple: String, val clangPrefix: String)

/** The app's Java package. Matches `applicationId` in `app/build.gradle.kts`. */
const val PACKAGE = "uk.co.dashkova.marmotter"

/** The `cdylib` cargo produces. Matches `[lib] name` in the crate's Cargo.toml. */
const val LIBRARY = "marmotter_android_lib"

private val ABIS = listOf(
    Abi("arm64-v8a", "aarch64-linux-android", "aarch64-linux-android"),
    Abi("armeabi-v7a", "armv7-linux-androideabi", "armv7a-linux-androideabi"),
    Abi("x86_64", "x86_64-linux-android", "x86_64-linux-android"),
)

/**
 * Builds the Rust library for each Android ABI and puts it where Gradle looks.
 *
 * Deliberately ours and deliberately small, rather than an imitation of the
 * plugin `tauri android init` generates. Two reasons. It is a build step
 * somebody can read in one sitting and fix without knowing how the Tauri CLI
 * arranges its own tasks; and a generated plugin that nobody in this repository
 * wrote is exactly the file that silently stops matching the CLI after an
 * upgrade. What it does is the whole of the job: run `cargo build` once per
 * ABI, then copy the `.so` it produced into `jniLibs`.
 *
 * The NDK is `ANDROID_NDK_HOME` where that is set — which is what CI does, so a
 * release is always built against a known one — and otherwise the highest
 * version installed under the SDK. Cargo has to be told about its linker per
 * target rather than through the ambient toolchain, because the linker's name
 * carries the API level in it.
 */
/**
 * Which cargo profile to build, for a Gradle build that is itself debug or
 * release.
 *
 * This matters for more than binary size. `debug_assertions` is what Tauri keys
 * webview DevTools off, so a release library in a debug APK is one you cannot
 * inspect from `chrome://inspect` — the single most useful tool for finding out
 * why a page did not render. The workspace release profile also sets
 * `panic = "abort"`, which turns a panic in the app's startup into a dead
 * process rather than a message.
 *
 * Read from the tasks Gradle was asked to run, because the cargo build has to
 * be decided once for the whole build rather than per variant: these tasks hang
 * off `preBuild`, which both variants share. `-Pmarmotter.cargoProfile=` says
 * so explicitly when that guess is wrong.
 */
private fun cargoProfile(project: Project): String {
    val explicit = project.findProperty("marmotter.cargoProfile")?.toString()
    if (explicit != null) {
        return explicit
    }
    val requested = project.gradle.startParameter.taskNames.joinToString(" ").lowercase()
    val debug = requested.contains("debug")
    val release = requested.contains("release")
    return if (debug && !release) "debug" else "release"
}

class RustPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val profile = cargoProfile(project)
        val tasks = ABIS.map { abi ->
            project.tasks.register(
                "cargoBuild${abi.name.replaceFirstChar { it.uppercase() }.replace("-", "")}",
                CargoBuildTask::class.java,
            ) {
                this.abi = abi.name
                this.triple = abi.triple
                this.clangPrefix = abi.clangPrefix
                this.profile = profile
            }
        }

        // Everything Gradle does with the app depends on the native libraries
        // existing, so this hangs off `preBuild` rather than off `assemble`:
        // the manifest merger and the packaging step both run before assemble.
        project.tasks.named("preBuild").configure { dependsOn(tasks) }
    }
}

/**
 * Orders NDK directory names like `27.2.12479018` by their numeric parts.
 *
 * String order gets this wrong the moment two installed NDKs differ in digit
 * count — `9.x` would sort above `27.x` — and picking the older of two NDKs is
 * the kind of thing that shows up much later as a link error nobody connects
 * back to here.
 */
private val VERSION_ORDER = Comparator<String> { left, right ->
    val a = left.split('.').map { it.toIntOrNull() ?: 0 }
    val b = right.split('.').map { it.toIntOrNull() ?: 0 }
    val ordered = (0 until maxOf(a.size, b.size)).asSequence()
        .map { (a.getOrNull(it) ?: 0).compareTo(b.getOrNull(it) ?: 0) }
        .firstOrNull { it != 0 }
    ordered ?: 0
}

/** One ABI's worth of `cargo build`, plus the copy into `jniLibs`. */
abstract class CargoBuildTask : DefaultTask() {
    @get:Input
    lateinit var abi: String

    @get:Input
    lateinit var triple: String

    /** What the NDK names its clang wrapper for this ABI. See [Abi]. */
    @get:Input
    lateinit var clangPrefix: String

    /** `debug` or `release`. See [cargoProfile]. */
    @get:Input
    lateinit var profile: String

    /**
     * The API level the linker targets.
     *
     * 24 rather than the app's `minSdk` of 33 on purpose: this only picks which
     * `clang` wrapper is used, and a lower one links against a smaller set of
     * libc symbols, which is strictly safer. What the app actually requires is
     * `minSdk`, declared once in `app/build.gradle.kts`.
     */
    private val apiLevel = 24

    @TaskAction
    fun build() {
        val ndk = ndkRoot()

        // `src-tauri` is three levels above `gen/android`.
        val crate = project.rootDir.parentFile.parentFile
        val workspace = crate.parentFile.parentFile.parentFile
        val host = hostTag()
        val bin = File(ndk, "toolchains/llvm/prebuilt/$host/bin")
        val linker = File(bin, "$clangPrefix$apiLevel-clang")
        if (!linker.exists()) {
            throw GradleException(
                "No NDK linker at ${linker.absolutePath}. The NDK at ${ndk.absolutePath} is " +
                    "either incomplete or built for a different host.",
            )
        }

        // Cargo reads the linker for a target from an environment variable whose
        // name is the target triple, uppercased with dashes as underscores.
        val key = triple.uppercase().replace('-', '_')

        project.exec {
            workingDir = crate
            commandLine(
                buildList {
                    addAll(listOf("cargo", "build", "--lib", "--target", triple))
                    if (profile == "release") {
                        add("--release")
                    }
                },
            )
            // Tells tauri-build to keep `tauri.settings.gradle` and
            // `app/tauri.build.gradle.kts` current — the list of Tauri projects
            // this build depends on. settings.gradle.kts creates them on a
            // clean checkout; this is what keeps them right afterwards, when a
            // plugin is added or the Tauri version moves.
            environment("TAURI_ANDROID_PROJECT_PATH", project.rootDir.absolutePath)
            // Where wry and tauri write the activity this app subclasses.
            //
            // `WryActivity` and `TauriActivity` are templates inside those two
            // crates, not classes in a library, so they are generated into the
            // app's own package during this build. MainActivity extends the
            // result. Without these three the generation is skipped silently
            // and Kotlin fails with an unresolved reference.
            environment("WRY_ANDROID_PACKAGE", PACKAGE)
            environment("WRY_ANDROID_LIBRARY", LIBRARY)
            environment("WRY_ANDROID_KOTLIN_FILES_OUT_DIR", kotlinOutDir(project).absolutePath)
            environment("CARGO_TARGET_${key}_LINKER", linker.absolutePath)
            environment("CC_$triple", linker.absolutePath)
            environment("AR_$triple", File(bin, "llvm-ar").absolutePath)
            // `ring`, reached through rustls, compiles C and needs the NDK's
            // sysroot rather than the host's headers.
            environment("PATH", "${bin.absolutePath}${File.pathSeparator}${System.getenv("PATH")}")
        }

        val built = File(workspace, "target/$triple/$profile/lib$LIBRARY.so")
        if (!built.exists()) {
            throw GradleException("cargo produced no library at ${built.absolutePath}.")
        }

        val into = File(project.projectDir, "src/main/jniLibs/$abi")
        into.mkdirs()
        built.copyTo(File(into, "lib$LIBRARY.so"), overwrite = true)
    }

    /**
     * Which NDK to build against.
     *
     * `ANDROID_NDK_HOME` wins where it is set, which is what CI does so that a
     * release is always built against a known one. Where it is not, the highest
     * version installed under the SDK is used rather than nothing: a developer
     * who has just run `sdkmanager --install "ndk;..."` has said which NDK they
     * want by installing it, and making them repeat that as an environment
     * variable is a step that only exists to be forgotten.
     *
     * Still no guessing at a path that is not there. Every way of failing to
     * find one says which of them happened and what to do about it, because the
     * alternative is a library that builds and then fails to load on the phone.
     */
    private fun ndkRoot(): File {
        val named = System.getenv("ANDROID_NDK_HOME") ?: System.getenv("NDK_HOME")
        if (named != null) {
            val root = File(named)
            if (!root.isDirectory) {
                throw GradleException(
                    "ANDROID_NDK_HOME points at $named, which is not a directory.",
                )
            }
            return root
        }

        val sdk = System.getenv("ANDROID_HOME")
            ?: System.getenv("ANDROID_SDK_ROOT")
            ?: throw GradleException(
                "Neither ANDROID_NDK_HOME nor ANDROID_HOME is set, so there is no NDK to " +
                    "build the Rust library with. See docs/BUILDING.md.",
            )

        val installed = File(sdk, "ndk").listFiles().orEmpty().filter { it.isDirectory }
        return installed.maxWithOrNull(compareBy(VERSION_ORDER) { it.name })
            ?: throw GradleException(
                "No NDK is installed under $sdk. Install one with:\n" +
                    "  sdkmanager --install \"ndk;27.2.12479018\"\n" +
                    "or set ANDROID_NDK_HOME to one you already have.",
            )
    }

    /**
     * The app's package directory, which the generated Kotlin is written into.
     *
     * It has to exist before cargo runs: both build scripts canonicalize this
     * path and panic if it is not there.
     */
    private fun kotlinOutDir(project: org.gradle.api.Project): File {
        val dir = File(project.rootDir, "app/src/main/java/${PACKAGE.replace('.', '/')}")
        dir.mkdirs()
        return dir
    }

    /** What the NDK calls the machine doing the building. */
    private fun hostTag(): String {
        val os = System.getProperty("os.name").lowercase()
        return when {
            os.contains("mac") -> "darwin-x86_64"
            os.contains("win") -> "windows-x86_64"
            else -> "linux-x86_64"
        }
    }
}
