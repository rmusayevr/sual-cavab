/** The answer link and what clients sent through it (#114), as the API at /api/projects/<id>/answer-link/ and
 * /submissions/ returns them. The server decides everything here; these are only the shapes. */

export type LinkState = "active" | "expired" | "revoked" | "creator_inactive";

export type AnswerLinkInfo =
  | { exists: false }
  | {
      exists: true;
      state: LinkState;
      created_by: string;
      created_at: string;
      expires_at: string;
      revoked_at: string | null;
      /** Only in the reply to making a link, and only once: it is not kept anywhere. */
      token?: string;
    };

export type SubmissionState = "pending" | "accepted" | "dismissed";

export type Submission = {
  id: number;
  question_number: number;
  question_label: string;
  question_text: string;
  /** What the client typed. Plain text: never put it in markup. */
  text: string;
  /** From a link, a name the client typed (never verified); from a client account, the account's own name. */
  submitter_name: string;
  /** "account": a client account sent it. "link": someone with the private link did. */
  source: "account" | "link";
  submitted_at: string;
  state: SubmissionState;
  decided_by: string | null;
  decided_at: string | null;
};

/** A copy of the limits in backend/answerlinks/services.py, only to bound the form: the server decides. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 14;

/** How long the link stays on screen after it is made. It is a credential that needs no account; a screen that
 * someone walked away from must not keep showing it. */
export const LINK_VISIBLE_MS = 5 * 60 * 1000;

/** Unicode direction controls (embeddings, overrides, isolates, marks). A name typed by an anonymous person can
 * carry one, and an unclosed right-to-left override reverses the words that follow it in the same line. */
const DIRECTION_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** A name typed by an anonymous client, made safe to put inside a sentence. */
export function plainName(name: string): string {
  return name.replace(DIRECTION_CONTROLS, "");
}

/** The link the client opens. The token goes after "#": a browser never sends that part to a server, so it
 * stays out of server logs and out of Referer (the design on #114). */
export function answerUrl(origin: string, token: string): string {
  return `${origin}/answer#${token}`;
}

/** The date part of an ISO timestamp (UTC), for a line of text. */
export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function isSubmissionList(value: unknown): value is Submission[] {
  return Array.isArray(value) && value.every((v) => v && typeof v === "object" && typeof (v as Submission).id === "number");
}

export function isLinkInfo(value: unknown): value is AnswerLinkInfo {
  if (!value || typeof value !== "object") return false;
  const v = value as { exists?: unknown; state?: unknown };
  return v.exists === false || (v.exists === true && typeof v.state === "string");
}
