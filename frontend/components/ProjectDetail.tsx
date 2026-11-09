"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { Member, Project } from "@/lib/projects";

import StillOpen from "./StillOpen";
import { Alert } from "./ui/Alert";
import { buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";

type State =
  | { kind: "loading" }
  | { kind: "ready"; project: Project; members: Member[] }
  | { kind: "not-found" }
  | { kind: "error" };

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetch(`/api/projects/${id}/`), apiFetch(`/api/projects/${id}/members/`)])
      .then(async ([projectRes, membersRes]) => {
        if (cancelled) return;
        // A project you are not on is a 404, the same as one that does not exist.
        if (projectRes.status === 404 || projectRes.status === 403) return setState({ kind: "not-found" });
        if (!projectRes.ok || !membersRes.ok) return setState({ kind: "error" });
        setState({
          kind: "ready",
          project: (await projectRes.json()) as Project,
          members: (await membersRes.json()) as Member[],
        });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === "loading") return <p className="text-muted-foreground">Loading project…</p>;
  if (state.kind === "not-found")
    return (
      <div className="grid gap-3">
        <p>Project not found.</p>
        <div>
          <Link href="/projects" className={buttonClasses("secondary")}>
            Back to your projects
          </Link>
        </div>
      </div>
    );
  if (state.kind === "error") return <Alert tone="error">Could not load the project.</Alert>;

  const { project, members } = state;
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <p className="text-muted-foreground">Client: {project.client_name}</p>
        {project.description && <p>{project.description}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href={`/projects/${id}/questions`} className={buttonClasses("primary")}>
          Manage questions
        </Link>
        <Link href={`/projects/${id}/draft`} className={buttonClasses("secondary")}>
          Draft a message
        </Link>
      </div>
      <StillOpen key={id} projectId={id} />
      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Members</h2>
        <Card>
          <ul className="grid list-none gap-2">
            {members.map((m) => (
              <li key={m.user_id}>
                {m.name || m.email} · {m.role}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
