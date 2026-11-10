---
slug: windows-edit-script-escapes
layer: vault
status: local
---

# Inline edit scripts on Windows silently changed backslashes, escapes and line endings

**Rule:** When editing source files with a script on Windows, put the script in a file (not an inline heredoc), build backslashes with chr(92) or raw strings you have checked, write with newline='' and read `git diff --stat` before committing: inline Python turned `\b` into a backspace, flipped LF files to CRLF, and collapsed `[\\/]` into `[\/]` with no error.

## Occurrences

### 2026-11-10 — sual-cavab

Seen on 2026-11-09 and 2026-11-10: (1) `\b` in a Python string became a backspace character, so two tests were silently wrong; (2) editing with Python's text mode rewrote two test files from LF to CRLF, which showed up only as a whole-file diff stat; (3) a regex `[\\/]Wordmark` written through a heredoc landed in the file as `[\/]Wordmark`, so a design test kept failing until I printed the bytes with repr; (4) the shell tool refused some heredocs that contained quotes. Each time the symptom was a wrong test or diff, never an error from the edit.

**Cost:** Several debugging rounds across two days, one commit of whole-file line-ending churn caught only by the diff stat.

