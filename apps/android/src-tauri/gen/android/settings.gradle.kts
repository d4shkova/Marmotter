// The Marmotter Android project.
//
// Hand-written and committed rather than left to `tauri android init`, so that
// the manifest, the foreground service and the keystore plugin are reviewable
// here rather than appearing in a generated tree. See docs/BUILDING.md.
rootProject.name = "Marmotter"

include(":app")

/** Where wry and tauri write the activity classes, inside the app's package. */
val kotlinOutDir = File(rootDir, "app/src/main/java/uk/co/dashkova/marmotter")

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

    // Same profile RustPlugin will use, or its per-ABI tasks rebuild from
    // scratch straight after this one. See `cargoProfile` there.
    val requested = gradle.startParameter.taskNames.joinToString(" ").lowercase()
    val debug = requested.contains("debug") && !requested.contains("release")

    // `wry` declares the three WRY_ANDROID_* variables as build-script inputs,
    // so setting them is enough to make it regenerate. `tauri` declares no
    // environment inputs at all, so once it has been built for Android its
    // build script is cached and skipped, and `TauriActivity.kt` is never
    // written however many times the variables change. Cleaning that one
    // package for this one target is what forces it, and only when the file it
    // owes us is actually missing.
    if (!File(kotlinOutDir, "TauriActivity.kt").exists()) {
        ProcessBuilder(
            buildList {
                addAll(listOf("cargo", "clean", "-p", "tauri"))
                if (!debug) {
                    add("--release")
                }
                addAll(listOf("--target", "aarch64-linux-android"))
            },
        ).directory(crate).inheritIO().start().waitFor()
    }

    val builder = ProcessBuilder(
        buildList {
            addAll(listOf("cargo", "build", "--lib", "--target", "aarch64-linux-android"))
            // As in RustPlugin, so this build and the ones after it agree and
            // cargo does not rebuild everything between them.
            addAll(listOf("--features", "custom-protocol"))
            if (!debug) {
                add("--release")
            }
        },
    ).directory(crate).inheritIO()

    builder.environment().apply {
        // What tells tauri-build to write the list, and where to write it.
        put("TAURI_ANDROID_PROJECT_PATH", rootDir.absolutePath)
        // And what makes it actually run.
        //
        // tauri-build declares the two files it writes as build-script inputs,
        // so once cargo knows about them it rewrites them whenever they go
        // missing. This very first build is the one case that cannot work:
        // earlier builds ran without TAURI_ANDROID_PROJECT_PATH, so their
        // fingerprint mentions no such files, nothing looks stale, and the
        // build script is skipped — leaving cargo to exit successfully having
        // written nothing. TAURI_CONFIG is a declared input too, and going from
        // unset to a value that patches nothing invalidates the fingerprint
        // without changing the configuration.
        put("TAURI_CONFIG", "{}")
        // Where wry and tauri write the activity MainActivity extends. Set here
        // as well as in RustPlugin, because this build is a real one and would
        // otherwise skip the generation and leave the first Kotlin compile
        // failing on an unresolved reference.
        // 16 KB page alignment, as in RustPlugin — the same reason, and the
        // same appending so a machine with RUSTFLAGS set does not lose it.
        put(
            "RUSTFLAGS",
            listOfNotNull(System.getenv("RUSTFLAGS"), "-C link-arg=-Wl,-z,max-page-size=16384")
                .filter { it.isNotBlank() }
                .joinToString(" "),
        )
        put("WRY_ANDROID_PACKAGE", "uk.co.dashkova.marmotter")
        put("WRY_ANDROID_LIBRARY", "marmotter_android_lib")
        put(
            "WRY_ANDROID_KOTLIN_FILES_OUT_DIR",
            kotlinOutDir.also { it.mkdirs() }.absolutePath,
        )
        put("CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER", linker.absolutePath)
        put("CC_aarch64-linux-android", linker.absolutePath)
        put("AR_aarch64-linux-android", File(bin, "llvm-ar").absolutePath)
        put("PATH", "${bin.absolutePath}${File.pathSeparator}${System.getenv("PATH")}")
    }

    require(builder.start().waitFor() == 0) {
        "cargo could not build the Android library, so there is no list of Tauri projects " +
            "to include. The cargo output above says why."
    }

    // A cargo that exits successfully having written nothing is the failure
    // worth naming: it means the build script was skipped, and what happens
    // next is Gradle failing on a missing file with nothing to say about why it
    // never appeared.
    require(file("tauri.settings.gradle").exists()) {
        "cargo succeeded but tauri-build wrote no tauri.settings.gradle. Try " +
            "`cargo clean -p marmotter-android` and build again."
    }
    require(File(kotlinOutDir, "TauriActivity.kt").exists()) {
        "cargo succeeded but tauri wrote no TauriActivity.kt, which MainActivity extends. " +
            "Try `cargo clean -p tauri` and build again."
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
if (
    !generated.exists() ||
    !generated.readText().contains("include") ||
    !File(kotlinOutDir, "TauriActivity.kt").exists()
) {
    generateTauriGradleFiles()
}
apply(from = generated)
