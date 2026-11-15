import { en, type Key } from "./i18n/en";
import type { Question, QuestionStatus } from "./projects";

/** Where an answer came from. The server sets it, and nobody picks it any more (#121): "app" for an answer typed
 * in the app, "link" for one a member accepted from a client's answer link (#114), "client" for one accepted from a client account (#121). The other three are on answers
 * recorded before #121, when a person said where an answer came from. */
export type Channel = "app" | "link" | "client" | "chat" | "meeting" | "email" | "other";

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
export function transitionKey(from: QuestionStatus, to: QuestionStatus): Key {
  if (to === "asked") return "transition.markAsked";
  if (to === "answered") return "transition.recordAnswer";
  if (to === "dropped") return "transition.drop";
  if (from === "asked") return "transition.unask";
  if (from === "answered") return "transition.reopen";
  return "transition.restore";
}

/** The same words in English (the screens use `t(transitionKey(...))` for the chosen language). */
export function transitionLabel(from: QuestionStatus, to: QuestionStatus): string {
  return en[transitionKey(from, to)];
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
