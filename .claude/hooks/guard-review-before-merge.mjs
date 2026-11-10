#!/usr/bin/env node
/**
 * PreToolUse guard (this project's own, not the harness's): ask before `gh pr merge <n>` when the
 * PR has no review triage comment.
 *
 * Bought by sual-cavab PR #59 (2026-11), merged without step 4 of work-the-queue (review fresh,
 * triage). The owner had to ask whether the review had run; it then found three defects, fixed in
 * #60. Lesson: merged-without-review (.claude/lessons/).
 *
 * `ask`, not `deny`: the owner may tell the agent to merge a docs-only PR without a review, and a
 * guard that over-blocks gets switched off. The reason says so. In a mode where nobody can answer,
 * an ask is a block, which is the point.
 *
 * Decidable from GitHub, not from the command, so it asks `gh` (a network call, made only for a
 * `gh pr merge` segment, with a timeout under the hook's own). FAIL OPEN, like every hook here:
 * `gh` missing, unauthenticated, slow, no PR number in the command (a merge of the current branch
 * is not checked) or an unexpected answer means no decision.
 *
 * A separate file on purpose: guard-merge.mjs is installed by the harness and a local patch to it
 * would be overwritten by the next update.
 */
import { pathToFileURL } from 'node:url';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const MERGE = /\bgh\s+pr\s+merge\b([^;&|\n]*)/;

/** The PR number in `gh pr merge ...` (a bare number or a .../pull/<n> URL), or null. */
export function prNumber(command) {
  const m = MERGE.exec(String(command ?? ''));
  if (!m) return null;
  for (const raw of m[1].trim().split(/\s+/)) {
    const token = raw.replace(/^['"]|['"]$/g, '');
    if (/^\d+$/.test(token)) return Number(token);
    const url = /\/pull\/(\d+)/.exec(token);
    if (url) return Number(url[1]);
  }
  return null;
}

/** Comment and review bodies of a PR, or null if they cannot be read. */
function fetchBodies(number) {
  try {
    const out = execFileSync('gh', ['pr', 'view', String(number), '--json', 'comments,reviews'], {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const data = JSON.parse(out);
    return [...(data.comments ?? []), ...(data.reviews ?? [])].map((c) => String(c.body ?? ''));
  } catch {
    return null; // fail open
  }
}

export function decide(payload, deps = {}) {
  if (payload?.tool_name !== 'Bash') return null;
  const number = prNumber(payload?.tool_input?.command);
  if (number === null) return null;
  const bodies = (deps.fetchBodies ?? fetchBodies)(number);
  if (!Array.isArray(bodies)) return null;
  if (bodies.some((b) => /review triage/i.test(b))) return null;
  return {
    decision: 'ask',
    rule: 'review-before-merge',
    reason:
      `PR #${number} has no "Review triage" comment. work-the-queue step 4: the fresh-eyes review ` +
      `runs and its triage is posted before the merge (PR #59 was merged without it and the review ` +
      `then found three defects). Merge only if the owner told you to merge this PR without a review ` +
      `(for example a docs-only PR); otherwise run the review first.`,
  };
}

function record(decision, payload) {
  try {
    appendFileSync(
      join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'harness-decisions.log'),
      JSON.stringify({
        ts: new Date().toISOString(),
        hook: 'guard-review-before-merge',
        decision: decision.decision,
        rule: decision.rule,
        tool: payload?.tool_name,
        target: String(payload?.tool_input?.command ?? '').slice(0, 300),
        session: payload?.session_id,
        mode: payload?.permission_mode,
      }) + '\n',
    );
  } catch {
    /* never let logging change the decision */
  }
}

async function main() {
  let decision = null;
  let payload = null;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    decision = decide(payload);
  } catch {
    process.exit(0);
  }
  if (!decision) process.exit(0);
  record(decision, payload);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision.decision,
        permissionDecisionReason: `[project:${decision.rule}] ${decision.reason}`,
      },
    }),
  );
  process.exit(0);
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) main().catch(() => process.exit(0));
