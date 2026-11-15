---
slug: windows-edit-script-escapes
layer: vault
status: local
---

# Inline edit scripts on Windows silently changed backslashes, escapes and line endings

**Rule:** When editing source files with a script on Windows, put the script in a file (not an inline heredoc), build backslashes with chr(92) or raw strings you have checked, write with newline='' in Python (text mode flips LF files to CRLF), never use PowerShell 5.1 `Out-File -Encoding utf8` or `Set-Content` for source (they add a BOM or the ANSI codepage; write through Git Bash `>` or .NET UTF8Encoding($false)), give Windows Python and `gh --body-file` Windows paths (a Git Bash `/c/...` path is not found by Python), scope a `sed` to one line number, and read `git diff --stat` (a whole-file diff means line endings) before moving on: each of these changed files with no error from the edit.

## Occurrences

### 2026-11-10 — sual-cavab

Seen on 2026-11-09 and 2026-11-10: (1) `\b` in a Python string became a backspace character, so two tests were silently wrong; (2) editing with Python's text mode rewrote two test files from LF to CRLF, which showed up only as a whole-file diff stat; (3) a regex `[\\/]Wordmark` written through a heredoc landed in the file as `[\/]Wordmark`, so a design test kept failing until I printed the bytes with repr; (4) the shell tool refused some heredocs that contained quotes. Each time the symptom was a wrong test or diff, never an error from the edit.

**Cost:** Several debugging rounds across two days, one commit of whole-file line-ending churn caught only by the diff stat.

### 2026-11-15 — sual-cavab

2026-11-15, PR #116 (removing drafting): four more silent edit-script slips in one session. (1) A Python text-mode edit of Workspace.tsx rewrote it LF to CRLF; the diff stat showed 315 insertions and 401 deletions for a 90-line change, and I converted it back with sed. (2) A mutation check wrote the old files with PowerShell 5.1 `Out-File -Encoding utf8`, which adds a BOM: 14 of 15 landing-page tests failed for the wrong reason, so the run proved nothing and had to be redone. (3) A `sed` replacing `(url: string)` across the whole test file stripped a parameter from mocks that needed it and added an unused one to the rest: 4 type errors, then 10 lint warnings. (4) Windows Python could not open a Git Bash `/c/Users/...` path, so a PR-body edit failed and `gh pr edit` re-submitted the old body without error. A long heredoc was also refused by the shell tool again (as in the 2026-11-10 entry). Each was caught by the diff stat, lint or typecheck, none by the edit itself. The vault entry was listed at the start of the session by `recall-lessons` and not opened.

Cost: about 20 minutes: one invalid mutation run redone, two rounds of fixing a broad sed, one PR-body retry.

**Cost:** About 20 minutes in PR #116 (one invalid mutation run redone, two rounds fixing a broad sed, one PR-body retry)

