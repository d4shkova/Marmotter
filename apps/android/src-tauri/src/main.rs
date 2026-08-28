// The desktop build's `main` is what the OS launches. On Android the entry
// point is `lib.rs`, called through JNI once the activity is up, and this
// exists so the crate still builds as a binary on a development machine.
fn main() {
    marmotter_android_lib::run()
}
