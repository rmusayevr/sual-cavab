"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";
import { cx } from "@/lib/cx";
import type { Project, QuestionStatus } from "@/lib/projects";
import type { FullQuestion } from "@/lib/questions";
import { STATUSES, statusLabel } from "@/lib/status";
import { MAX_QUESTIONS, useDraft } from "@/lib/useDraft";

import QuestionForm, { type QuestionFields, type SubmitResult } from "./QuestionForm";
import { QUESTION_FIELDS, QuestionItem, failure } from "./QuestionsManager";
import SessionStatus from "./SessionStatus";
import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { Textarea } from "./ui/Field";
import { CarpetStrip, EmptyState, Eyebrow, LedgerLoading } from "./ui/Ledger";
import { StatusChip } from "./ui/StatusChip";

type State =
  | { kind: "loading" }
  | { kind: "ready"; projects: Project[]; questions: FullQuestion[] }
  | { kind: "not-found" }
  | { kind: "error" };

type Filter = "all" | QuestionStatus;

/**
 * One screen for a project: the person's projects (rail), the project's questions with counts and
 * filters (middle), the selected question and the draft (right). The counts and filters are worked
 * out from the questions already loaded. Drafting never sends anything (#70).
 */
export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const draft = useDraft(id, picked);
  const base = `/api/projects/${id}/questions/`;

  useEffect(() => {
    let cancelled = false;
    Promise.all([apiFetch("/api/projects/"), apiFetch(base)])
      .then(async ([projectsRes, questionsRes]) => {
        if (cancelled) return;
        if (questionsRes.status === 404 || questionsRes.status === 403) return setState({ kind: "not-found" });
        if (!projectsRes.ok || !questionsRes.ok) return setState({ kind: "error" });
        const projects = (await projectsRes.json()) as Project[];
        const questions = (await questionsRes.json()) as FullQuestion[];
        // A project you are not on is the same as one that does not exist.
        if (!projects.some((p) => String(p.id) === id)) return setState({ kind: "not-found" });
        setState({ kind: "ready", projects, questions });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, base]);

  const shell = (body: ReactNode) => (
    <div className="min-h-screen bg-background [overflow-wrap:anywhere]">
      <header className="bg-navy pattern-lattice text-navy-foreground">
        <nav className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Link href="/" aria-label="Sual-Cavab, home" className="font-display text-xl font-semibold">
            Sual<span className="text-saffron">·</span>Cavab
          </Link>
          <SessionStatus layout="nav" wakingNote={false} />
        </nav>
        <CarpetStrip />
      </header>
      {body}
    </div>
  );

  if (state.kind === "loading")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <LedgerLoading label="Loading project…" />
      </div>,
    );
  if (state.kind === "not-found")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <EmptyState strip={false}>
          <p>Project not found.</p>
          <div>
            <Link href="/projects" className={buttonClasses("secondary")}>
              Back to your projects
            </Link>
          </div>
        </EmptyState>
      </div>,
    );
  if (state.kind === "error")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <Alert tone="error">Could not load the project.</Alert>
      </div>,
    );

  const { projects, questions } = state;
  const project = projects.find((p) => String(p.id) === id)!;
  const count = (s: QuestionStatus) => questions.filter((q) => q.status === s).length;
  const shown = filter === "all" ? questions : questions.filter((q) => q.status === filter);
  const current = questions.find((q) => q.number === selected) ?? null;

  const replace = (updated: FullQuestion) => {
    setState((s) =>
      s.kind === "ready" ? { ...s, questions: s.questions.map((q) => (q.id === updated.id ? updated : q)) } : s,
    );
    // A question that was answered or dropped can no longer be asked about.
    if (updated.status === "answered" || updated.status === "dropped")
      setPicked((p) => p.filter((n) => n !== updated.number));
  };

  async function add(values: QuestionFields): Promise<SubmitResult> {
    const response = await apiFetch(base, { method: "POST", body: values });
    if (response.status === 201) {
      const created = (await response.json()) as FullQuestion;
      setState((s) => (s.kind === "ready" ? { ...s, questions: [...s.questions, created] } : s));
      return null;
    }
    return await failure(response, "Could not add the question.", [...QUESTION_FIELDS]);
  }

  const toggle = (n: number) => setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  return shell(
    <div className="mx-auto grid max-w-[90rem] grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[15rem_minmax(0,1fr)_24rem]">
      <nav aria-label="Your projects" className="min-w-0 rounded-md bg-navy p-3 text-navy-foreground lg:self-start">
        <Eyebrow tone="navy" className="px-2 pb-2">
          Projects
        </Eyebrow>
        <ul className="grid list-none gap-1">
          {projects.map((p) => {
            const active = String(p.id) === id;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-11 items-center justify-between gap-2 rounded px-2 py-2",
                    active ? "bg-primary text-primary-foreground" : "hover:underline",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{p.name}</span>
                    <span className="block text-xs opacity-80">{p.client_name}</span>
                  </span>
                  {p.open_question_count > 0 && (
                    <span
                      className={cx(
                        "shrink-0 rounded-md px-2 py-0.5 font-mono text-xs",
                        active ? "bg-card text-foreground" : "bg-saffron text-navy",
                      )}
                    >
                      {p.open_question_count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="grid min-w-0 content-start gap-4">
        <div className="grid gap-1">
          <Eyebrow>{project.client_name}</Eyebrow>
          <h1 className="text-3xl font-semibold">{project.name}</h1>
          <p>
            <Link href={`/projects/${id}/overview`} className="text-sm text-muted-foreground underline">
              Members and details
            </Link>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUSES.map((s) => (
            <Card key={s} data-testid={`stat-${s}`} className="grid gap-1 p-3 sm:p-3">
              <span className="text-xs text-muted-foreground">{statusLabel[s]}</span>
              <span className="font-display text-2xl font-semibold">{count(s)}</span>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter questions">
          {(["all", ...STATUSES] as Filter[]).map((f) => (
            <Button
              key={f}
              variant="secondary"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={filter === f ? "border-primary text-primary" : undefined}
            >
              {f === "all" ? "All" : statusLabel[f]}
            </Button>
          ))}
        </div>

        {shown.length === 0 ? (
          <EmptyState strip={false}>
            <p>{questions.length === 0 ? "No questions yet. Add the first one." : "No questions with this status."}</p>
          </EmptyState>
        ) : (
          <ul className="grid list-none gap-2">
            {shown.map((q) => {
              const pickable = q.status === "open" || q.status === "asked";
              const isPicked = picked.includes(q.number);
              return (
                <li key={q.id}>
                  <Card className={cx("flex items-start gap-3 p-3 sm:p-3", selected === q.number && "border-primary")}>
                    <input
                      type="checkbox"
                      aria-label={`Pick ${q.label}`}
                      className="mt-1 h-5 w-5 shrink-0 accent-primary"
                      checked={isPicked}
                      disabled={!pickable || (!isPicked && picked.length >= MAX_QUESTIONS)}
                      onChange={() => toggle(q.number)}
                    />
                    <button
                      type="button"
                      onClick={() => setSelected(q.number)}
                      aria-pressed={selected === q.number}
                      className="m-0 grid min-h-11 min-w-0 flex-1 cursor-pointer gap-1 border-0 bg-transparent p-0 text-left text-inherit [font:inherit]"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-primary">{q.label}</span>
                        <StatusChip status={q.status} />
                      </span>
                      <span>{q.text}</span>
                    </button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <aside className="grid min-w-0 content-start gap-4">
        <section aria-label="Selected question" className="grid gap-3">
          {current ? (
            <ul className="grid list-none">
              <QuestionItem key={current.id} question={current} base={base} onChanged={replace} />
            </ul>
          ) : (
            <Card>
              <p className="text-muted-foreground">
                Select a question to see why it matters, what it blocks and its answer.
              </p>
            </Card>
          )}
        </section>

        <Card className="grid gap-4">
          <h2 className="text-lg font-semibold">Add a question</h2>
          <QuestionForm idPrefix="add" submitLabel="Add question" busyLabel="Adding…" clearOnSuccess onSubmit={add} />
        </Card>

        <section aria-labelledby="draft-heading" className="grid gap-3 rounded-md bg-navy p-4 text-navy-foreground">
          <h2 id="draft-heading" className="text-lg font-semibold">
            Draft a message
          </h2>
          <p className="text-sm opacity-80">
            {picked.length === 0
              ? `Tick up to ${MAX_QUESTIONS} open or asked questions.`
              : `${picked.length} ${picked.length === 1 ? "question" : "questions"} ticked.`}
          </p>
          <p className="text-sm opacity-80">
            The text of the selected questions (the question, why it matters and what it blocks) is sent to Claude to
            write the draft. Nothing else about the project or the client is sent. The app never sends the message
            anywhere: you copy it and send it yourself.
          </p>
          <div>
            <Button onClick={() => draft.write()} disabled={draft.writing || picked.length === 0}>
              {draft.writing
                ? "Writing…"
                : draft.draft !== null
                  ? "Write a new draft (replaces the one below)"
                  : "Write a draft"}
            </Button>
          </div>
          {draft.error && <Alert tone="error">{draft.error}</Alert>}
          {draft.draft !== null && (
            <div className="grid gap-3">
              <label htmlFor="draft-text" className="text-sm font-medium">
                Draft (edit it before you send it)
              </label>
              {draft.draftIsStale && <Alert>The ticked questions have changed since this draft was written.</Alert>}
              <Textarea
                id="draft-text"
                rows={10}
                value={draft.draft}
                onChange={(e) => {
                  draft.setDraft(e.target.value);
                  draft.setCopied(null);
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={draft.copy}>
                  Copy
                </Button>
                {draft.copied === "yes" && <span role="status">Copied.</span>}
                {draft.copied === "failed" && (
                  <span role="status">Could not copy. Select the text and copy it yourself.</span>
                )}
              </div>
              <p className="text-sm opacity-80">
                Nothing has been sent. This draft is not saved: copy it before you leave the page.
              </p>
            </div>
          )}
        </section>
      </aside>
    </div>,
  );
}
