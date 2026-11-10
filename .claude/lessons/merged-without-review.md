---
slug: merged-without-review
layer: skill:work-the-queue
status: local
---

# A loop PR was merged before its independent review ran

**Rule:** Never merge a loop PR before the fresh-eyes review has run and its triage comment is posted; there is no size exemption (a small infrastructure change is where PR #59 hid three defects).

## Occurrences

### 2026-11-10 — sual-cavab

PR #59 (a per-process test database name, issue #42, 2026-11) was merged without step 4 of work-the-queue (review fresh, triage). The owner had to ask 'did you run triage review?'. The review run afterwards found a `--keepdb` regression, a long-database-name truncation and my wrong claim about what `-k` does; all were fixed in PR #60 over two review rounds.

**Cost:** One extra PR (#60), two review rounds, and the owner had to ask whether the review had run.

