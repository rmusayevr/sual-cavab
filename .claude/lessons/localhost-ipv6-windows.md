---
slug: localhost-ipv6-windows
layer: vault
status: local
---

# On Windows, localhost tries ::1 first: bind both loopbacks or use 127.0.0.1

**Rule:** On Windows, a client that tries addresses one after another (Python's `socket` and `urllib` were measured; `libpq` through psycopg too) connects to `localhost` by trying `::1` first. If nothing listens on `::1`, every new connection pays for that failed attempt: about 2 s measured for `urllib`, 10 s measured for psycopg through Docker Desktop (the reason for 10 s rather than 2 s was not established). Linux refuses at once, which is why CI never showed it. Bind both loopbacks (`127.0.0.1` and `::1`), or have tests and local clients use `127.0.0.1`. When something is slow only on Windows, time one connection to `localhost` and one to `127.0.0.1` before anything else. Not checked here: other clients (browsers, curl, Go, Node) are said to try both families at once and lose little.

## Occurrences

### 2026-11-08 — sual-cavab

- **#15** (Windows, Docker Desktop): the compose database was published on `127.0.0.1` only and the backend used `POSTGRES_HOST=localhost`. Measured: `localhost` 10.03 s per connection, `127.0.0.1` 0.06 s. A 28-test run took 706 s and ended with 5 errors (never diagnosed); I then started a second run on the same test database while the first was alive, which muddied the diagnosis. Fix: publish `[::1]` too (0.03 s afterwards). Recorded in the #15 closing notes.
- **#10**: four `LiveServerTestCase` tests used the default host `localhost` and took 21 to 48 s each (`--durations`). With `host = "127.0.0.1"` the `core` tests went from 130 s to 12 s (recorded in PR #28). A reviewer reproduced the mechanism: a server on `127.0.0.1` only, `urllib` to `127.0.0.1` 0.03 s, to `localhost` 2.04 s, and a bare connection to `::1` refused after 2.04 s.

**Cost:** about 30 minutes on #15 (recorded in its closing notes) and roughly 10 minutes on #10 (my estimate; not recorded anywhere).
