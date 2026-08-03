//! Line framing.
//!
//! IRC messages are terminated by CRLF. Real servers occasionally send a bare
//! LF, so both are accepted, and empty lines between them are dropped rather
//! than surfaced as empty messages.
//!
//! The buffer is capped. A server that never sends a newline would otherwise
//! grow it without limit, which is a trivial way to exhaust memory on a client
//! that trusts its peer.

use crate::error::{Result, TransportError};

/// Maximum bytes buffered while waiting for a newline.
///
/// The protocol allows 512 bytes of message plus 8191 of tags; this leaves
/// generous headroom while still bounding a hostile or broken server.
pub const MAX_LINE_BYTES: usize = 16_384;

/// Accumulates bytes and yields complete lines.
#[derive(Debug, Default)]
pub struct LineDecoder {
    buffer: Vec<u8>,
}

impl LineDecoder {
    #[must_use]
    /// An empty decoder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Bytes currently held while waiting for a terminator.
    #[must_use]
    pub fn pending(&self) -> usize {
        self.buffer.len()
    }

    /// Feeds received bytes and returns every complete line they finish.
    ///
    /// Lines are decoded as UTF-8, replacing anything invalid. Marmotter speaks
    /// UTF-8; a network using a legacy encoding needs a decoding layer above
    /// this, which is where the profile's `encoding` setting will apply.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>> {
        let mut lines = Vec::new();
        let mut start = 0;

        for (index, byte) in chunk.iter().enumerate() {
            if *byte != b'\n' {
                continue;
            }

            self.buffer.extend_from_slice(&chunk[start..index]);
            start = index + 1;

            // Trailing CR belongs to the terminator, not the message.
            if self.buffer.last() == Some(&b'\r') {
                self.buffer.pop();
            }

            if !self.buffer.is_empty() {
                lines.push(String::from_utf8_lossy(&self.buffer).into_owned());
            }
            self.buffer.clear();
        }

        self.buffer.extend_from_slice(&chunk[start..]);

        if self.buffer.len() > MAX_LINE_BYTES {
            self.buffer.clear();
            return Err(TransportError::LineTooLong);
        }

        Ok(lines)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yields_a_complete_line() {
        let mut decoder = LineDecoder::new();
        assert_eq!(
            decoder.push(b"PING :hello\r\n").unwrap(),
            vec!["PING :hello"]
        );
    }

    #[test]
    fn accepts_a_bare_newline() {
        let mut decoder = LineDecoder::new();
        assert_eq!(decoder.push(b"PING :hello\n").unwrap(), vec!["PING :hello"]);
    }

    #[test]
    fn yields_several_lines_from_one_chunk() {
        let mut decoder = LineDecoder::new();
        assert_eq!(decoder.push(b"ONE\r\nTWO\r\n").unwrap(), vec!["ONE", "TWO"]);
    }

    #[test]
    fn joins_a_line_split_across_chunks() {
        let mut decoder = LineDecoder::new();
        assert!(decoder.push(b"PING :hel").unwrap().is_empty());
        assert_eq!(decoder.pending(), 9);
        assert_eq!(decoder.push(b"lo\r\n").unwrap(), vec!["PING :hello"]);
        assert_eq!(decoder.pending(), 0);
    }

    #[test]
    fn joins_a_line_split_between_cr_and_lf() {
        let mut decoder = LineDecoder::new();
        assert!(decoder.push(b"PING\r").unwrap().is_empty());
        assert_eq!(decoder.push(b"\n").unwrap(), vec!["PING"]);
    }

    #[test]
    fn drops_empty_lines() {
        let mut decoder = LineDecoder::new();
        assert_eq!(decoder.push(b"\r\n\r\nONE\r\n\r\n").unwrap(), vec!["ONE"]);
    }

    #[test]
    fn keeps_a_partial_line_for_the_next_chunk() {
        let mut decoder = LineDecoder::new();
        assert_eq!(decoder.push(b"ONE\r\nTW").unwrap(), vec!["ONE"]);
        assert_eq!(decoder.push(b"O\r\n").unwrap(), vec!["TWO"]);
    }

    #[test]
    fn replaces_invalid_utf8_rather_than_failing() {
        let mut decoder = LineDecoder::new();
        let lines = decoder.push(b"PRIVMSG #c :\xff\xfe\r\n").unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].contains('\u{fffd}'));
    }

    #[test]
    fn passes_multibyte_utf8_through_intact() {
        let mut decoder = LineDecoder::new();
        let lines = decoder
            .push("PRIVMSG #c :🦫 marmot\r\n".as_bytes())
            .unwrap();
        assert_eq!(lines, vec!["PRIVMSG #c :🦫 marmot"]);
    }

    #[test]
    fn joins_a_multibyte_character_split_across_chunks() {
        let mut decoder = LineDecoder::new();
        let encoded = "🦫".as_bytes();
        assert!(decoder.push(&encoded[..2]).unwrap().is_empty());
        let mut rest = encoded[2..].to_vec();
        rest.extend_from_slice(b"\r\n");
        assert_eq!(decoder.push(&rest).unwrap(), vec!["🦫"]);
    }

    #[test]
    fn refuses_a_line_that_never_ends() {
        let mut decoder = LineDecoder::new();
        let flood = vec![b'a'; MAX_LINE_BYTES + 1];
        assert_eq!(
            decoder.push(&flood).unwrap_err(),
            TransportError::LineTooLong
        );
        // The buffer is dropped, so the error is not repeated forever.
        assert_eq!(decoder.pending(), 0);
    }

    #[test]
    fn accepts_a_line_exactly_at_the_limit() {
        let mut decoder = LineDecoder::new();
        let mut line = vec![b'a'; MAX_LINE_BYTES];
        assert!(decoder.push(&line).unwrap().is_empty());
        line.clear();
        assert_eq!(decoder.push(b"\r\n").unwrap().len(), 1);
    }

    #[test]
    fn handles_an_empty_chunk() {
        let mut decoder = LineDecoder::new();
        assert!(decoder.push(b"").unwrap().is_empty());
    }
}
