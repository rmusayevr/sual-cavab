"use client";

import { useRef, useState, type FormEvent } from "react";

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

  const field = (name: keyof QuestionFields, label: string, rows: number) => (
    <div>
      <label htmlFor={`${idPrefix}-${name}`}>{label}</label>
      <br />
      <textarea
        id={`${idPrefix}-${name}`}
        rows={rows}
        style={{ width: "100%" }}
        value={values[name]}
        onChange={(e) => set(name)(e.target.value)}
        aria-invalid={errors[name] ? true : undefined}
      />
      {errors[name] && <div role="alert">{errors[name]}</div>}
    </div>
  );

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "0.5rem" }}>
      {field("text", "Question", 3)}
      {field("why_it_matters", "Why it matters", 2)}
      {field("blocks", "What it blocks", 1)}
      {errors.form && <p role="alert">{errors.form}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={saving}>
          {saving ? busyLabel : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
