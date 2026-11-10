"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { Question } from "@/lib/projects";
import { MAX_QUESTIONS, useDraft } from "@/lib/useDraft";

import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { EmptyState, LedgerLoading } from "./ui/Ledger";
import { Textarea } from "./ui/Field";

export { MAX_QUESTIONS } from "@/lib/useDraft";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; questions: Question[] }
  | { kind: "not-found" }
  | { kind: "error" };

/**
 * Pick open questions, get a DRAFT message back as text, copy it. The app
 * never sends the message: there is no send button and no integration.
 */
export default function DraftScreen() {
  const { id } = useParams<{ id: string }>();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [picked, setPicked] = useState<number[]>([]);
  const { draft, setDraft, writing, error, copied, setCopied, write, copy, draftIsStale } = useDraft(id, picked);

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

  if (load.kind === "loading") return <LedgerLoading label="Loading questions…" />;
  if (load.kind === "not-found")
    return (
      <EmptyState>
        <p>Project not found.</p>
        <div>
          <Link href="/projects" className={buttonClasses("secondary")}>
            Back to your projects
          </Link>
        </div>
      </EmptyState>
    );
  if (load.kind === "error") return <Alert tone="error">Could not load the questions.</Alert>;

  const toggle = (number: number) =>
    setPicked((current) => (current.includes(number) ? current.filter((n) => n !== number) : [...current, number]));

  return (
    <div className="grid gap-4">
      <div>
        <Link href={`/projects/${id}`} className={buttonClasses("secondary")}>
          Back to the project
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Draft a message</h1>

      {load.questions.length === 0 ? (
        <EmptyState>
          <p>Nothing is open, so there is nothing to ask. Questions that are open or asked appear here.</p>
        </EmptyState>
      ) : (
        <Card>
          <form onSubmit={write} className="grid gap-4">
            <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
              <legend className="mb-2 text-sm font-medium">Questions to ask (up to {MAX_QUESTIONS})</legend>
              {load.questions.map((q) => {
                const isPicked = picked.includes(q.number);
                return (
                  <label
                    key={q.id}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-background has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:disabled]:hover:bg-transparent"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-5 w-5 shrink-0 accent-primary"
                      checked={isPicked}
                      disabled={!isPicked && picked.length >= MAX_QUESTIONS}
                      onChange={() => toggle(q.number)}
                    />
                    <span className="min-w-0">
                      <span className="font-mono text-xs text-primary">{q.label}</span> {q.text}
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <p className="text-sm text-muted-foreground">
              The text of the selected questions (the question, why it matters and what it blocks) is sent to Claude to
              write the draft. Nothing else about the project or the client is sent. The app never sends the message
              anywhere: you copy it and send it yourself.
            </p>
            <div>
              <Button type="submit" disabled={writing || picked.length === 0}>
                {writing ? "Writing…" : draft !== null ? "Write a new draft (replaces the one below)" : "Write a draft"}
              </Button>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
          </form>
        </Card>
      )}

      {draft !== null && (
        <Card>
          <section className="grid gap-3">
            <label htmlFor="draft-text" className="text-sm font-medium">
              Draft (edit it before you send it)
            </label>
            {draftIsStale && <Alert>The ticked questions have changed since this draft was written.</Alert>}
            <Textarea
              id="draft-text"
              rows={10}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setCopied(null); // "Copied." no longer describes what is in the box
              }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={copy}>
                Copy
              </Button>
              {copied === "yes" && <span role="status">Copied.</span>}
              {copied === "failed" && <span role="status">Could not copy. Select the text and copy it yourself.</span>}
            </div>
            <p className="text-sm text-muted-foreground">
              Nothing has been sent. This draft is not saved: copy it before you leave the page.
            </p>
          </section>
        </Card>
      )}
    </div>
  );
}
