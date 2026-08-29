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
