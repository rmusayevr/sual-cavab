"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import type { Question } from "@/lib/projects";
import { fieldErrors } from "@/lib/questions";

/** The most questions one draft can cover; the backend refuses more. */
export const MAX_QUESTIONS = 10;

type Load =
  | { kind: "loading" }
  | { kind: "ready"; questions: Question[] }
  | { kind: "not-found" }
  | { kind: "error" };

/** What the person is told when drafting fails, by what the server answered. */
async function explain(response: Response): Promise<string> {
  if (response.status === 503) return "Drafting is not set up on this server.";
  if (response.status === 429) return "You have asked for a lot of drafts. Try again later.";
  if (response.status === 502) return "The draft could not be written. Try again in a minute.";
  if (response.status === 404 || response.status === 403) return "This project is not available.";
  try {
    const messages = Object.values(fieldErrors(await response.json()));
    if (messages.length > 0) return messages.join(" ");
  } catch {
    // not JSON: use the fallback below
  }
  return "Could not write the draft.";
}

/**
 * Pick open questions, get a DRAFT message back as text, copy it. The app
 * never sends the message: there is no send button and no integration.
 */
export default function DraftScreen() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [picked, setPicked] = useState<number[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${id}/questions/?status=open,asked`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) setLoad({ kind: "ready", questions: (await response.json()) as Question[] });
        else if (response.status === 404 || response.status === 403) setLoad({ kind: "not-found" });
        else setLoad({ kind: "error" });
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (load.kind === "loading") return <p>Loading questions…</p>;
  if (load.kind === "not-found")
    return (
      <p>
        Project not found. <Link href="/projects">Back to your projects</Link>
      </p>
    );
  if (load.kind === "error") return <p role="alert">Could not load the questions.</p>;

  const toggle = (number: number) =>
    setPicked((current) => (current.includes(number) ? current.filter((n) => n !== number) : [...current, number]));

  async function write(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || picked.length === 0) return;
    inFlight.current = true;
    setWriting(true);
    setError(null);
    setCopied(null);
    try {
      const response = await apiFetch(`/api/projects/${id}/draft/`, {
        method: "POST",
        body: { questions: [...picked].sort((a, b) => a - b) },
      });
      if (response.ok) setDraft(((await response.json()) as { draft: string }).draft);
      else setError(await explain(response));
    } catch {
      setError("Could not reach the server.");
    } finally {
      inFlight.current = false;
      setWriting(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft ?? "");
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <>
      <p>
        <Link href={`/projects/${id}`}>Back to the project</Link>
      </p>
      <h1>Draft a message</h1>

      {load.questions.length === 0 ? (
        <p>Nothing is open, so there is nothing to ask. Questions that are open or asked appear here.</p>
      ) : (
        <form onSubmit={write} style={{ display: "grid", gap: "0.75rem" }}>
          <fieldset style={{ display: "grid", gap: "0.5rem" }}>
            <legend>Questions to ask (up to {MAX_QUESTIONS})</legend>
            {load.questions.map((q) => {
              const isPicked = picked.includes(q.number);
              return (
                <label key={q.id} style={{ display: "flex", gap: "0.5rem", alignItems: "baseline" }}>
                  <input
                    type="checkbox"
                    checked={isPicked}
                    disabled={!isPicked && picked.length >= MAX_QUESTIONS}
                    onChange={() => toggle(q.number)}
                  />
                  <span>
                    <strong>{q.label}</strong> {q.text}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <p>
            <small>
              The text of the selected questions (the question, why it matters and what it blocks) is sent to Claude
              to write the draft. Nothing else about the project or the client is sent. The app never sends the message
              anywhere: you copy it and send it yourself.
            </small>
          </p>
          <div>
            <button type="submit" disabled={writing || picked.length === 0}>
              {writing ? "Writing…" : "Write a draft"}
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert">{error}</p>}

      {draft !== null && (
        <section style={{ marginTop: "1.5rem", display: "grid", gap: "0.5rem" }}>
          <label htmlFor="draft-text">Draft (edit it before you send it)</label>
          <textarea id="draft-text" rows={10} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button type="button" onClick={copy}>
              Copy
            </button>
            {copied === "yes" && <span role="status">Copied.</span>}
            {copied === "failed" && <span role="status">Could not copy. Select the text and copy it yourself.</span>}
          </div>
          <p>
            <small>Nothing has been sent. This draft is not saved: copy it before you leave the page.</small>
          </p>
        </section>
      )}
    </>
  );
}
