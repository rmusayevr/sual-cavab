"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { isSubmissionList, plainName, shortDate, type Submission } from "@/lib/answerLink";
import { useT } from "@/lib/i18n";

import { failure } from "./QuestionItem";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Textarea } from "./ui/Field";
import { EmptyState, LedgerLoading } from "./ui/Ledger";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; pending: Submission[] };

/**
 * What clients sent through the answer link, waiting for a member to decide (#114). Nothing a client sends is an
 * answer until a member accepts it here; accepting uses the same status change as every other answer. The text
 * and the name are typed by an anonymous person: they are shown as plain text, never as markup, the name has
 * its direction-control characters removed (one could reverse the words around it), and the name is marked as
 * not verified. After each change the list is read again from the server.
 */
export default function SubmissionsPanel({
  projectId,
  onAccepted,
}: {
  projectId: number;
  /** Called with the question's number after a submission became its answer, so the page can reload that question. */
  onAccepted: (questionNumber: number) => void;
}) {
  const t = useT();
  const base = `/api/projects/${projectId}/submissions/`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);
  const latestLoad = useRef(0); // only the newest read may change what is shown
  const returnFocusTo = useRef<number | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [dismissed, setDismissed] = useState<Submission[] | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [accepting, setAccepting] = useState<number | null>(null); // the submission being edited before it is accepted
  const [draft, setDraft] = useState("");
  const [askAll, setAskAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const read = useCallback(
    async (which: "pending" | "dismissed"): Promise<Submission[] | null> => {
      try {
        const response = await apiFetch(`${base}?state=${which}`);
        const body = response.ok ? await response.json() : null;
        return isSubmissionList(body) ? body : null;
      } catch {
        return null;
      }
    },
    [base],
  );

  const load = useCallback(
    async (alsoDismissed: boolean) => {
      const mine = ++latestLoad.current;
      const [pending, other] = await Promise.all([read("pending"), alsoDismissed ? read("dismissed") : Promise.resolve(undefined)]);
      if (mine !== latestLoad.current) return; // a newer read has started: its answer is the one to show
      setState(pending ? { kind: "ready", pending } : { kind: "error" });
      if (pending && pending.length <= 1) setAskAll(false); // "dismiss all" is not offered for one, and must not come back unasked
      if (other !== undefined) setDismissed(other);
    },
    [read],
  );

  useEffect(() => {
    // Read once on mount; the setState calls happen after the request, not during the render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [load]);

  // After Cancel the editor goes away and the Accept button it replaced comes back: put the keyboard on it.
  useEffect(() => {
    if (accepting === null && returnFocusTo.current !== null) {
      document.getElementById(`accept-${returnFocusTo.current}`)?.focus();
      returnFocusTo.current = null;
    }
  }, [accepting]);

  /** Do one change, then read the lists again (also after a refusal: the refusal usually means the list is out of date). */
  async function change(path: string, body: unknown, fallback: string, fields: string[], then?: () => void) {
    if (inFlight.current) return; // a second click while the first is still on its way
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response = await apiFetch(`${base}${path}`, { method: "POST", body });
      if (response.ok) {
        then?.();
        await load(showDismissed);
        headingRef.current?.focus(); // the button that was pressed is gone: keep the keyboard on this card
      } else {
        const errors = await failure(response, fallback, fields);
        setProblem(errors.form ?? Object.values(errors)[0] ?? fallback);
        await load(showDismissed);
      }
    } catch {
      setProblem(t("error.server"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function onAccept(event: FormEvent<HTMLFormElement>, s: Submission) {
    event.preventDefault();
    void change(`${s.id}/accept/`, { text: draft }, t("submissions.acceptFailed"), ["text"], () => {
      setAccepting(null);
      onAccepted(s.question_number);
    });
  }

  function toggleDismissed() {
    const next = !showDismissed;
    setShowDismissed(next);
    if (next) {
      setDismissed(null); // not the list from the last time it was open
      void load(true);
    }
  }

  const pending = state.kind === "ready" ? state.pending : [];

  return (
    <Card className="grid gap-3" aria-labelledby={`submissions-heading-${projectId}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} id={`submissions-heading-${projectId}`} className="text-lg font-semibold">
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

      {pending.length > 0 && (
        <ul className="m-0 grid list-none gap-4 p-0">
          {pending.map((s) => {
            const who = plainName(s.submitter_name);
            const name = `${s.question_label} · ${who}`;
            return (
              <li key={s.id} className="grid gap-2 border-t pt-3 first:border-t-0 first:pt-0">
                <p className="text-sm">
                  <span className="font-mono text-xs text-primary">{s.question_label}</span> {s.question_text}
                </p>
                <p className="whitespace-pre-wrap">{s.text}</p>
                <p className="text-sm text-muted-foreground">
                  {t("submissions.from", { who, when: shortDate(s.submitted_at) })}
                </p>
                {accepting === s.id ? (
                  <form onSubmit={(e) => onAccept(e, s)} className="grid gap-2" aria-label={name}>
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
                        setProblem(null);
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
                      onClick={() => void change(`${s.id}/dismiss/`, {}, t("submissions.dismissFailed"), [])}
                    >
                      {t("submissions.dismiss")}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {problem && <Alert tone="error">{problem}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void load(showDismissed)}>
          {t("submissions.refresh")}
        </Button>
        {pending.length > 1 &&
          (askAll ? (
            <span role="group" aria-label={t("submissions.dismissAllAsk")} className="flex flex-wrap items-center gap-2">
              <span>{t("submissions.dismissAllAsk")}</span>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void change("dismiss-pending/", {}, t("submissions.dismissFailed"), [], () => setAskAll(false))}
              >
                {t("submissions.dismissAllYes")}
              </Button>
              <Button variant="secondary" autoFocus disabled={busy} onClick={() => setAskAll(false)}>
                {t("question.cancel")}
              </Button>
            </span>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setAskAll(true)}>
              {t("submissions.dismissAll")}
            </Button>
          ))}
        <Button variant="secondary" aria-pressed={showDismissed} onClick={toggleDismissed}>
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
                      {t("submissions.from", { who, when: shortDate(s.submitted_at) })}
                    </p>
                    <div>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        aria-label={`${t("submissions.restore")} ${s.question_label} · ${who}`}
                        onClick={() => void change(`${s.id}/restore/`, {}, t("submissions.restoreFailed"), [])}
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
