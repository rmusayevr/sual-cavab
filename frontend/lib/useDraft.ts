import { useRef, useState, type FormEvent } from "react";

import { apiFetch } from "./api";
import { fieldErrors } from "./questions";

/** The most questions one draft can cover; the backend refuses more. */
export const MAX_QUESTIONS = 10;

/** What the person is told when drafting fails, by what the server answered. */
export async function explain(response: Response): Promise<string> {
  if (response.status === 503) return "Drafting is not set up on this server.";
  if (response.status === 429) return "You have asked for a lot of drafts. Try again later.";
  if (response.status === 502) return "The draft could not be written. Try again in a minute.";
  if (response.status === 404) return "This project is not available.";
  // SessionAuthentication answers 403 for a signed-out session or a failed CSRF check too.
  if (response.status === 403) return "This project is not available, or you have been signed out. Sign in again.";
  try {
    const messages = Object.values(fieldErrors(await response.json()));
    if (messages.length > 0) return messages.join(" ");
  } catch {
    // not JSON: use the fallback below
  }
  return "Could not write the draft.";
}

/**
 * Writing a DRAFT message for the picked questions, editing it, copying it. The app never sends the
 * message: there is no send button and no integration. Shared by the draft page and the workspace.
 */
export function useDraft(projectId: string, picked: number[]) {
  const [draft, setDraft] = useState<string | null>(null);
  const [draftFor, setDraftFor] = useState<number[]>([]); // the questions the current draft was written for
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const inFlight = useRef(false);

  async function write(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (inFlight.current || picked.length === 0) return;
    inFlight.current = true;
    setWriting(true);
    setError(null);
    setCopied(null);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/draft/`, {
        method: "POST",
        body: { questions: [...picked].sort((a, b) => a - b) },
      });
      if (response.ok) {
        setDraft(((await response.json()) as { draft: string }).draft);
        setDraftFor([...picked].sort((a, b) => a - b));
      } else setError(await explain(response));
    } catch {
      setError("Could not reach the server.");
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

  return { draft, setDraft, writing, error, copied, setCopied, write, copy, draftIsStale };
}
