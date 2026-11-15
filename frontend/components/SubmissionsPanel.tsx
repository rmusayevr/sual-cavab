"use client";

import { useId, useRef } from "react";

import { plainName, shortDate } from "@/lib/answerLink";
import { useT } from "@/lib/i18n";
import type { SubmissionsApi } from "@/lib/useSubmissions";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState, LedgerLoading } from "./ui/Ledger";

/**
 * The summary of what clients sent through the answer link (#114, #121): how many answers are waiting and for which
 * questions (each one opens that question, where the answers themselves are shown and decided), "dismiss all" for
 * spam, and the dismissed answers with a way to bring one back. The answers are inside their questions
 * (WaitingAnswers); both read the same state (useSubmissions), so they cannot disagree.
 */
export default function SubmissionsPanel({
  submissions,
  onOpen,
}: {
  submissions: SubmissionsApi;
  /** Open the question with this number, where its waiting answers are. */
  onOpen: (questionNumber: number) => void;
}) {
  const t = useT();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { state, pending, dismissed, showDismissed, askAll, busy, problem } = submissions;

  // Which questions have answers waiting, in question order.
  const byQuestion = [...new Map(pending.map((s) => [s.question_number, s.question_label])).entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, label]) => ({ number, label, count: pending.filter((s) => s.question_number === number).length }));

  // A refusal is shown here when it was about "dismiss all", about an answer in the dismissed list, or about an
  // answer that is no longer waiting (someone else decided it): its own question no longer shows it, and the
  // person must still hear why nothing happened.
  const mine = problem && (problem.where === "card" || !pending.some((s) => s.id === problem.id)) ? problem : null;

  return (
    <Card className="grid gap-3" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} id={headingId} className="text-lg font-semibold">
          {t("submissions.title")}
        </h2>
        {state.kind === "ready" && pending.length > 0 && (
          <span className="font-mono text-xs">{t("submissions.waiting", { n: pending.length })}</span>
        )}
      </div>

      {state.kind === "loading" && <LedgerLoading label={t("submissions.loading")} />}
      {state.kind === "error" && <Alert tone="error">{t("submissions.loadError")}</Alert>}
      {state.kind === "ready" && pending.length === 0 && (
        <EmptyState strip={false}>
          <p>{t("submissions.none")}</p>
        </EmptyState>
      )}

      {byQuestion.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t("submissions.openHint")}</p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {byQuestion.map((q) => (
              <li key={q.number}>
                <Button variant="secondary" onClick={() => onOpen(q.number)}>
                  {t("submissions.openQuestion", { label: q.label, n: q.count })}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mine && <Alert tone="error">{mine.message}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void submissions.refresh()}>
          {t("submissions.refresh")}
        </Button>
        {pending.length > 1 &&
          (askAll ? (
            <span role="group" aria-label={t("submissions.dismissAllAsk")} className="flex flex-wrap items-center gap-2">
              <span>{t("submissions.dismissAllAsk")}</span>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void submissions.dismissAll().then((done) => done && headingRef.current?.focus())}
              >
                {t("submissions.dismissAllYes")}
              </Button>
              <Button variant="secondary" autoFocus disabled={busy} onClick={() => submissions.setAskAll(false)}>
                {t("question.cancel")}
              </Button>
            </span>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => submissions.setAskAll(true)}>
              {t("submissions.dismissAll")}
            </Button>
          ))}
        <Button variant="secondary" aria-pressed={showDismissed} onClick={submissions.toggleDismissed}>
          {showDismissed ? t("submissions.hideDismissed") : t("submissions.showDismissed")}
        </Button>
      </div>

      {showDismissed && (
        <div className="grid gap-2 border-t pt-3">
          {dismissed === null ? (
            <LedgerLoading label={t("submissions.loading")} />
          ) : dismissed.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("submissions.dismissedNone")}</p>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {dismissed.map((s) => {
                const who = plainName(s.submitter_name);
                return (
                  <li key={s.id} className="grid gap-1">
                    <p className="text-sm">
                      <span className="font-mono text-xs text-primary">{s.question_label}</span> {s.question_text}
                    </p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{s.text}</p>
                    <p className="text-sm text-muted-foreground">
                      {t(s.source === "account" ? "submissions.fromAccount" : "submissions.from", { who, when: shortDate(s.submitted_at) })}
                    </p>
                    <div>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        aria-label={`${t("submissions.restore")} ${s.question_label} · ${who}`}
                        onClick={() => void submissions.restore(s).then((done) => done && headingRef.current?.focus())}
                      >
                        {t("submissions.restore")}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
