"use client";

import { useRef, useState, type FormEvent } from "react";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Textarea } from "./ui/Field";

export type QuestionFields = { text: string; why_it_matters: string; blocks: string };

/** What a form's submit handler returns: the messages to show, or null on success. */
export type SubmitResult = Record<string, string> | null;

type Props = {
  /** Prefix for the input ids, so several forms can sit on one page. */
  idPrefix: string;
  initial?: QuestionFields;
  submitLabel: string;
  busyLabel: string;
  /** Empty the fields after a successful submit (the add form). */
  clearOnSuccess?: boolean;
  onSubmit: (values: QuestionFields) => Promise<SubmitResult>;
  onCancel?: () => void;
};

const EMPTY: QuestionFields = { text: "", why_it_matters: "", blocks: "" };

/** The three text fields of a question: used to add one and to edit one. */
export default function QuestionForm({
  idPrefix,
  initial = EMPTY,
  submitLabel,
  busyLabel,
  clearOnSuccess = false,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState<QuestionFields>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const set = (field: keyof QuestionFields) => (value: string) => setValues((v) => ({ ...v, [field]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return; // a second click while the first request runs
    inFlight.current = true;
    setSaving(true);
    setErrors({});
    try {
      const result = await onSubmit(values);
      if (result) setErrors(result);
      else if (clearOnSuccess) setValues(EMPTY);
    } catch {
      setErrors({ form: "Could not reach the server." });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  // Not the shared Field: the ids come from idPrefix and each message is an alert of its own
  // (the tests and the order of the messages depend on it); only the look is shared.
  const field = (name: keyof QuestionFields, label: string, rows: number) => (
    <div className="grid gap-1">
      <label htmlFor={`${idPrefix}-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <Textarea
        id={`${idPrefix}-${name}`}
        rows={rows}
        value={values[name]}
        onChange={(e) => set(name)(e.target.value)}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `${idPrefix}-${name}-error` : undefined}
      />
      {errors[name] && (
        <div role="alert" id={`${idPrefix}-${name}-error`} className="text-sm text-primary">
          {errors[name]}
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-4">
      {field("text", "Question", 3)}
      {field("why_it_matters", "Why it matters", 2)}
      {field("blocks", "What it blocks", 1)}
      {errors.form && <Alert tone="error">{errors.form}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? busyLabel : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
