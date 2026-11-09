"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import type { Project } from "@/lib/projects";

import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Input } from "./ui/Field";
import { EmptyState, Eyebrow, LedgerLoading } from "./ui/Ledger";

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

  if (state.kind === "loading") return <LedgerLoading label="Loading projects…" />;
  if (state.kind === "signed-out")
    return (
      <EmptyState strip={false}>
        <p className="flex flex-wrap items-center gap-2">
          <Link href="/login" className={buttonClasses("primary")}>
            Sign in
          </Link>
          <span>to see your projects.</span>
        </p>
      </EmptyState>
    );
  if (state.kind === "error") return <Alert tone="error">Could not load projects.</Alert>;

  const added = (project: Project) =>
    setState((s) => (s.kind === "ready" ? { kind: "ready", projects: [...s.projects, project] } : s));

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
      {state.projects.length === 0 ? (
        <EmptyState strip={false}>
          <p>You are not on any project yet. Create one with the form, or ask an owner to add you.</p>
        </EmptyState>
      ) : (
        <ul className="grid list-none gap-3">
          {state.projects.map((p, index) => (
            <li key={p.id}>
              <Card className="flex items-start gap-4">
                <span className="pt-3 font-mono text-xs text-primary">{String(index + 1).padStart(2, "0")}</span>
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <h2 className="text-xl font-semibold">
                    <Link href={`/projects/${p.id}`} className="inline-flex min-h-11 items-center hover:underline">
                      {p.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {p.client_name}
                    {p.my_role === "owner" ? " (owner)" : ""} · {p.open_question_count} still open
                  </p>
                </div>
                {p.open_question_count > 0 && (
                  <span
                    aria-hidden="true"
                    className="mt-3 rounded-sm bg-saffron px-1.5 font-mono text-[11px] text-accent-foreground"
                  >
                    {p.open_question_count}
                  </span>
                )}
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
    <section className="min-w-0 overflow-hidden rounded-md border border-t-4 border-t-saffron bg-card text-card-foreground shadow-card">
      <form onSubmit={onSubmit} className="grid gap-4 p-5">
        <div className="grid gap-1">
          <Eyebrow>New line</Eyebrow>
          <h2 className="text-xl font-semibold">New project</h2>
        </div>
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
    </section>
  );
}
