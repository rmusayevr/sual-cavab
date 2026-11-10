"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { QuestionStatus } from "@/lib/projects";
import { TRANSITIONS, fieldErrors, transitionLabel, type Answer, type FullQuestion } from "@/lib/questions";

import AnswerForm, { type AnswerFields } from "./AnswerForm";
import QuestionForm, { type QuestionFields, type SubmitResult } from "./QuestionForm";
import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState, LedgerLoading } from "./ui/Ledger";
import { StatusChip } from "./ui/StatusChip";

type State =
  | { kind: "loading" }
  | { kind: "ready"; questions: FullQuestion[] }
  | { kind: "not-found" }
  | { kind: "error" };

/** Every question of a project: add, edit, change status, record an answer. */
export default function QuestionsManager({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const base = `/api/projects/${projectId}/questions/`;

  useEffect(() => {
    let cancelled = false;
    apiFetch(base)
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) setState({ kind: "ready", questions: (await response.json()) as FullQuestion[] });
        else if (response.status === 404 || response.status === 403) setState({ kind: "not-found" });
        else setState({ kind: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [base]);

  if (state.kind === "loading") return <LedgerLoading label="Loading questions…" />;
  if (state.kind === "not-found")
    return (
      <EmptyState>
        <p>Project not found.</p>
        <div>
          <Link href="/projects" className={buttonClasses("secondary")}>
            Back to your projects
          </Link>
        </div>
      </EmptyState>
    );
  if (state.kind === "error") return <Alert tone="error">Could not load the questions.</Alert>;

  const replace = (updated: FullQuestion) =>
    setState((s) =>
      s.kind === "ready" ? { kind: "ready", questions: s.questions.map((q) => (q.id === updated.id ? updated : q)) } : s,
    );
  const append = (created: FullQuestion) =>
    setState((s) => (s.kind === "ready" ? { kind: "ready", questions: [...s.questions, created] } : s));

  async function add(values: QuestionFields): Promise<SubmitResult> {
    const response = await apiFetch(base, { method: "POST", body: values });
    if (response.status === 201) {
      append((await response.json()) as FullQuestion);
      return null;
    }
    return await failure(response, "Could not add the question.", [...QUESTION_FIELDS]);
  }

  return (
    <div className="grid gap-6">
      {state.questions.length === 0 ? (
        <EmptyState>
          <p>No questions yet. Add the first one below.</p>
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-4">
          {state.questions.map((q) => (
            <QuestionItem key={q.id} question={q} base={base} onChanged={replace} />
          ))}
        </ul>
      )}
      <Card className="grid gap-4">
        <h2 className="text-lg font-semibold">Add a question</h2>
        <QuestionForm idPrefix="add" submitLabel="Add question" busyLabel="Adding…" clearOnSuccess onSubmit={add} />
      </Card>
    </div>
  );
}

/**
 * The messages in a refused response, keyed by the fields the form shows. A
 * message about anything else (a gateway body, a field this form has no input
 * for) goes under "form" instead of being dropped; "to" is kept so the caller
 * can spot a refused move. A fallback if there is nothing readable.
 */
export async function failure(response: Response, fallback: string, shown: string[]): Promise<Record<string, string>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON (a proxy error page): fall through to the fallback
  }
  const errors: Record<string, string> = {};
  const extra: string[] = [];
  for (const [key, message] of Object.entries(fieldErrors(body))) {
    if (shown.includes(key) || key === "form" || key === "to") errors[key] = message;
    else extra.push(message);
  }
  if (extra.length > 0) errors.form = [errors.form, ...extra].filter(Boolean).join(" ");
  return Object.keys(errors).length > 0 ? errors : { form: fallback };
}

export const QUESTION_FIELDS = ["text", "why_it_matters", "blocks"] as const;
const ANSWER_FIELDS = ["text", "answered_by", "answered_on", "channel", "channel_note"];

type Mode = "view" | "edit" | "answer";

export function QuestionItem({
  question,
  base,
  onChanged,
}: {
  question: FullQuestion;
  base: string;
  onChanged: (q: FullQuestion) => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = `${base}${question.number}/`;

  async function transition(to: QuestionStatus, answer?: AnswerFields): Promise<SubmitResult> {
    const response = await apiFetch(`${url}transition/`, { method: "POST", body: answer ? { to, answer } : { to } });
    if (response.ok) {
      onChanged((await response.json()) as FullQuestion);
      setMode("view");
      setMessage(null);
      return null;
    }
    const errors = await failure(response, "Could not change the status.", answer ? ANSWER_FIELDS : []);
    if (errors.to) {
      // The server says this move is not allowed, so what is on screen is out
      // of date. Show the question as it is now, with the reason.
      try {
        const fresh = await apiFetch(url);
        if (fresh.ok) onChanged((await fresh.json()) as FullQuestion);
      } catch {
        // Could not reload; the reason below is still the useful message.
      }
      setMode("view");
      setMessage(errors.to);
      return null;
    }
    return errors;
  }

  async function move(to: QuestionStatus) {
    setBusy(true);
    setMessage(null);
    try {
      const errors = await transition(to);
      if (errors) setMessage(Object.values(errors).join(" "));
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function save(values: QuestionFields): Promise<SubmitResult> {
    // Send only the fields this person changed: one they did not touch may have
    // been changed by a teammate since this page loaded, and sending the old
    // value back would undo it (the API writes just the fields it is sent).
    const changed: Partial<QuestionFields> = {};
    for (const field of QUESTION_FIELDS) {
      if (values[field] !== question[field]) changed[field] = values[field];
    }
    if (Object.keys(changed).length === 0) {
      setMode("view");
      return null;
    }
    const response = await apiFetch(url, { method: "PATCH", body: changed });
    if (response.ok) {
      onChanged((await response.json()) as FullQuestion);
      setMode("view");
      setMessage(null);
      return null;
    }
    return await failure(response, "Could not save the question.", [...QUESTION_FIELDS]);
  }

  const id = `q${question.id}`;
  return (
    <li data-testid="question">
      <Card className="grid gap-3">
        {mode === "edit" ? (
          <QuestionForm
            idPrefix={`edit-${question.id}`}
            initial={{ text: question.text, why_it_matters: question.why_it_matters, blocks: question.blocks }}
            submitLabel="Save"
            busyLabel="Saving…"
            onSubmit={save}
            onCancel={() => setMode("view")}
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-primary">{question.label}</span>
              <StatusChip status={question.status} />
            </div>
            <p>{question.text}</p>
            {question.why_it_matters && <p className="text-sm text-muted-foreground">Why it matters: {question.why_it_matters}</p>}
            {question.blocks && <p className="text-sm text-muted-foreground">Blocks: {question.blocks}</p>}
            {question.current_answer && <AnswerView answer={question.current_answer} heading="Answer" />}
            {question.previous_answers.map((a) => (
              <AnswerView key={a.id} answer={a} heading="Earlier answer" />
            ))}
          </>
        )}

        {mode === "answer" && (
          <AnswerForm
            idPrefix={`${id}-answer`}
            onSubmit={(answer) => transition("answered", answer)}
            onCancel={() => setMode("view")}
          />
        )}

        {mode === "view" && (
          <div className="flex flex-wrap gap-2">
            {TRANSITIONS[question.status].map((to) => (
              <Button
                key={to}
                variant={to === "dropped" ? "danger" : "secondary"}
                disabled={busy}
                onClick={() => {
                  if (to !== "answered") return void move(to);
                  setMessage(null);
                  setMode("answer");
                }}
              >
                {transitionLabel(question.status, to)}
              </Button>
            ))}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setMessage(null);
                setMode("edit");
              }}
            >
              Edit
            </Button>
          </div>
        )}
        {message && <Alert tone="error">{message}</Alert>}
      </Card>
    </li>
  );
}

function AnswerView({ answer, heading }: { answer: Answer; heading: string }) {
  return (
    <div className="grid gap-1 border-l-4 border-status-answered bg-muted p-3">
      <p className="text-sm font-medium text-muted-foreground">{heading}</p>
      <p>{answer.text}</p>
      <p className="text-sm text-muted-foreground">
        by {answer.answered_by} · {answer.channel}
        {answer.channel_note ? ` (${answer.channel_note})` : ""} · {answer.answered_on}
      </p>
    </div>
  );
}
