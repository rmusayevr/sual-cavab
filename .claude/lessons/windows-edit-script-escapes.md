---
slug: windows-edit-script-escapes
layer: skill:read-your-own-diff
status: local
---

# Inline edit scripts on Windows silently changed backslashes, escapes and line endings

**Rule:** Edit source files on Windows with a script saved as a file and run (not an inline heredoc), written to keep line endings and encoding (Python `newline=''`; never PowerShell 5.1 `Out-File` or `Set-Content`), with Windows paths for Windows tools and a `sed` limited to one line, and read `git diff --stat` after every scripted edit: each slip changed files with no error from the edit.

## Occurrences

### 2026-11-10 — sual-cavab

Seen on 2026-11-09 and 2026-11-10: (1) `\b` in a Python string became a backspace character, so two tests were silently wrong; (2) editing with Python's text mode rewrote two test files from LF to CRLF, which showed up only as a whole-file diff stat; (3) a regex `[\\/]Wordmark` written through a heredoc landed in the file as `[\/]Wordmark`, so a design test kept failing until I printed the bytes with repr; (4) the shell tool refused some heredocs that contained quotes. Each time the symptom was a wrong test or diff, never an error from the edit.

**Cost:** Several debugging rounds across two days, one commit of whole-file line-ending churn caught only by the diff stat.

### 2026-11-15 — sual-cavab

2026-11-15, PR #116 (removing drafting) and the work after it: silent edit-script slips again. (1) A Python text-mode edit rewrote Workspace.tsx from LF to CRLF; a change of about 90 lines (96 in commit 7139033) showed in `git diff --stat` as a whole-file diff, and I converted it back with sed. (2) A mutation run wrote the old files with PowerShell 5.1 `Out-File -Encoding utf8`, which adds a BOM: 14 of 15 landing-page tests failed for the wrong reason, so the run proved nothing and was redone. (3) A `sed` replacing `(url: string)` across a whole test file stripped a parameter from mocks that needed it (typecheck caught it) and added an unused one to the rest (lint caught it). (4) Windows Python could not open a Git Bash `/c/Users/...` path, so a PR-body edit failed and `gh pr edit` re-submitted the old body without error; a long heredoc was also refused by the shell tool again (as on 2026-11-10); these two are from the session, not from the repo history. Each was caught by the diff stat, typecheck or lint, none by the edit itself, and two of them never reached a diff (the temporary mutation run, the PR-body edit). The vault entry was listed at the start of the session by `recall-lessons` and not opened.

**Cost:** about 20 minutes (my estimate): one invalid mutation run redone, two rounds fixing a broad sed, one PR-body retry
