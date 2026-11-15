"use client";

import { useRef, useState, type FormEvent } from "react";

import { useT } from "@/lib/i18n";

import type { SubmitResult } from "./QuestionForm";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Field";

/** What a person types to answer a question (#121): the text. Who answered, when and where are the server's. */
export type AnswerFields = {
  text: string;
};

type Props = {
  idPrefix: string;
  onSubmit: (answer: AnswerFields) => Promise<SubmitResult>;
  onCancel: () => void;
  /** False when the question can no longer be answered: the text stays, the save button goes. */
  canSave?: boolean;
};

/** Answers a question: one box for the text, saved as given by the signed-in person, today, in the app. */
export default function AnswerForm({ idPrefix, onSubmit, onCancel, canSave = true }: Props) {
  const t = useT();
  const [values, setValues] = useState<AnswerFields>({ text: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setErrors({});
    try {
      const result = await onSubmit(values);
      if (result) setErrors(result);
    } catch {
      setErrors({ form: t("error.server") });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const textId = `${idPrefix}-text`;
  // Not the shared Field: the ids come from idPrefix and the message is an alert of its own (the tests depend on it);
  // only the look is shared.
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1">
        <label htmlFor={textId} className="text-sm font-medium">
          {t("answer.text")}
        </label>
        <Textarea
          id={textId}
          rows={3}
          value={values.text}
          onChange={(e) => setValues({ text: e.target.value })}
          {...(errors.text ? { "aria-invalid": true as const, "aria-describedby": `${textId}-error` } : {})}
        />
        {errors.text && (
          <div role="alert" id={`${textId}-error`} className="text-sm text-primary">
            {errors.text}
          </div>
        )}
      </div>
      {errors.form && <Alert tone="error">{errors.form}</Alert>}
      <div className="flex flex-wrap gap-2">
        {canSave && (
          <Button type="submit" disabled={saving}>
            {saving ? t("question.saving") : t("answer.save")}
          </Button>
        )}
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t("question.cancel")}
        </Button>
      </div>
    </form>
  );
}
