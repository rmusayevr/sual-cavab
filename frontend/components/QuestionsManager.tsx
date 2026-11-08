"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { QuestionStatus } from "@/lib/projects";
import { TRANSITIONS, fieldErrors, transitionLabel, type Answer, type FullQuestion } from "@/lib/questions";

import AnswerForm, { type AnswerFields } from "./AnswerForm";
import QuestionForm, { type QuestionFields, type SubmitResult } from "./QuestionForm";

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

  if (state.kind === "loading") return <p>Loading questions…</p>;
  if (state.kind === "not-found")
    return (
      <p>
        Project not found. <Link href="/projects">Back to your projects</Link>
      </p>
    );
  if (state.kind === "error") return <p role="alert">Could not load the questions.</p>;

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
    return await failure(response, "Could not add the question.");
  }

  return (
    <>
      {state.questions.length === 0 ? (
        <p>No questions yet. Add the first one below.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "1rem" }}>
          {state.questions.map((q) => (
            <QuestionItem key={q.id} question={q} base={base} onChanged={replace} />
          ))}
        </ul>
      )}
      <h2>Add a question</h2>
      <QuestionForm idPrefix="add" submitLabel="Add question" busyLabel="Adding…" clearOnSuccess onSubmit={add} />
    </>
  );
}

/** The messages in a refused response, keyed by field; a fallback if there are none. */
async function failure(response: Response, fallback: string): Promise<Record<string, string>> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // not JSON (a proxy error page): fall through to the fallback
  }
  const errors = fieldErrors(body);
  return Object.keys(errors).length > 0 ? errors : { form: fallback };
}

type Mode = "view" | "edit" | "answer";

function QuestionItem({
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
      return null;
    }
    return await failure(response, "Could not change the status.");
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
    const response = await apiFetch(url, { method: "PATCH", body: values });
    if (response.ok) {
      onChanged((await response.json()) as FullQuestion);
      setMode("view");
      return null;
    }
    return await failure(response, "Could not save the question.");
  }

  const id = `q${question.id}`;
  return (
    <li data-testid="question" style={{ border: "1px solid #8884", padding: "0.75rem", borderRadius: "0.25rem" }}>
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
          <strong>{question.label}</strong> <span>{question.text}</span>
          <br />
          <small>{question.status}</small>
          {question.why_it_matters && (
            <>
              <br />
              <small>Why it matters: {question.why_it_matters}</small>
            </>
          )}
          {question.blocks && (
            <>
              <br />
              <small>Blocks: {question.blocks}</small>
            </>
          )}
          {question.current_answer && <AnswerView answer={question.current_answer} heading="Answer" />}
          {question.previous_answers.map((a) => (
            <AnswerView key={a.id} answer={a} heading="Earlier answer" />
          ))}
        </>
      )}

      {mode === "answer" && (
        <div style={{ marginTop: "0.5rem" }}>
          <AnswerForm
            idPrefix={`${id}-answer`}
            onSubmit={(answer) => transition("answered", answer)}
            onCancel={() => setMode("view")}
          />
        </div>
      )}

      {mode === "view" && (
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          {TRANSITIONS[question.status].map((to) => (
            <button
              key={to}
              type="button"
              disabled={busy}
              onClick={() => (to === "answered" ? setMode("answer") : void move(to))}
            >
              {transitionLabel(question.status, to)}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => setMode("edit")}>
            Edit
          </button>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </li>
  );
}

function AnswerView({ answer, heading }: { answer: Answer; heading: string }) {
  return (
    <p style={{ margin: "0.5rem 0 0" }}>
      <em>{heading}:</em> {answer.text}
      <br />
      <small>
        by {answer.answered_by} · {answer.channel}
        {answer.channel_note ? ` (${answer.channel_note})` : ""} · {answer.answered_on}
      </small>
    </p>
  );
}
