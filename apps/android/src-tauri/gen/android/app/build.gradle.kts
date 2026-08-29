plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

apply<uk.co.dashkova.marmotter.RustPlugin>()

android {
    namespace = "uk.co.dashkova.marmotter"
    compileSdk = 35

    defaultConfig {
        applicationId = "uk.co.dashkova.marmotter"
        // Android 13. BUILD_PLAN's acceptance is "installs and runs on Android
        // 13+", and the foreground-service and notification-permission
        // behaviour the app relies on is what that release introduced.
        minSdk = 33
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.5"
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // No signing config. The release job produces an unsigned APK for
            // now; adding a keystore is a follow-up and deliberately not
            // half-wired here, because a build that looks signed and is not is
            // worse than one that plainly is not. See docs/BUILDING.md.
        }
    }

    // One APK per ABI rather than one carrying all of them, so a phone
    // downloads a fraction of the size.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    // Where the Rust plugin puts the libraries it built. The frontend is not
    // here and does not need to be: `tauri::generate_context!` embeds whatever
    // `frontendDist` points at into the Rust library at compile time, so
    // `pnpm build` has to have run before cargo does — which the CI job and
    // docs/BUILDING.md both spell out.
    sourceSets.getByName("main") {
        jniLibs.srcDir("src/main/jniLibs")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        jniLibs {
            // The Rust library is already stripped by the release profile and
            // must stay uncompressed so it can be mapped straight from the APK.
            useLegacyPackaging = false
        }
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // The Android Keystore, for `SecretsPlugin`. This is the whole reason
    // passwords can be kept on a phone at all; see CLAUDE.md on secrets.
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
}

// Tauri's Android runtime — the activity, the plugin base class, and the bridge
// the Rust side calls through — plus every plugin that ships Android code.
//
// Not a Maven coordinate: there is no `app.tauri:tauri-android` to depend on.
// The runtime is Kotlin inside the `tauri` crate and each plugin's Android half
// is inside that plugin's crate, so these are project dependencies on paths
// that differ per machine. `tauri-build` writes this file while cargo builds
// for an Android target, and settings.gradle.kts makes sure that has happened.
apply(from = "tauri.build.gradle.kts")
