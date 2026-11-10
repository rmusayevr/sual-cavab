---
slug: flag-meaning-from-memory
layer: vault
status: local
---

# A command-line flag's meaning was written down from memory and was wrong

**Rule:** Before writing what a command-line flag does into code, a comment or the README, read the tool's source or --help; in Django's test runner `-k` is the test-name filter, not `--keepdb`.

## Occurrences

### 2026-11-09 — sual-cavab

In the first commit of PR #60 (the fix for the regressions found in PR #59) I wrote from memory that `-k` is `--keepdb`: in a code comment, in the check that decided whether to use a per-process test database name, and in the README. Django's source says `-k` filters tests by name. The independent review of #60 caught it in round 1, before #60 merged, and the fix landed in the same PR. CLAUDE.md already says 'Do not invent file paths, flags, config keys ... Check, or say it is unchecked': the rule existed and did not fire at the moment of writing, so no new layer is proposed.

**Cost:** A wrong claim in a fix PR that had to be reviewed and rewritten (one extra review round). It never reached `staging`: the review caught it first.
