// The Marmotter Android project.
//
// Hand-written and committed rather than left to `tauri android init`, so that
// the manifest, the foreground service and the keystore plugin are reviewable
// here rather than appearing in a generated tree. See docs/BUILDING.md.
rootProject.name = "Marmotter"

include(":app")

/**
 * Builds the Rust library once, for one ABI, to produce that list.
 *
 * Only when the list is missing. Cargo caches, so the per-ABI tasks in
 * `buildSrc`'s RustPlugin reuse this work rather than repeating it, and every
 * later build skips this entirely.
 *
 * The NDK lookup below is deliberately a copy of the one in RustPlugin rather
 * than a call into it: `buildSrc` is not on the settings script's classpath, so
 * there is no way to share it. If one changes, change both — they are looking
 * for the same linker for the same reason.
 */
fun generateTauriGradleFiles() {
    val crate = rootDir.parentFile.parentFile
    val ndk = File(
        System.getenv("ANDROID_NDK_HOME")
            ?: System.getenv("NDK_HOME")
            ?: run {
                val sdk = System.getenv("ANDROID_HOME")
                    ?: System.getenv("ANDROID_SDK_ROOT")
                    ?: error("Set ANDROID_HOME or ANDROID_NDK_HOME. See docs/BUILDING.md.")
                File(sdk, "ndk").listFiles().orEmpty().filter { it.isDirectory }
                    .maxByOrNull { dir ->
                        dir.name.split('.').map { it.toIntOrNull() ?: 0 }
                            .fold(0L) { acc, part -> acc * 1_000_000 + part }
                    }
                    ?.absolutePath
                    ?: error("No NDK is installed under $sdk. See docs/BUILDING.md.")
            },
    )

    val host = System.getProperty("os.name").lowercase().let {
        when {
            it.contains("mac") -> "darwin-x86_64"
            it.contains("win") -> "windows-x86_64"
            else -> "linux-x86_64"
        }
    }
    val bin = File(ndk, "toolchains/llvm/prebuilt/$host/bin")
    val linker = File(bin, "aarch64-linux-android24-clang")
    require(linker.exists()) { "No NDK linker at ${linker.absolutePath}." }

    val builder = ProcessBuilder(
        "cargo", "build", "--lib", "--release", "--target", "aarch64-linux-android",
    ).directory(crate).inheritIO()

    builder.environment().apply {
        // What tells tauri-build to write the list, and where to write it.
        put("TAURI_ANDROID_PROJECT_PATH", rootDir.absolutePath)
        put("CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER", linker.absolutePath)
        put("CC_aarch64-linux-android", linker.absolutePath)
        put("AR_aarch64-linux-android", File(bin, "llvm-ar").absolutePath)
        put("PATH", "${bin.absolutePath}${File.pathSeparator}${System.getenv("PATH")}")
    }

    require(builder.start().waitFor() == 0) {
        "cargo could not build the Android library, so there is no list of Tauri projects " +
            "to include. The cargo output above says why."
    }
}

/**
 * The Tauri Android runtime, and every plugin that ships Android code with it.
 *
 * There is no `app.tauri:tauri-android` on Maven. The runtime is Kotlin inside
 * the `tauri` crate, and each plugin's Android half is inside that plugin's
 * crate, so the projects to include live wherever cargo unpacked them — a path
 * that differs per machine and per version and cannot be committed.
 *
 * `tauri-build` writes that list to `tauri.settings.gradle` while cargo builds
 * the library for an Android target. Gradle needs it here, at configuration
 * time, before any task has run — so on a clean checkout there is nothing to
 * include yet and one cargo build has to happen first, right here.
 */
val generated = file("tauri.settings.gradle")
if (!generated.exists() || !generated.readText().contains("include")) {
    generateTauriGradleFiles()
}
apply(from = generated)
