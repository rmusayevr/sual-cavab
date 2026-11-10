---
slug: merged-without-review
layer: skill:work-the-queue
status: local
---

# A loop PR was merged before its independent review ran

**Rule:** Never merge a loop PR before the fresh-eyes review has run and its triage comment is posted; there is no size exemption (a small infrastructure change is where PR #59 hid two regressions).

## Occurrences

### 2026-11-09 — sual-cavab

PR #59 (a per-process test database name, issue #42) was merged without step 4 of work-the-queue (review fresh, triage). The owner asked whether the triage review had run. The review run afterwards found two regressions (runs with `--keepdb` lost the shared database name, and long database names were cut wrongly), fixed in PR #60 over two review rounds. Since PR #86 a hook also asks before `gh pr merge` when the PR has no review triage comment.

**Cost:** One extra PR (#60), two review rounds, and the owner had to ask whether the review had run.

