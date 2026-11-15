---
slug: test-must-be-seen-to-fail
layer: skill:design-a-test
status: local
---

# A test that guards a rule must be seen failing, for the right reason, with the rule removed

**Rule:** Before trusting any new test, delete or break the exact line it guards and watch that test go red for the reason it claims, for every new test (not only the ones you doubt), and for each also ask whether deleting the thing it describes in a non-code file (a page key row, a data entry) would go red; it must pass with the guard and fail without it, because an assertion that holds either way, or that fails for another reason (a wrong comparison, a byte-order mark, a missing mock, a delay in the wrong place), looks identical to a good one.

## Occurrences

### 2026-11-15 — sual-cavab

2026-11-15, sual-cavab, issue #114 (the answer link, three PRs; more than 100 guards were broken one at a time, counted from the PR descriptions). Mutation runs showed three times that a guard was not what it seemed: (1) a real-thread test for "at most 5 waiting answers" passed with the row lock removed, because its artificial delay sat before the count instead of between the count and the insert (PR #117, review round 1); (2) my first repair of it inverted the comparison, so the unmutated test failed and the mutated run printed "KILLED" for the wrong reason, which I noticed only because the unmutated run was red; (3) the client page's late-answer guard had no test at all and the mutation run reported it as a survivor (PR #119). In each case what told the truth was the pair: green without the mutation, red on the named test with it.

**Cost:** roughly 40 minutes across three PRs (my estimate, not recorded in the repo); two guards would have shipped unguarded
