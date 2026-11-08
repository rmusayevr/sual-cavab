"use client";

import { useRef, useState, type FormEvent } from "react";

import { CHANNELS, today, type Channel } from "@/lib/questions";

import type { SubmitResult } from "./QuestionForm";

export type AnswerFields = {
  text: string;
  answered_by: string;
  answered_on: string;
  channel: Channel;
  channel_note: string;
};

type Props = {
  idPrefix: string;
  onSubmit: (answer: AnswerFields) => Promise<SubmitResult>;
  onCancel: () => void;
};

/** Records who answered a question, when, and where. */
export default function AnswerForm({ idPrefix, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState<AnswerFields>({
    text: "",
    answered_by: "",
    answered_on: today(),
    channel: "chat",
    channel_note: "",
  });
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
      setErrors({ form: "Could not reach the server." });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  const id = (name: string) => `${idPrefix}-${name}`;
  const error = (name: string) =>
    errors[name] && (
      <div role="alert" id={id(`${name}-error`)}>
        {errors[name]}
      </div>
    );
  /** Ties an input to its message, so tabbing back to the field announces it. */
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true as const, "aria-describedby": id(`${name}-error`) } : {};

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: "0.5rem" }}>
      <div>
        <label htmlFor={id("text")}>Answer</label>
        <br />
        <textarea
          id={id("text")}
          rows={3}
          style={{ width: "100%" }}
          value={values.text}
          onChange={(e) => setValues({ ...values, text: e.target.value })}
          {...invalid("text")}
        />
        {error("text")}
      </div>
      <div>
        <label htmlFor={id("by")}>Answered by</label>
        <br />
        <input
          id={id("by")}
          value={values.answered_by}
          onChange={(e) => setValues({ ...values, answered_by: e.target.value })}
          {...invalid("answered_by")}
        />
        {error("answered_by")}
      </div>
      <div>
        <label htmlFor={id("on")}>Date</label>
        <br />
        <input
          id={id("on")}
          type="date"
          value={values.answered_on}
          onChange={(e) => setValues({ ...values, answered_on: e.target.value })}
          {...invalid("answered_on")}
        />
        {error("answered_on")}
      </div>
      <div>
        <label htmlFor={id("channel")}>Where</label>
        <br />
        <select
          id={id("channel")}
          value={values.channel}
          onChange={(e) => setValues({ ...values, channel: e.target.value as Channel })}
          {...invalid("channel")}
        >
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {error("channel")}
      </div>
      <div>
        <label htmlFor={id("note")}>Note (optional)</label>
        <br />
        <input
          id={id("note")}
          value={values.channel_note}
          onChange={(e) => setValues({ ...values, channel_note: e.target.value })}
          {...invalid("channel_note")}
        />
        {error("channel_note")}
      </div>
      {errors.form && <p role="alert">{errors.form}</p>}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save answer"}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}
