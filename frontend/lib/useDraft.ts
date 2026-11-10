import { useRef, useState } from "react";

import { apiFetch } from "./api";
import { useT, type Key } from "./i18n";
import { fieldErrors } from "./questions";

/** The most questions one draft can cover; the backend refuses more. */
export const MAX_QUESTIONS = 10;

/**
 * What the person is told when drafting fails, by what the server answered: a dictionary key for our
 * own words (so they follow the language), or the server's own text for a validation message.
 */
export type DraftError = { key: Key } | { text: string };

export async function explain(response: Response): Promise<DraftError> {
  if (response.status === 503) return { key: "draft.err.noSetup" };
  if (response.status === 429) return { key: "draft.err.rateLimited" };
  if (response.status === 502) return { key: "draft.err.badGateway" };
  if (response.status === 404) return { key: "draft.err.notAvailable" };
  // SessionAuthentication answers 403 for a signed-out session or a failed CSRF check too.
  if (response.status === 403) return { key: "draft.err.signedOut" };
  try {
    const messages = Object.values(fieldErrors(await response.json()));
    if (messages.length > 0) return { text: messages.join(" ") };
  } catch {
    // not JSON: use the fallback below
  }
  return { key: "draft.err.failed" };
}

/**
 * Writing a DRAFT message for the picked questions, editing it, copying it. The app never sends the
 * message: there is no send button and no integration. Used by the workspace.
 */
export function useDraft(projectId: string, picked: number[]) {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState<number[]>([]); // the questions the current draft was written for
  const [writing, setWriting] = useState(false);
  const t = useT();
  const [failure, setFailure] = useState<DraftError | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const inFlight = useRef(false);

  async function write() {
    if (inFlight.current || picked.length === 0) return;
    inFlight.current = true;
    setWriting(true);
    setFailure(null);
    setCopied(null);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/draft/`, {
        method: "POST",
        body: { questions: [...picked].sort((a, b) => a - b) },
      });
      if (response.ok) {
        setDraft(((await response.json()) as { draft: string }).draft);
        setDraftFor([...picked].sort((a, b) => a - b));
      } else setFailure(await explain(response));
    } catch {
      setFailure({ key: "error.server" });
    } finally {
      inFlight.current = false;
      setWriting(false);
    }
  }

  const sortedPicked = [...picked].sort((a, b) => a - b);
  const draftIsStale = draft !== null && draftFor.join(",") !== sortedPicked.join(",");

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft ?? "");
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  // worked out when shown, so a message already on screen follows a change of language
  const error = failure === null ? null : "key" in failure ? t(failure.key) : failure.text;

  return { draft, setDraft, writing, error, copied, setCopied, write, copy, draftIsStale };
}
