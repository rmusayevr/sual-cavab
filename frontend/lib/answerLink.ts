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
  /** A name the client typed. Never verified. */
  submitter_name: string;
  submitted_at: string;
  state: SubmissionState;
  decided_by: string | null;
  decided_at: string | null;
};

/** A copy of the limits in backend/answerlinks/services.py, only to bound the form: the server decides. */
export const MIN_DAYS = 1;
export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 14;

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
