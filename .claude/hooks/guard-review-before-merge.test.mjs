// Run with: node --test .claude/hooks/guard-review-before-merge.test.mjs
// (not part of CI: the hooks are the operator's guard, and these are the cases promised when it was proposed)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decide, prNumber } from './guard-review-before-merge.mjs';

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const bodies = (...b) => ({ fetchBodies: () => b });

test('asks to merge a PR that has no review triage comment', () => {
  const d = decide(bash('gh pr merge 59 --merge --delete-branch'), bodies('looks fine', 'CI green'));
  assert.equal(d.decision, 'ask');
  assert.equal(d.rule, 'review-before-merge');
  assert.match(d.reason, /#59/);
});

test('lets a PR with a "Review triage" comment through', () => {
  assert.equal(decide(bash('gh pr merge 60 --merge'), bodies('## Review triage (fresh-eyes reviewer)\n...')), null);
});

test('also counts a review body, and is not case sensitive', () => {
  assert.equal(decide(bash('gh pr merge 61'), bodies('review TRIAGE: 2 blockers fixed')), null);
});

test('finds the number after flags and in a URL', () => {
  assert.equal(prNumber('gh pr merge --merge --delete-branch 84'), 84);
  assert.equal(prNumber('gh pr merge https://github.com/o/r/pull/77 --merge'), 77);
  assert.equal(prNumber("gh pr merge '85'"), 85);
});

test('ignores commands that are not a merge', () => {
  assert.equal(decide(bash('gh pr view 59'), bodies()), null);
  assert.equal(decide(bash('gh pr checks 59'), bodies()), null);
  assert.equal(decide(bash('git merge feature'), bodies()), null);
});

test('only judges a merge segment of a longer command', () => {
  assert.equal(decide(bash('gh pr checks 59 && gh pr merge 59 --merge'), bodies('nothing')).decision, 'ask');
});

test('fails open: no number, unreadable comments, other tools', () => {
  assert.equal(decide(bash('gh pr merge --merge'), bodies()), null);
  assert.equal(decide(bash('gh pr merge 59'), { fetchBodies: () => null }), null);
  assert.equal(decide({ tool_name: 'Edit', tool_input: {} }, bodies()), null);
  assert.equal(decide(null, bodies()), null);
});
