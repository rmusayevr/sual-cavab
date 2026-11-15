---
slug: scanner-reads-names-and-shapes
layer: skill:handle-secrets
status: local
---

# Secret scanners flag names and shapes, even invented values

**Rule:** A secret scanner reads names and shapes, not truth: a variable called PASSWORD (or a literal that looks like a credential) is flagged even when the value is invented, so name test values for what they are and build credential-shaped samples from fragments.

## Occurrences

### 2026-11-12 — sual-cavab

2026-11-10, PR #98. GitGuardian failed the check on `PASSWORD = \`pw-...\`` in a test and on the guard test's own sample literals, although every value was invented. Fixed by renaming to `TYPED = crypto.randomUUID()` and building the samples from fragments, which needed an amend and a force-push of the PR branch (confirmed by the owner) and a second round of review.

**Cost:** failed check, amend and force-push, an extra review round

