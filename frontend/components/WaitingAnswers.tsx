"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { plainName, shortDate, type Submission } from "@/lib/answerLink";
import { useT } from "@/lib/i18n";
import type { SubmissionsApi } from "@/lib/useSubmissions";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Field, Textarea } from "./ui/Field";

/**
 * What clients sent through the answer link for ONE question, waiting for a member to decide, shown inside that
 * question (#121). The client's text and name are typed by an anonymous person: they are shown as plain text,
 * never as markup, the name has its direction-control characters removed (one could reverse the words around it),
 * and it is marked as not verified.
 */
export default function WaitingAnswers({
  items,
  submissions,
  onSettled,
}: {
  items: Submission[];
  submissions: SubmissionsApi;
  /** Called after a decision went through, when the button that was pressed has gone: put the keyboard somewhere sensible. */
  onSettled?: () => void;
}) {
  const t = useT();
  const returnFocusTo = useRef<number | null>(null);
  const [accepting, setAccepting] = useState<number | null>(null); // the submission being edited before it is accepted
  const [draft, setDraft] = useState("");
  const { busy, problem } = submissions;

  // After Cancel the editor goes away and the Accept button it replaced comes back: put the keyboard on it.
  useEffect(() => {
    if (accepting === null && returnFocusTo.current !== null) {
      document.getElementById(`accept-${returnFocusTo.current}`)?.focus();
      returnFocusTo.current = null;
    }
  }, [accepting]);

  if (items.length === 0) return null;

  async function onAccept(event: FormEvent<HTMLFormElement>, s: Submission) {
    event.preventDefault();
    if (await submissions.accept(s, draft)) {
      setAccepting(null);
      onSettled?.();
    }
  }

  const mine = problem && items.some((s) => s.id === problem.id) ? problem : null;

  return (
    <section aria-label={t("submissions.waitingHere")} className="grid gap-3 rounded-md border border-l-4 border-l-saffron bg-muted p-3">
      <h3 className="text-sm font-medium">{t("submissions.waitingHere")}</h3>
      <ul className="m-0 grid list-none gap-4 p-0">
        {items.map((s) => {
          const who = plainName(s.submitter_name);
          const name = `${s.question_label} · ${who}`;
          return (
            <li key={s.id} className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0">
              <p className="whitespace-pre-wrap">{s.text}</p>
              <p className="text-sm text-muted-foreground">
                {t("submissions.from", { who, when: shortDate(s.submitted_at) })}
              </p>
              {accepting === s.id ? (
                <form onSubmit={(e) => void onAccept(e, s)} className="grid gap-2" aria-label={name}>
                  <Field label={t("submissions.acceptLabel", { label: s.question_label })}>
                    {(props) => (
                      <Textarea
                        rows={5}
                        required
                        autoFocus
                        disabled={busy}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        {...props}
                      />
                    )}
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={busy}>
                      {busy ? t("submissions.accepting") : t("submissions.acceptSave")}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        returnFocusTo.current = s.id;
                        setAccepting(null);
                      }}
                    >
                      {t("question.cancel")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    id={`accept-${s.id}`}
                    disabled={busy}
                    aria-label={`${t("submissions.accept")} ${name}`}
                    onClick={() => {
                      setDraft(s.text);
                      setAccepting(s.id);
                    }}
                  >
                    {t("submissions.accept")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    aria-label={`${t("submissions.dismiss")} ${name}`}
                    onClick={() => void submissions.dismiss(s).then((done) => done && onSettled?.())}
                  >
                    {t("submissions.dismiss")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {mine && <Alert tone="error">{mine.message}</Alert>}
    </section>
  );
}
