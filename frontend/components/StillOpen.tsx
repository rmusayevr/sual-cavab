"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { ageText, daysOpen, type Question } from "@/lib/projects";

type State = { kind: "loading" } | { kind: "ready"; questions: Question[] } | { kind: "error" };

/**
 * What the project is still waiting on: questions in status open or asked.
 * The age counts from when the question was created; re-opening a question
 * does not reset it. Mount it with key={projectId}: it loads once per mount.
 */
export default function StillOpen({ projectId, now }: { projectId: string; now?: Date }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${projectId}/questions/?status=open,asked`)
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) setState({ kind: "ready", questions: (await response.json()) as Question[] });
        else setState({ kind: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (state.kind === "loading") return <p>Loading questions…</p>;
  if (state.kind === "error") return <p role="alert">Could not load the questions.</p>;

  const reference = now ?? new Date();
  return (
    <section>
      <h2>Still open ({state.questions.length})</h2>
      {state.questions.length === 0 ? (
        <p>Nothing is open. Every question on this project has an answer or was dropped.</p>
      ) : (
        <ul>
          {state.questions.map((q) => (
            <li key={q.id}>
              <strong>{q.label}</strong> {q.text}
              <br />
              <small>
                {q.status === "asked" ? "asked · " : ""}
                {ageText(daysOpen(q.created_at, reference))}
              </small>
              {q.blocks && (
                <>
                  <br />
                  <small>Blocks: {q.blocks}</small>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
