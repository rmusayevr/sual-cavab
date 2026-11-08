---
slug: time-one-unit-before-waiting
layer: skill:profile-before-optimizing
status: local
---

# Time the smallest repeated unit before waiting on a slow run again

**Rule:** _(sharpen this as occurrences accumulate — do not add a second bullet
for the same failure; rewrite this line so it covers both.)_

## Occurrences

### 2026-11-08 — sual-cavab

**Rule:** When a run is slow, before you wait for it again, time the smallest unit it repeats (one password hash, one connection, one request) and multiply by how many times it happens. Do this before the second full run, not after the fifth.

**Occurrences**
- sual-cavab #6 to #9 (2026-11-08): the backend suite took 8 to 11 minutes (510 s at 146 tests, 683 s at 233) and I waited for several full runs on every issue until the owner asked "why does it take too long?". Timing one hash (0.54 s: PBKDF2 at 1.5 million iterations, about 1,265 of them in the suite) found the cause within minutes. A fast hasher under `manage.py test` took the suite to 14 s (#25). The `profile-before-optimizing` rule existed; I did not apply it.
- sual-cavab #15 (2026-11-08): after a 706-second run with 5 errors, timing a single connection to the database showed 10 s per connection (see `localhost-ipv6-windows`).

**Cost:** several 8 to 11 minute full test runs on every issue from #6 to #9, until the owner asked why it was slow

