"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import { ageText, daysOpen, type Question } from "@/lib/projects";

import { Alert } from "./ui/Alert";
import { Card } from "./ui/Card";
import { StatusChip } from "./ui/StatusChip";

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

  if (state.kind === "loading") return <p className="text-muted-foreground">Loading questions…</p>;
  if (state.kind === "error") return <Alert tone="error">Could not load the questions.</Alert>;

  const reference = now ?? new Date();
  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">Still open ({state.questions.length})</h2>
      {state.questions.length === 0 ? (
        <p className="text-muted-foreground">Nothing is open. Every question on this project has an answer or was dropped.</p>
      ) : (
        <ul className="grid list-none gap-3">
          {state.questions.map((q) => (
            <li key={q.id}>
              <Card className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{q.label}</span>
                  <StatusChip status={q.status} />
                </div>
                <p>{q.text}</p>
                <p className="text-sm text-muted-foreground">{ageText(daysOpen(q.created_at, reference))}</p>
                {q.blocks && <p className="text-sm text-muted-foreground">Blocks: {q.blocks}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
