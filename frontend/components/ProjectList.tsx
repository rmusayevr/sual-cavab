"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import type { Project } from "@/lib/projects";

type State =
  | { kind: "loading" }
  | { kind: "ready"; projects: Project[] }
  | { kind: "signed-out" }
  | { kind: "error" };

export default function ProjectList() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/projects/")
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) setState({ kind: "ready", projects: (await response.json()) as Project[] });
        else if (response.status === 401 || response.status === 403) setState({ kind: "signed-out" });
        else setState({ kind: "error" });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <p>Loading projects…</p>;
  if (state.kind === "signed-out")
    return (
      <p>
        <Link href="/login">Sign in</Link> to see your projects.
      </p>
    );
  if (state.kind === "error") return <p role="alert">Could not load projects.</p>;

  const added = (project: Project) =>
    setState((s) => (s.kind === "ready" ? { kind: "ready", projects: [...s.projects, project] } : s));

  return (
    <>
      {state.projects.length === 0 ? (
        <p>You are not on any project yet. Create one below, or ask an owner to add you.</p>
      ) : (
        <ul>
          {state.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`}>{p.name}</Link> · {p.client_name}
              {p.my_role === "owner" ? " (owner)" : ""} · {p.open_question_count} still open
            </li>
          ))}
        </ul>
      )}
      <NewProjectForm onCreated={added} />
    </>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (p: Project) => void }) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/projects/", { method: "POST", body: { name, client_name: clientName } });
      if (response.status === 201) {
        onCreated((await response.json()) as Project);
        setName("");
        setClientName("");
      } else {
        setError("Could not create the project. Check the fields and try again.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "0.5rem", maxWidth: "24rem", marginTop: "1.5rem" }}>
      <h2>New project</h2>
      <label>
        Project name
        <input required value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Client
        <input required value={clientName} onChange={(e) => setClientName(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={saving}>
        {saving ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}
