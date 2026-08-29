//! Which links the app is willing to hand to the platform.
//!
//! The security boundary in front of every "open this link" path, shared by
//! the desktop and Android shells so neither can be more permissive than the
//! other by accident. Whatever opens the link afterwards — `ShellExecuteW`,
//! `xdg-open`, an Android intent — will open anything it is given, including a
//! local path; this is the thing that decides it never gets one.

/// Whether a URL is one of the schemes we are willing to hand to the platform.
pub fn is_openable(url: &str) -> bool {
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
