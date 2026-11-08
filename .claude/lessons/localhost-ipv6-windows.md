---
slug: localhost-ipv6-windows
layer: skill:environment-divergence
status: local
---

# On Windows, localhost tries ::1 first: bind both loopbacks or use 127.0.0.1

**Rule:** _(sharpen this as occurrences accumulate — do not add a second bullet
for the same failure; rewrite this line so it covers both.)_

## Occurrences

### 2026-11-08 — sual-cavab

**Rule:** On Windows `localhost` is tried as `::1` before `127.0.0.1`. A server that listens on IPv4 only makes every new connection wait (about 2 s per request for urllib, 10 s for psycopg's connect). Bind both loopbacks, or have tests and local clients use `127.0.0.1`. When something is slow only on Windows, time one connection to `localhost` and one to `127.0.0.1` before anything else.

**Occurrences**
- sual-cavab #15 (2026-11-08, Windows, Docker Desktop): the compose database was published on `127.0.0.1` only, and the backend used `POSTGRES_HOST=localhost`. Measured: `localhost` 10.03 s per connection, `127.0.0.1` 0.06 s. A 28-test run took 706 s and ended with 5 errors; I then started a second run on the same test database while the first was alive, which muddied the diagnosis. Fix: publish `[::1]` too (0.03 s). CI on Linux never showed it.
- sual-cavab #10 (2026-11-08): four `LiveServerTestCase` tests used the default host `localhost` and took about 20 s each. With `host = "127.0.0.1"` the `core` tests went from 130 s to 12 s.

**Cost:** about 30 minutes on #15 (a 706 s run with 5 errors and a muddled second run) and about 10 minutes on #10 (live-server tests at 20 s each)

