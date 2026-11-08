"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { Member, Project } from "@/lib/projects";

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

  if (state.kind === "loading") return <p>Loading project…</p>;
  if (state.kind === "not-found")
    return (
      <p>
        Project not found. <Link href="/projects">Back to your projects</Link>
      </p>
    );
  if (state.kind === "error") return <p role="alert">Could not load the project.</p>;

  const { project, members } = state;
  return (
    <>
      <h1>{project.name}</h1>
      <p>Client: {project.client_name}</p>
      {project.description && <p>{project.description}</p>}
      <h2>Members</h2>
      <ul>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.name || m.email} · {m.role}
          </li>
        ))}
      </ul>
      <h2>Questions</h2>
      <p>Questions for this project arrive with #6.</p>
    </>
  );
}
