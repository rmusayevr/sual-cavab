"use client";

import { useState } from "react";

import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { QuestionStatus } from "@/lib/projects";
import { TRANSITIONS, fieldErrors, transitionKey, type Answer, type FullQuestion } from "@/lib/questions";

import AnswerForm, { type AnswerFields } from "./AnswerForm";
import QuestionForm, { type QuestionFields, type SubmitResult } from "./QuestionForm";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { StatusChip } from "./ui/StatusChip";

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

/**
 * One question of the workspace: its text, why it matters, what it blocks and its answers, with the
 * buttons that change its status, the edit form and the answer form. (Until #83 this lived in the
 * old questions page, QuestionsManager.)
 */

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
  const t = useT();
  const [mode, setMode] = useState<Mode>("view");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // A refused answer keeps the form open with what was typed (#36): this says so under the reason.
  const [kept, setKept] = useState(false);
  const url = `${base}${question.number}/`;
  // Whether the question, as last loaded, can still be answered. The server decides; this only
  // decides whether the save button is offered again.
  const canAnswer = TRANSITIONS[question.status].includes("answered");

  async function transition(to: QuestionStatus, answer?: AnswerFields): Promise<SubmitResult> {
    const response = await apiFetch(`${url}transition/`, { method: "POST", body: answer ? { to, answer } : { to } });
    if (response.ok) {
      onChanged((await response.json()) as FullQuestion);
      setMode("view");
      setMessage(null);
      setKept(false);
      return null;
    }
    const errors = await failure(response, t("error.changeStatus"), answer ? ANSWER_FIELDS : []);
    if (errors.to) {
      // The server says this move is not allowed, so what is on screen is out
      // of date. Show the question as it is now, with the reason.
      try {
        const fresh = await apiFetch(url);
        if (fresh.ok) onChanged((await fresh.json()) as FullQuestion);
      } catch {
        // Could not reload; the reason below is still the useful message.
      }
      // A typed answer is not thrown away (#36): the form stays open with its text, so it can be saved
      // again if the question can still be answered, or copied out if it cannot. A move without a form
      // (a status button) has nothing typed to keep, so the card just goes back to showing the question.
      if (answer) setKept(true);
      else setMode("view");
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
      setMessage(t("error.server"));
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
    return await failure(response, t("error.saveQuestion"), [...QUESTION_FIELDS]);
  }

  const id = `q${question.id}`;
  return (
    <li data-testid="question">
      <Card className="grid gap-3">
        {mode === "edit" ? (
          <QuestionForm
            idPrefix={`edit-${question.id}`}
            initial={{ text: question.text, why_it_matters: question.why_it_matters, blocks: question.blocks }}
            submitLabel={t("question.save")}
            busyLabel={t("question.saving")}
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
            {question.why_it_matters && <p className="text-sm text-muted-foreground">{t("question.why", { text: question.why_it_matters })}</p>}
            {question.blocks && <p className="text-sm text-muted-foreground">{t("question.blocks", { text: question.blocks })}</p>}
            {question.current_answer && <AnswerView answer={question.current_answer} heading={t("question.answer")} />}
            {question.previous_answers.map((a) => (
              <AnswerView key={a.id} answer={a} heading={t("question.earlier")} />
            ))}
          </>
        )}

        {mode === "answer" && (
          <>
            {kept && <p className="text-sm text-muted-foreground">{t(canAnswer ? "answer.keptRetry" : "answer.keptCopy")}</p>}
            <AnswerForm
              idPrefix={`${id}-answer`}
              canSave={canAnswer}
              onSubmit={(answer) => transition("answered", answer)}
              onCancel={() => {
                setMode("view");
                setKept(false);
              }}
            />
          </>
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
                  setKept(false);
                  setMode("answer");
                }}
              >
                {t(transitionKey(question.status, to))}
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
              {t("question.edit")}
            </Button>
          </div>
        )}
        {message && <Alert tone="error">{message}</Alert>}
      </Card>
    </li>
  );
}

function AnswerView({ answer, heading }: { answer: Answer; heading: string }) {
  const t = useT();
  return (
    <div className="grid gap-1 border-l-4 border-status-answered bg-muted p-3">
      <p className="text-sm font-medium text-muted-foreground">{heading}</p>
      <p>{answer.text}</p>
      <p className="text-sm text-muted-foreground">
        {t("question.by", { who: answer.answered_by })} · {t(`channel.${answer.channel}`)}
        {answer.channel_note ? ` (${answer.channel_note})` : ""} · {answer.answered_on}
      </p>
    </div>
  );
}
