//! Opening a link in the platform's default browser.
//!
//! The app's own webview cannot navigate to an arbitrary page, so a link in a
//! message is handed to the platform instead. Kept deliberately narrow: only
//! web and IRC schemes are opened, and the URL never passes through a shell, so
//! it cannot be turned into a way to run a command or open a local file.
//!
//! The handing-over itself goes through the `opener` crate rather than a
//! subprocess we spawn. That is a correctness fix, not tidying: `explorer <url>`
//! — the obvious way to open a link on Windows, and what this module used to do
//! — hands the string to the file manager, which decides for itself whether it
//! is looking at an address or a path. On a URL carrying a query string it
//! regularly decides "path" and opens a File Explorer window instead of the
//! browser, which is what a YouTube watch link is: `?v=…&t=…`. `ShellExecuteW`,
//! which is what the crate calls, is the API Windows documents for this and
//! does not guess. Linux gains a fallback chain past `xdg-open` from the same
//! change.

/// Opens a URL in the platform's default browser.
///
/// Returns a plain-English reason on failure, which the front end can surface.
/// Refuses anything that is not a web, IRC, or mail link — the interface only
/// ever asks this to open a link it detected in a message.
#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !is_openable(&url) {
        return Err("That link cannot be opened.".to_owned());
    }
    opener::open(&url).map_err(|error| format!("Could not open the link: {error}"))
}

/// Whether a URL is one of the schemes we are willing to hand to the browser.
///
/// The allowlist is the security boundary and stays in front of the crate: the
/// crate will open anything, including a local path, and this is the thing that
/// decides it never gets one.
fn is_openable(url: &str) -> bool {
    // A leading '-' could be read as a flag by the opener rather than a URL.
    if url.starts_with('-') {
        return false;
    }
    // A control character or a newline could split the argument for whatever
    // ends up receiving it. A URL never legitimately contains one.
    if url.chars().any(char::is_control) {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    ["http://", "https://", "irc://", "ircs://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}

#[cfg(test)]
mod tests {
    use super::is_openable;

    #[test]
    fn accepts_web_and_irc_and_mail_links() {
        assert!(is_openable("https://example.com/a?b=1&c=2"));
        assert!(is_openable("http://example.com"));
        assert!(is_openable("ircs://irc.example.net"));
        assert!(is_openable("IRC://irc.example.net"));
        assert!(is_openable("mailto:someone@example.com"));
    }

    /// The shape that sent people to the file manager: a query string with an
    /// ampersand in it. Nothing about it should read as a path.
    #[test]
    fn accepts_a_youtube_watch_link() {
        assert!(is_openable(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s"
        ));
        assert!(is_openable("https://youtu.be/dQw4w9WgXcQ?si=aBcDeFgH"));
    }

    #[test]
    fn refuses_other_schemes_and_flag_like_input() {
        assert!(!is_openable("file:///etc/passwd"));
        assert!(!is_openable("javascript:alert(1)"));
        assert!(!is_openable("-flag"));
        assert!(!is_openable("example.com"));
        assert!(!is_openable("C:\\Windows\\System32"));
        assert!(!is_openable("\\\\server\\share"));
    }

    #[test]
    fn refuses_a_link_carrying_a_control_character() {
        assert!(!is_openable(
            "https://example.com/\nhttps://elsewhere.example"
        ));
        assert!(!is_openable("https://example.com/\u{0}"));
    }
}
