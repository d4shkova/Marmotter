package uk.co.dashkova.marmotter

import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import java.io.File

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
class RustPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val abis = mapOf(
            "arm64-v8a" to "aarch64-linux-android",
            "armeabi-v7a" to "armv7-linux-androideabi",
            "x86_64" to "x86_64-linux-android",
        )

        val tasks = abis.map { (abi, triple) ->
            project.tasks.register(
                "cargoBuild${abi.replaceFirstChar { it.uppercase() }.replace("-", "")}",
                CargoBuildTask::class.java,
            ) {
                this.abi = abi
                this.triple = triple
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
        val linker = File(bin, "$triple$apiLevel-clang")
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
            commandLine("cargo", "build", "--lib", "--release", "--target", triple)
            environment("CARGO_TARGET_${key}_LINKER", linker.absolutePath)
            environment("CC_$triple", linker.absolutePath)
            environment("AR_$triple", File(bin, "llvm-ar").absolutePath)
            // `ring`, reached through rustls, compiles C and needs the NDK's
            // sysroot rather than the host's headers.
            environment("PATH", "${bin.absolutePath}${File.pathSeparator}${System.getenv("PATH")}")
        }

        val built = File(workspace, "target/$triple/release/libmarmotter_android_lib.so")
        if (!built.exists()) {
            throw GradleException("cargo produced no library at ${built.absolutePath}.")
        }

        val into = File(project.projectDir, "src/main/jniLibs/$abi")
        into.mkdirs()
        built.copyTo(File(into, "libmarmotter_android_lib.so"), overwrite = true)
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
