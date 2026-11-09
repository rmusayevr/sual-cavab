"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import type { Project } from "@/lib/projects";

import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Input } from "./ui/Field";

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

  if (state.kind === "loading") return <p className="text-muted">Loading projects…</p>;
  if (state.kind === "signed-out")
    return (
      <p className="flex flex-wrap items-center gap-2">
        <Link href="/login" className={buttonClasses("primary")}>
          Sign in
        </Link>
        <span>to see your projects.</span>
      </p>
    );
  if (state.kind === "error") return <Alert tone="error">Could not load projects.</Alert>;

  const added = (project: Project) =>
    setState((s) => (s.kind === "ready" ? { kind: "ready", projects: [...s.projects, project] } : s));

  return (
    <div className="grid gap-6">
      {state.projects.length === 0 ? (
        <p className="text-muted">You are not on any project yet. Create one below, or ask an owner to add you.</p>
      ) : (
        <ul className="grid list-none gap-3">
          {state.projects.map((p) => (
            <li key={p.id}>
              <Card className="grid gap-1">
                <Link href={`/projects/${p.id}`} className="inline-flex min-h-11 items-center text-lg font-semibold text-primary hover:underline">
                  {p.name}
                </Link>
                <p className="text-sm text-muted">
                  {p.client_name}
                  {p.my_role === "owner" ? " (owner)" : ""} · {p.open_question_count} still open
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <NewProjectForm onCreated={added} />
    </div>
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
    <Card className="max-w-sm">
      <form onSubmit={onSubmit} className="grid gap-4">
        <h2 className="text-lg font-semibold">New project</h2>
        <Field label="Project name">
          {(props) => <Input required value={name} onChange={(e) => setName(e.target.value)} {...props} />}
        </Field>
        <Field label="Client">
          {(props) => <Input required value={clientName} onChange={(e) => setClientName(e.target.value)} {...props} />}
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Creating…" : "Create project"}
        </Button>
      </form>
    </Card>
  );
}
