// Command relay is Marmotter's stateless WSS-to-TCP pipe for the web build.
//
// It accepts a WebSocket connection, opens a TCP/TLS connection to the host and
// port the client requests, and pipes bytes between them. Its constraints are
// product requirements, not implementation details:
//
//   - It stores nothing. No disk writes, no database, no message buffer beyond
//     the in-flight socket buffer.
//   - It logs no message content, no nicks, and no channel names. Connection
//     level counters and errors only.
//   - It holds no state across connections. When the WebSocket closes, the TCP
//     connection closes and everything is discarded.
//   - It enforces an allowlist-or-any policy configurable at deploy time, plus
//     per-IP connection limits, so it cannot be used as an open proxy.
//
// Phase 2 of BUILD_PLAN.md implements it.
package main

import "fmt"

func main() {
	fmt.Println("marmotter-relay: not implemented until BUILD_PLAN phase 2")
}
