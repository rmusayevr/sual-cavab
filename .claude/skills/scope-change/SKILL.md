---
name: scope-change
description: Bound a change before editing — enumerate call sites, declare what stays untouched, and split when the diff outgrows the plan. Use before refactors, signature changes, or any edit expected to span several files.
---

# Scope a change

The cost of a change is not its size. It is the size of the region where you
cannot predict the effect.

## Before the first edit

Write down two lists. The second one matters more.

- **Will touch:** the files you expect to change, and why each one.
- **Will not touch:** the adjacent things you have decided to leave alone.

The second list is what makes the change reviewable. Without it, a reviewer
cannot tell whether an untouched file was considered and rejected or simply
missed.

## Changing a signature, schema, or return type

Enumerate call sites *before* editing, and count them.

- Grep for the identifier itself, not just for the import — dynamic dispatch,
  re-exports, string-keyed lookups, and test doubles will not show up in an
  import graph.
- Check tests, fixtures, and mocks. A mock with the old signature keeps passing
  and hides every broken caller behind it.
- **If the count surprises you, the plan was wrong.** Stop and re-scope before
  editing, rather than discovering it at file eleven.

## The "while I'm here" rule

An improvement you notice mid-change goes in a **separate commit**, or it does
not go in.

This is not tidiness. A change bundled with unrelated cleanup cannot be
reverted — reverting the bug also reverts the improvements, so under pressure
nobody reverts it, and the bug stays in. Bundling is how a one-line revert turns
into an incident.

Keep a running list of noticed-but-deferred items and hand it back at the end.

## When the diff crosses a boundary you did not plan for

Stop. Do not continue and mention it at the end.

Say what boundary was crossed, why the change requires it, and offer the split:
what can land now within the original scope, and what needs its own change. The
decision to widen scope belongs to whoever asked, and they can only make it
before the work is done.

## Incidents

- **sual-cavab, PR #118 (2026-11-15; vault `hand-built-mocks-miss-new-calls`).** Two new cards called two new endpoints; I updated the three fetch mocks I remembered, and sixteen other hand-built mocks answered with the project list, so the cards showed error alerts. One test asserting "no alert" failed only under load and I first called it a flake. Before pushing a component that calls a new endpoint, grep every test that renders it or its parent, and stub it where the test is not about it.
