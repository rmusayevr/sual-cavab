"use client";

import { useRef, useState, type FormEvent } from "react";

import { CHANNELS, today, type Channel } from "@/lib/questions";

import type { SubmitResult } from "./QuestionForm";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Input, Select, Textarea } from "./ui/Field";

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
      <div role="alert" id={id(`${name}-error`)} className="text-sm text-primary">
        {errors[name]}
      </div>
    );
  /** Ties an input to its message, so tabbing back to the field announces it. */
  const invalid = (name: string) =>
    errors[name] ? { "aria-invalid": true as const, "aria-describedby": id(`${name}-error`) } : {};
  const label = (name: string, text: string) => (
    <label htmlFor={id(name)} className="text-sm font-medium">
      {text}
    </label>
  );

  // Not the shared Field: the ids come from idPrefix and each message is an alert of its own
  // (the tests depend on it); only the look is shared.
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1">
        {label("text", "Answer")}
        <Textarea
          id={id("text")}
          rows={3}
          value={values.text}
          onChange={(e) => setValues({ ...values, text: e.target.value })}
          {...invalid("text")}
        />
        {error("text")}
      </div>
      <div className="grid gap-1">
        {label("by", "Answered by")}
        <Input
          id={id("by")}
          value={values.answered_by}
          onChange={(e) => setValues({ ...values, answered_by: e.target.value })}
          {...invalid("answered_by")}
        />
        {error("answered_by")}
      </div>
      <div className="grid gap-1">
        {label("on", "Date")}
        <Input
          id={id("on")}
          type="date"
          value={values.answered_on}
          onChange={(e) => setValues({ ...values, answered_on: e.target.value })}
          {...invalid("answered_on")}
        />
        {error("answered_on")}
      </div>
      <div className="grid gap-1">
        {label("channel", "Where")}
        <Select
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
        </Select>
        {error("channel")}
      </div>
      <div className="grid gap-1">
        {label("note", "Note (optional)")}
        <Input
          id={id("note")}
          value={values.channel_note}
          onChange={(e) => setValues({ ...values, channel_note: e.target.value })}
          {...invalid("channel_note")}
        />
        {error("channel_note")}
      </div>
      {errors.form && <Alert tone="error">{errors.form}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save answer"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
