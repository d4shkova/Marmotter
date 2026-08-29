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
 * The NDK's linker is found through `ANDROID_NDK_HOME`, which the CI job and
 * `docs/BUILDING.md` both set. Cargo needs to be told about it per target
 * rather than through the ambient toolchain, because the linker name carries
 * the API level in it.
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
        val ndk = System.getenv("ANDROID_NDK_HOME")
            ?: System.getenv("NDK_HOME")
            ?: throw GradleException(
                "ANDROID_NDK_HOME is not set, so there is no linker to build the Rust " +
                    "library with. See docs/BUILDING.md.",
            )

        // `src-tauri` is three levels above `gen/android`.
        val crate = project.rootDir.parentFile.parentFile
        val workspace = crate.parentFile.parentFile.parentFile
        val host = hostTag()
        val bin = File(ndk, "toolchains/llvm/prebuilt/$host/bin")
        val linker = File(bin, "$triple$apiLevel-clang")
        if (!linker.exists()) {
            throw GradleException("No NDK linker at ${linker.absolutePath}.")
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
