import { en, type Key } from "./i18n/en";
import type { Question, QuestionStatus } from "./projects";

export type Channel = "chat" | "meeting" | "email" | "other";

export const CHANNELS: { value: Channel; label: string }[] = [
  { value: "chat", label: en["channel.chat"] },
  { value: "meeting", label: en["channel.meeting"] },
  { value: "email", label: en["channel.email"] },
  { value: "other", label: en["channel.other"] },
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

const pad = (n: number | string) => String(n).padStart(2, "0");

/** The date on the browser's own calendar, YYYY-MM-DD. */
function browserDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The date in Asia/Baku, YYYY-MM-DD, built from the parts so it does not depend on how a locale
 * writes a date. Keep the zone equal to settings.TIME_ZONE in backend/config/settings.py: the server
 * refuses an answer date after its today.
 */
function bakuDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`;
}

/**
 * The default date of an answer (#48): the EARLIER of the browser's date and Baku's, YYYY-MM-DD.
 * The server refuses a date after today in Baku, so a browser ahead of Baku just after its own
 * midnight must not offer its own date; a browser behind Baku (the Americas) must not be handed a
 * date in its own future. Where the two calendars agree, as in Baku, it is just today. Dates of the
 * form YYYY-MM-DD compare correctly as text. `local` is a parameter so tests do not depend on the
 * machine's time zone.
 */
export function today(now: Date = new Date(), local: string = browserDate(now)): string {
  const baku = bakuDate(now);
  return local < baku ? local : baku;
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
