---
slug: flag-meaning-from-memory
layer: vault
status: local
---

# A command-line flag's meaning was written down from memory and was wrong

**Rule:** Before writing what a command-line flag does into code, a comment or the README, read the tool's source or --help; in Django's test runner `-k` is the test-name filter, not `--keepdb`.

## Occurrences

### 2026-11-10 — sual-cavab

In PR #59 I wrote from memory that `-k` is `--keepdb`: in a code comment, in the check that decided whether to use a per-process test database name, and in the README. Django's source says `-k` filters tests by name, so runs with `-k` skipped the per-process name. The independent review found it; fixed in PR #60. CLAUDE.md already says 'Do not invent file paths, flags, config keys ... Check, or say it is unchecked': the rule existed and did not fire at the moment of writing, so no new layer is proposed.

**Cost:** A wrong claim shipped in a merged PR, a regression for `-k` runs, and part of a second PR to fix it.

