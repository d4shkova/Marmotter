//! Opening a link in the platform's default browser.
//!
//! The app's own webview cannot navigate to an arbitrary page, so a link in a
//! message is handed to the platform instead. Kept deliberately narrow: only
//! web and IRC schemes are opened, and the URL is passed as a single argument
//! rather than through a shell, so it cannot be turned into a way to run a
//! command or open a local file.

use std::process::Command;

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
    open(&url).map_err(|error| format!("Could not open the link: {error}"))
}

/// Whether a URL is one of the schemes we are willing to hand to the browser.
fn is_openable(url: &str) -> bool {
    // A leading '-' could be read as a flag by the opener rather than a URL.
    if url.starts_with('-') {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    ["http://", "https://", "irc://", "ircs://", "mailto:"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
}

/// Hands the URL to the platform's default handler.
fn open(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(url).status()?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `explorer <url>` opens the default browser. The URL is a single
        // argument, never a shell line, so its query string cannot be read as
        // further commands. Its exit status is not a reliable success signal, so
        // it is ignored.
        let _ = Command::new("explorer").arg(url).status();
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open").arg(url).status()?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
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

    #[test]
    fn refuses_other_schemes_and_flag_like_input() {
        assert!(!is_openable("file:///etc/passwd"));
        assert!(!is_openable("javascript:alert(1)"));
        assert!(!is_openable("-flag"));
        assert!(!is_openable("example.com"));
    }
}
