/**
 * What the page a client opens (/answer#<token>) says to the server (#114). Two routes, nothing else.
 *
 * It does not use apiFetch: that sends the session cookie and asks /api/auth/csrf/ for a token before a write, and a
 * client has no session and must not be given one. Here every request is sent with credentials omitted, never cached
 * and without a Referer, and the token goes in one header and nowhere else (never in the address of the request).
 */
import { fieldErrors } from "./questions";

export type ClientQuestion = {
  number: number;
  label: string;
  text: string;
  why_it_matters: string;
  blocks: string;
};

export type ClientView = {
  project_name: string;
  expires_at: string;
  questions: ClientQuestion[];
};

/** The token is 43 characters of this alphabet (backend/answerlinks/services.py); anything else cannot be one. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The token in a URL fragment ("#abc…"), or null if there is none or it cannot be a token. */
export function tokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, "");
  return TOKEN.test(token) ? token : null;
}

/**
 * A moment as the person reading it sees it: "2026-11-29 13:00" in their own time zone (or `timeZone`, for tests).
 * The date part of the server's UTC time can be a day off for a client who is not on UTC.
 */
export function localStamp(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export function isClientView(value: unknown): value is ClientView {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<ClientView>;
  return (
    typeof v.project_name === "string" &&
    typeof v.expires_at === "string" &&
    Array.isArray(v.questions) &&
    v.questions.every((q) => q && typeof q.number === "number" && typeof q.label === "string" && typeof q.text === "string")
  );
}

export type LoadResult =
  | { kind: "ok"; view: ClientView }
  | { kind: "unavailable" } // 404: expired, revoked, never existed (the server does not say which)
  | { kind: "throttled" } // 429: says nothing about whether the link works
  | { kind: "error" };

export type SendResult =
  | { kind: "sent" }
  | { kind: "closed" } // 404: the question was answered or dropped meanwhile, or the link stopped
  | { kind: "tooMany" } // 429: a limit or a cap
  | { kind: "invalid"; errors: Record<string, string> } // 400: the server's reasons, by field
  | { kind: "error" };

function request(path: string, token: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Answer-Token": token };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(path, {
    method: init.method ?? "GET",
    headers,
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function loadQuestions(token: string): Promise<LoadResult> {
  try {
    const response = await request("/api/answer-link/questions/", token);
    if (response.status === 404) return { kind: "unavailable" };
    if (response.status === 429) return { kind: "throttled" };
    if (!response.ok) return { kind: "error" };
    const body: unknown = await response.json();
    return isClientView(body) ? { kind: "ok", view: body } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

export async function sendAnswer(token: string, number: number, answer: { text: string; name: string }): Promise<SendResult> {
  try {
    const response = await request(`/api/answer-link/questions/${number}/answers/`, token, { method: "POST", body: answer });
    if (response.status === 201) return { kind: "sent" };
    if (response.status === 404) return { kind: "closed" };
    if (response.status === 429) return { kind: "tooMany" };
    if (response.status === 400) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // not JSON: fall through to a plain error
      }
      const errors = fieldErrors(body);
      return Object.keys(errors).length > 0 ? { kind: "invalid", errors } : { kind: "error" };
    }
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}
