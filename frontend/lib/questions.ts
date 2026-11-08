import type { Question, QuestionStatus } from "./projects";

export type Channel = "chat" | "meeting" | "email" | "other";

export const CHANNELS: { value: Channel; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
  { value: "other", label: "Other" },
];

export type Answer = {
  id: number;
  text: string;
  answered_by: string;
  answered_on: string;
  channel: Channel;
  channel_note: string;
  recorded_by: string;
  recorded_at: string;
  superseded_at: string | null;
};

/** A question as the questions API returns it. */
export type FullQuestion = Question & {
  current_answer: Answer | null;
  previous_answers: Answer[];
};

/**
 * Which statuses a question can move to. A copy of TRANSITIONS in
 * backend/questions/services.py, only to decide which buttons to offer: the
 * server decides, and its refusal is shown if the two ever differ.
 */
export const TRANSITIONS: Record<QuestionStatus, QuestionStatus[]> = {
  open: ["asked", "answered", "dropped"],
  asked: ["open", "answered", "dropped"],
  answered: ["open"],
  dropped: ["open"],
};

/** The words on the button for moving `from` -> `to`. */
export function transitionLabel(from: QuestionStatus, to: QuestionStatus): string {
  if (to === "asked") return "Mark asked";
  if (to === "answered") return "Record answer";
  if (to === "dropped") return "Drop";
  if (from === "asked") return "Un-ask";
  if (from === "answered") return "Re-open";
  return "Restore";
}

/** Today's date as the user's calendar shows it, YYYY-MM-DD. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Flattens a DRF error body ({field: ["msg"], answer: {text: ["msg"]}}) into
 * {field: "msg"}, so each message can sit next to its input. Anything that is
 * not a field error comes back under "form".
 */
export function fieldErrors(body: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (value: unknown, key: string) => {
    if (Array.isArray(value)) {
      const text = value.filter((v) => typeof v === "string").join(" ");
      if (text) out[key] = out[key] ? `${out[key]} ${text}` : text;
    } else if (typeof value === "string") {
      out[key] = value;
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, key === "form" || key === "answer" ? k : `${key}.${k}`);
    }
  };
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) {
      if (k === "allowed") continue;
      walk(v, k === "detail" || k === "non_field_errors" ? "form" : k);
    }
  }
  return out;
}
