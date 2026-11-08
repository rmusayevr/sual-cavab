---
slug: time-one-unit-before-waiting
layer: vault
status: local
---

# Time the smallest repeated unit before waiting on a slow run again

**Rule:** When a run is slow, before you wait for it again, time the smallest unit it repeats (one password hash, one connection, one request) and multiply by how often it happens. Do this before the second full run, not after the fifth.

## Occurrences

### 2026-11-08 — sual-cavab

- **#6 to #9**: the backend suite took 8 to 11 minutes (510 s at 146 tests, 683 s at 233, recorded in #25) and I waited on full runs on each of these issues until the owner asked "why does it take too long?"; how many runs per issue was not recorded. One hash measured 0.54 s (PBKDF2, 1.5 million iterations). A fast hasher under `manage.py test` took the suite from 683 s to 14 s (#25), so hashing was nearly all of the run time. The `profile-before-optimizing` rule existed; I did not apply it.
- **#15**: after a 706-second run with 5 errors, timing a single connection showed 10 s per connection (see `localhost-ipv6-windows`).

**Cost:** waiting on those full runs on every issue from #6 to #9 (the time was not measured), and about 30 minutes on #15.
