---
slug: mutation-undo-by-copy-not-checkout
layer: skill:verify-for-real
status: local
---

# Undo mutations from a copy, not git checkout

**Rule:** Undo a mutation by restoring a copy made before it, never with `git checkout -- <file>`, which also discards the uncommitted work in that file.

## Occurrences

### 2026-11-12 — sual-cavab

2026-11-10, PR #98 (test passwords). A mutation-testing script restored each mutated file with `git checkout -- <file>`. Three of those files held uncommitted edits for the same PR, and the first run reverted them. It was noticed only from `git status`; the edits were re-applied from the script and every check re-run (about an hour). Since then every mutation script copies the file aside first and copies it back, and none has lost work.

**Cost:** about an hour re-applying and re-running

