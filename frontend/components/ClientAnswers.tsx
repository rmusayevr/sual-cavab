"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { plainName, shortDate } from "@/lib/answerLink";
import { loadQuestions, sendAnswer, tokenFromHash, type ClientQuestion, type ClientView } from "@/lib/clientLink";
import { LanguageSwitch, useT } from "@/lib/i18n";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Input, Textarea } from "./ui/Field";
import { CarpetStrip, EmptyState, Eyebrow, LedgerLoading } from "./ui/Ledger";

type State =
  | { kind: "reading" } // looking for the token in the address
  | { kind: "loading" }
  | { kind: "ready"; view: ClientView }
  | { kind: "unavailable" }
  | { kind: "throttled" }
  | { kind: "error" };

/**
 * The page a client opens with the private link they were sent (/answer#<token>) (#114). The client has no
 * account: there is no sign-in, no navigation to the rest of the app, and nothing here is sent anywhere except the
 * two routes in lib/clientLink.ts, with no cookies. The token is read from the address bar's fragment and kept in
 * memory only; it is not written to storage.
 *
 * Everything shown comes from the server's allowlisted reply and is put on the page as plain text. What the client
 * types is kept in this page's memory until it is sent; the name is never stored in the browser.
 */
export default function ClientAnswers() {
  const t = useT();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "reading" });
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const load = useCallback(async (value: string) => {
    setState({ kind: "loading" });
    const result = await loadQuestions(value);
    setState(result.kind === "ok" ? { kind: "ready", view: result.view } : { kind: result.kind });
  }, []);

  useEffect(() => {
    // The fragment is not available while rendering on the server, so it is read once the page is in the browser.
    const found = tokenFromHash(window.location.hash);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(found);
    if (found) void load(found);
    else setState({ kind: "unavailable" });
  }, [load]);

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-background [overflow-wrap:anywhere]">
      <header className="bg-navy pattern-lattice text-navy-foreground">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          {/* the product name, not a link: a client has nowhere to go from here */}
          <span className="font-display text-xl font-semibold">
            Sual<span className="text-saffron">·</span>Cavab
          </span>
          <LanguageSwitch />
        </div>
        <CarpetStrip />
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 px-4 py-6 sm:px-6">{body}</main>
    </div>
  );

  if (state.kind === "reading" || state.kind === "loading")
    return shell(<LedgerLoading label={t("client.loading")} />);

  if (state.kind === "unavailable")
    return shell(
      <EmptyState strip={false}>
        <h1 className="text-2xl font-semibold">{t("client.unavailableTitle")}</h1>
        <p>{t("client.unavailableText")}</p>
      </EmptyState>,
    );

  if (state.kind === "throttled" || state.kind === "error")
    return shell(
      <div className="grid gap-3">
        {/* A 429 says nothing about whether the link works, so it is not described as a working or a dead link. */}
        <Alert tone="error">{state.kind === "throttled" ? t("client.throttled") : t("client.loadError")}</Alert>
        <div>
          <Button variant="secondary" onClick={() => token && void load(token)}>
            {t("client.retry")}
          </Button>
        </div>
      </div>,
    );

  const { view } = state;
  return shell(
    <>
      <div className="grid gap-2">
        <Eyebrow>{t("client.eyebrow")}</Eyebrow>
        <h1 className="text-3xl font-semibold">{view.project_name}</h1>
        <p className="text-muted-foreground">{t("client.lead")}</p>
        <p className="text-sm text-muted-foreground">{t("client.expires", { date: shortDate(view.expires_at) })}</p>
        <p className="text-sm text-muted-foreground">{t("client.privacy")}</p>
      </div>

      <Card>
        <Field label={t("client.name")} hint={t("client.nameHint")} error={nameError}>
          {(props) => (
            <Input
              name="name"
              autoComplete="name"
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
              {...props}
            />
          )}
        </Field>
      </Card>

      {view.questions.length === 0 ? (
        <EmptyState strip={false}>
          <p>{t("client.empty")}</p>
        </EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {view.questions.map((q) => (
            <li key={q.number}>
              <QuestionCard
                question={q}
                token={token!}
                name={name}
                onNeedName={() => setNameError(t("client.nameRequired"))}
                onClosed={() => void load(token!)}
              />
            </li>
          ))}
        </ul>
      )}
    </>,
  );
}

function QuestionCard({
  question,
  token,
  name,
  onNeedName,
  onClosed,
}: {
  question: ClientQuestion;
  token: string;
  name: string;
  onNeedName: () => void;
  onClosed: () => void;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(0); // how many answers this page has sent for this question: the client's own note
  const [closed, setClosed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError(null);
    setFieldError(null);
    if (!name.trim()) return onNeedName();
    if (!text.trim()) return setFieldError(t("client.textRequired"));
    setSending(true);
    const result = await sendAnswer(token, question.number, { text, name });
    setSending(false);
    if (result.kind === "sent") {
      setText("");
      setSent((n) => n + 1);
    } else if (result.kind === "closed") setClosed(true);
    else if (result.kind === "tooMany") setError(t("client.tooMany"));
    else if (result.kind === "invalid") {
      setFieldError(result.errors.text ?? null);
      setError(result.errors.name ?? result.errors.form ?? (result.errors.text ? null : t("client.failed")));
    } else setError(t("client.failed"));
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

      {closed ? (
        <div className="grid gap-2">
          <Alert tone="error">{t("client.closed")}</Alert>
          <div>
            <Button variant="secondary" onClick={onClosed}>
              {t("client.checkAgain")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-2" aria-label={`${question.label} · ${plainName(name) || "…"}`}>
          <Field label={t("client.answerLabel", { label: question.label })} error={fieldError}>
            {(props) => (
              <Textarea
                rows={4}
                maxLength={4000}
                disabled={sending}
                value={text}
                onChange={(e) => setText(e.target.value)}
                {...props}
              />
            )}
          </Field>
          {error && <Alert tone="error">{error}</Alert>}
          {sent > 0 && !error && <Alert>{t("client.sent")}</Alert>}
          <div>
            <Button type="submit" disabled={sending}>
              {sending ? t("client.sending") : t("client.send")}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
