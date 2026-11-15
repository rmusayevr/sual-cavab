"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { SIGNED_OUT_EVENT, apiFetch } from "@/lib/api";
import type { ClientAccountQuestion, ClientAccountView, OwnAnswer } from "@/lib/clientAccount";
import { fieldErrors } from "@/lib/questions";
import { LanguageSwitch, useT } from "@/lib/i18n";

import SessionStatus from "./SessionStatus";
import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Textarea } from "./ui/Field";
import { CarpetStrip, EmptyState, Eyebrow, LedgerLoading } from "./ui/Ledger";
import { SignInPrompt } from "./ui/SignInPrompt";
import { Wordmark } from "./ui/Wordmark";

type State =
  | { kind: "loading" }
  | { kind: "ready"; view: ClientAccountView }
  | { kind: "signed-out" }
  | { kind: "not-found" }
  | { kind: "throttled" }
  | { kind: "error" };

/**
 * The page of a client account for one project (#121): the project's open questions, a box to answer each, and
 * what this person has already sent. A client has an account, so the team sees their name; nothing is asked for
 * here but the text. Everything shown comes from the server's allowlisted reply and goes on the page as plain
 * text. A client sees no other answer, member or project, and the page links to nothing of the team's.
 */
export default function ClientWorkspace() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const base = `/api/client/projects/${encodeURIComponent(id)}/questions/`;
  const [state, setState] = useState<State>({ kind: "loading" });
  const latestRead = useRef(0); // only the newest read may change what is shown

  const load = useCallback(
    async (quiet = false): Promise<"ok" | "gone" | "failed"> => {
      const mine = ++latestRead.current;
      if (!quiet) setState({ kind: "loading" });
      try {
        const response = await apiFetch(base);
        if (mine !== latestRead.current) return "failed";
        if (response.status === 401 || response.status === 403) {
          setState({ kind: "signed-out" });
          return "gone";
        }
        if (response.status === 404) {
          setState({ kind: "not-found" });
          return "gone";
        }
        if (response.status === 429) {
          if (!quiet) setState({ kind: "throttled" });
          return "failed";
        }
        if (!response.ok) throw new Error(String(response.status));
        setState({ kind: "ready", view: (await response.json()) as ClientAccountView });
        return "ok";
      } catch {
        if (mine === latestRead.current && !quiet) setState({ kind: "error" });
        return "failed";
      }
    },
    [base],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The person signed out in the header: show the signed-out page now, not after a refresh.
  useEffect(() => {
    const signedOut = () => {
      latestRead.current += 1;
      setState({ kind: "signed-out" });
    };
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  const shell = (body: ReactNode) => (
    <div className="min-h-screen bg-background [overflow-wrap:anywhere]">
      <header className="bg-navy pattern-lattice text-navy-foreground">
        <nav className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Wordmark className="font-display text-xl font-semibold" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <LanguageSwitch />
            <SessionStatus layout="nav" wakingNote={false} />
          </div>
        </nav>
        <CarpetStrip />
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-6 sm:px-6">{body}</main>
    </div>
  );

  if (state.kind === "loading") return shell(<LedgerLoading label={t("client.loading")} />);
  if (state.kind === "signed-out")
    return shell(
      <EmptyState strip={false}>
        <SignInPrompt line="workspace.signInLine" />
      </EmptyState>,
    );
  if (state.kind === "not-found")
    return shell(
      <EmptyState strip={false}>
        <p>{t("workspace.notFound")}</p>
        <div>
          <Link href="/projects" className={buttonClasses("secondary")}>
            {t("workspace.back")}
          </Link>
        </div>
      </EmptyState>,
    );
  if (state.kind === "throttled" || state.kind === "error")
    return shell(
      <div className="grid gap-3">
        <Alert tone="error">{state.kind === "throttled" ? t("client.throttled") : t("client.loadError")}</Alert>
        <div>
          <Button variant="secondary" onClick={() => void load()}>
            {t("client.retry")}
          </Button>
        </div>
      </div>,
    );

  const { view } = state;
  const sent = (number: number, answer: OwnAnswer) =>
    setState((s) =>
      s.kind === "ready"
        ? {
            kind: "ready",
            view: { ...s.view, questions: s.view.questions.map((q) => (q.number === number ? { ...q, mine: [...q.mine, answer] } : q)) },
          }
        : s,
    );

  return shell(
    <>
      <div className="grid gap-2">
        <Eyebrow>{t("client.eyebrow")}</Eyebrow>
        <h1 className="text-3xl font-semibold">{view.project_name}</h1>
        <p className="text-muted-foreground">{t("clientAccount.lead")}</p>
        <p className="text-sm text-muted-foreground">{t("client.privacy")}</p>
      </div>

      {view.questions.length === 0 ? (
        <EmptyState strip={false}>
          <p>{t("client.empty")}</p>
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {view.questions.map((q) => (
            <li key={q.number}>
              <QuestionCard question={q} base={base} onSent={(answer) => sent(q.number, answer)} onCheck={() => load(true)} />
            </li>
          ))}
        </ul>
      )}

      {view.earlier.length > 0 && (
        <section aria-label={t("clientAccount.earlier")} className="grid gap-3">
          <h2 className="text-xl font-semibold">{t("clientAccount.earlier")}</h2>
          <p className="text-sm text-muted-foreground">{t("clientAccount.earlierHint")}</p>
          <ul className="m-0 grid list-none gap-3 p-0">
            {view.earlier.map((e, index) => (
              <li key={index}>
                <Card className="grid gap-1">
                  <p className="text-sm">
                    <span className="font-mono text-xs text-primary">{e.label}</span> {e.question_text}
                  </p>
                  <p className="whitespace-pre-wrap">{e.text}</p>
                  <p className="text-sm text-muted-foreground">{t(e.state === "accepted" ? "clientAccount.accepted" : "clientAccount.waiting")}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>,
  );
}

function QuestionCard({
  question,
  base,
  onSent,
  onCheck,
}: {
  question: ClientAccountQuestion;
  base: string;
  onSent: (answer: OwnAnswer) => void;
  /** Read the list again without clearing the page; says what the server answered. */
  onCheck: () => Promise<"ok" | "gone" | "failed">;
}) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [closed, setClosed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError(null);
    setFieldError(null);
    setThanks(false);
    if (!text.trim()) {
      setFieldError(t("client.textRequired"));
      form.current?.querySelector("textarea")?.focus();
      return;
    }
    setSending(true);
    try {
      const response = await apiFetch(`${base}${question.number}/answers/`, { method: "POST", body: { text } });
      if (response.status === 201) {
        onSent((await response.json()) as OwnAnswer);
        setText("");
        setThanks(true);
      } else if (response.status === 404) setClosed(true);
      else if (response.status === 429) setError(t("client.tooMany"));
      else if (response.status === 400) {
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          // not JSON: the general message below
        }
        const errors = fieldErrors(body);
        setFieldError(errors.text ?? null);
        setError(errors.text ? null : (errors.form ?? t("client.failed")));
      } else setError(t("client.failed"));
    } catch {
      setError(t("client.failed"));
    } finally {
      setSending(false);
    }
  }

  async function checkAgain() {
    setChecking(true);
    setCheckFailed(false);
    const result = await onCheck();
    setChecking(false);
    if (result === "ok") setClosed(false); // still listed, so it takes answers again (if it is gone, this card is gone)
    else if (result === "failed") setCheckFailed(true);
  }

  return (
    <Card className="grid gap-3">
      <div className="grid gap-1">
        <p className="font-mono text-xs text-primary">{question.label}</p>
        <h2 className="text-lg font-semibold">{question.text}</h2>
        {question.why_it_matters && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{t("client.why")}:</span> {question.why_it_matters}
          </p>
        )}
        {question.blocks && (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{t("client.blocks")}:</span> {question.blocks}
          </p>
        )}
      </div>

      {question.mine.length > 0 && (
        <ul className="m-0 grid list-none gap-2 p-0">
          {question.mine.map((a, index) => (
            <li key={index} className="grid gap-1 border-l-4 border-saffron bg-muted p-3">
              <p className="whitespace-pre-wrap">{a.text}</p>
              <p className="text-sm text-muted-foreground">{t(a.state === "accepted" ? "clientAccount.accepted" : "clientAccount.waiting")}</p>
            </li>
          ))}
        </ul>
      )}

      {closed ? (
        <div className="grid gap-2">
          <Alert tone="error">{t("client.closed")}</Alert>
          {checkFailed && <Alert tone="error">{t("client.loadError")}</Alert>}
          <div>
            <Button variant="secondary" disabled={checking} onClick={() => void checkAgain()}>
              {t("client.checkAgain")}
            </Button>
          </div>
        </div>
      ) : (
        <form ref={form} onSubmit={submit} className="grid gap-2">
          <Field label={t("client.answerLabel", { label: question.label })} error={fieldError}>
            {(props) => (
              <Textarea
                rows={4}
                maxLength={4000}
                readOnly={sending}
                value={text}
                onChange={(e) => setText(e.target.value)}
                {...props}
              />
            )}
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          <div role="status">{thanks && <Alert>{t("client.sent")}</Alert>}</div>
          <div>
            <Button type="submit" aria-disabled={sending} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60">
              {sending ? t("client.sending") : t("client.send")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
