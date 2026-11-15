---
slug: test-must-be-seen-to-fail
layer: skill:design-a-test
status: local
---

# A test that guards a rule must be seen failing, for the right reason, with the rule removed

**Rule:** A test that guards a rule is not done until you have watched it fail with the rule removed, and for the reason you claim: it must pass with the guard, fail without it, and the failing message must name the guarded behaviour. A test that fails for another reason (a wrong comparison, a byte-order mark, a missing mock, a delay in the wrong place) looks like a catch and proves nothing; a concurrency test passes without its lock unless the delay sits between the check and the write.

## Occurrences

### 2026-11-15 — sual-cavab

2026-11-15, sual-cavab, issue #114 (the answer link, three PRs, about 90 guards broken one at a time). Four times a test looked right and was not: (1) a real-thread test for "at most 5 waiting answers" passed with the row lock removed, because its artificial delay sat before the count instead of between the count and the insert; the mutation run exposed it. (2) My first repair of it inverted the comparison, so the unmutated test failed and the mutated run reported "KILLED" for the wrong reason; I only saw it because the unmutated run was red. (3) A mutation run of the old components, written by PowerShell 5.1 with a BOM, failed 14 of 15 landing-page tests: a "catch" that proved nothing. (4) The late-answer guard of the client page had no test at all; the mutation run reported it as a survivor. In each case the unmutated run being green and the mutated run failing on the named test was what told the truth.

Cost: about 40 minutes across the three PRs, and two guards that would have shipped unguarded.

**Cost:** About 40 minutes across three PRs; two guards would have shipped unguarded

