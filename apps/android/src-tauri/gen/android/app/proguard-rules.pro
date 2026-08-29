# Tauri reaches these from native code by name, so nothing here may be renamed
# or dropped: the plugin classes are found by the string in `PLUGIN_IDENTIFIER`
# and the command methods by the name the Rust side passes.
-keep class app.tauri.** { *; }
-keep class uk.co.dashkova.marmotter.** { *; }
-keepclassmembers class uk.co.dashkova.marmotter.** {
    @app.tauri.annotation.Command <methods>;
}

# The argument classes are built by reflection from the JSON payload.
-keepclassmembers class uk.co.dashkova.marmotter.*Args {
    <fields>;
    <init>();
}

# Compile-time annotations that are genuinely absent at runtime.
#
# Tink comes in with androidx.security-crypto, and is built against Error Prone
# and JSR-305 annotations that are not packaged with it because nothing reads
# them after compilation. R8 sees the references, cannot resolve them, and
# stops. These say that is expected rather than a missing dependency.
#
# Narrow on purpose: only the annotation packages, so a genuinely missing class
# anywhere else still fails the build.
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn javax.annotation.concurrent.**
