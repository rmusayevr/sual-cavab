---
slug: hand-built-mocks-miss-new-calls
layer: skill:scope-change
status: local
---

# A component that starts calling a new endpoint breaks hand-built fetch mocks, and the failure shows only as a timing flake

**Rule:** When a component starts calling a new endpoint, find every test that renders it (grep for the component and for its parent) and every hand-built fetch mock in them before you push: a mock that does not know the new URL falls through to another reply, the component renders an error state, and an assertion that checks for "no alert" passes or fails with the timing of the request, so the flake shows up only under load. Stub the new component in tests that are not about it, and test it together with its parent in one file with a complete mock.

## Occurrences

### 2026-11-15 — sual-cavab

2026-11-15, sual-cavab, PR #118 (issue #114). I added two cards to the workspace that fetch two new endpoints and updated the three fetch mocks I knew about. Sixteen other hand-built mocks in Workspace.test.tsx did not know the new URLs, so they answered with the project list; the cards rendered their error alerts. One test, "shows the project when the members call fails on the network", asserts that there is no alert; it passed in every normal run (it asserts before the cards' requests resolve) and failed twice only during mutation runs, which are slower. I first called it a possible flake and moved on; the independent review did not catch it. I traced it only because it recurred. The fix was structural: stub the cards in Workspace.test.tsx and test the real cards with the workspace in their own file.

Cost: about 25 minutes, and a latent flake that would have failed CI for someone else.

**Cost:** About 25 minutes and a latent CI flake

