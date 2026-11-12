"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useT, type Key } from "@/lib/i18n";
import { addProjects, hasMoreProjects, type Project, type ProjectPage } from "@/lib/projects";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Input } from "./ui/Field";
import { SignInPrompt } from "./ui/SignInPrompt";
import { EmptyState, Eyebrow, LedgerLoading } from "./ui/Ledger";

type State =
  | { kind: "loading" }
  | { kind: "ready"; projects: Project[]; total: number; page: number; pageSize: number; more: "idle" | "loading" | "error" }
  | { kind: "signed-out" }
  | { kind: "error" };

export default function ProjectList() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/projects/")
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) {
          const body = (await response.json()) as ProjectPage;
          setState({ kind: "ready", projects: body.results, total: body.count, page: body.page, pageSize: body.page_size, more: "idle" });
        }
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

  if (state.kind === "loading") return <LedgerLoading label={t("projects.loading")} />;
  if (state.kind === "signed-out")
    return (
      <EmptyState strip={false}>
        <SignInPrompt line="projects.signInLine" />
      </EmptyState>
    );
  if (state.kind === "error") return <Alert tone="error">{t("projects.loadError")}</Alert>;

  const added = (project: Project) =>
    setState((s) => (s.kind === "ready" ? { ...s, projects: addProjects(s.projects, [project]), total: s.total + 1 } : s));

  async function showMore() {
    if (state.kind !== "ready" || state.more === "loading") return;
    const next = state.page + 1;
    setState({ ...state, more: "loading" });
    try {
      const response = await apiFetch(`/api/projects/?page=${next}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as ProjectPage;
      setState((s) =>
        s.kind === "ready"
          ? { ...s, projects: addProjects(s.projects, body.results), total: body.count, page: body.page, pageSize: body.page_size, more: "idle" }
          : s,
      );
    } catch {
      setState((s) => (s.kind === "ready" ? { ...s, more: "error" } : s));
    }
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_22rem] lg:items-start">
      {state.projects.length === 0 ? (
        <EmptyState strip={false}>
          <p>{t("projects.empty")}</p>
        </EmptyState>
      ) : (
        <div className="grid min-w-0 gap-4">
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
                    {p.my_role === "owner" ? ` ${t("projects.owner")}` : ""} · {t("projects.stillOpen", { n: p.open_question_count })}
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
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground" role="status">
            {t("projects.shown", { n: state.projects.length, total: state.total })}
          </p>
          {hasMoreProjects({ count: state.total, page: state.page, page_size: state.pageSize }) && (
            <Button variant="secondary" onClick={showMore} disabled={state.more === "loading"}>
              {state.more === "loading" ? t("projects.showingMore") : t("projects.showMore")}
            </Button>
          )}
        </div>
        {state.more === "error" && <Alert tone="error">{t("projects.moreError")}</Alert>}
        </div>
      )}
      <NewProjectForm onCreated={added} />
    </div>
  );
}

function NewProjectForm({ onCreated }: { onCreated: (p: Project) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [error, setError] = useState<Key | null>(null);
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
        setError("projects.createFailed");
      }
    } catch {
      setError("error.server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-t-4 border-t-saffron bg-card text-card-foreground shadow-card">
      <form onSubmit={onSubmit} className="grid gap-4 p-5">
        <div className="grid gap-1">
          <Eyebrow>{t("projects.newEyebrow")}</Eyebrow>
          <h2 className="text-xl font-semibold">{t("projects.newTitle")}</h2>
        </div>
        <Field label={t("projects.name")}>
          {(props) => <Input required value={name} onChange={(e) => setName(e.target.value)} {...props} />}
        </Field>
        <Field label={t("projects.client")}>
          {(props) => <Input required value={clientName} onChange={(e) => setClientName(e.target.value)} {...props} />}
        </Field>
        {error && <Alert tone="error">{t(error)}</Alert>}
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? t("projects.creating") : t("projects.create")}
        </Button>
      </form>
    </section>
  );
}
