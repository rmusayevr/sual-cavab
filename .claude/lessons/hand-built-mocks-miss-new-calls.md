---
slug: hand-built-mocks-miss-new-calls
layer: skill:scope-change
status: local
---

# A component that starts calling a new endpoint breaks hand-built fetch mocks, and the failure shows only as a timing flake

**Rule:** When a component starts calling a new endpoint, find every test that renders it (grep for the component and for its parent) and every hand-built fetch mock in them before you push: a mock that does not know the new URL falls through to another reply, the component renders an error state, and an assertion that checks for "no alert" passes or fails with the timing of the request, so the flake shows up only under load. Stub the new component in tests that are not about it, and test it together with its parent in one file with a complete mock.

## Occurrences

### 2026-11-15 — sual-cavab

2026-11-15, sual-cavab, PR #118 (issue #114). I added two cards to the workspace that fetch two new endpoints and updated the three shared mocks I remembered (one in each of three test files). In Workspace.test.tsx 15 other hand-built fetch mocks did not know the new URLs (14 of them could fall through to the project list), so the cards rendered their error alerts. One test, "shows the project when the members call fails on the network", asserts that there is no alert; it passed in every normal run (it asserts before the cards' requests resolve) and failed twice only during mutation runs, which are slower. I first called it a possible flake and moved on, and the independent review did not catch it; I traced it only because it recurred. The fix was structural: stub the cards in Workspace.test.tsx and test the real cards with the workspace in their own file. The scope-change skill already says to check tests, fixtures and mocks; that line did not fire for a change that only added a card, so this is that rule not firing, not a new rule.

**Cost:** about 25 minutes (my estimate) and a latent CI flake
