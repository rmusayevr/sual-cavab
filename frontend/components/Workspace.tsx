"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { SIGNED_OUT_EVENT, apiFetch } from "@/lib/api";
import { cx } from "@/lib/cx";
import { ageKey, daysOpen, type Member, type Project, type ProjectPage, type QuestionStatus } from "@/lib/projects";
import type { FullQuestion } from "@/lib/questions";
import { STATUSES } from "@/lib/status";
import { LanguageSwitch, useT } from "@/lib/i18n";
import { useSubmissions } from "@/lib/useSubmissions";

import AnswerLinkPanel from "./AnswerLinkPanel";
import MembersPanel from "./MembersPanel";
import QuestionForm, { type QuestionFields, type SubmitResult } from "./QuestionForm";
import { QUESTION_FIELDS, QuestionItem, failure } from "./QuestionItem";
import SessionStatus from "./SessionStatus";
import SubmissionsPanel from "./SubmissionsPanel";
import WaitingAnswers from "./WaitingAnswers";
import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { CarpetStrip, EmptyState, Eyebrow, LedgerLoading } from "./ui/Ledger";
import { SignInPrompt } from "./ui/SignInPrompt";
import { StatusChip } from "./ui/StatusChip";
import { Wordmark } from "./ui/Wordmark";

type State =
  | { kind: "loading" }
  | { kind: "ready"; projects: Project[]; currentId: number; total: number; questions: FullQuestion[] }
  | { kind: "signed-out" }
  | { kind: "not-found" }
  | { kind: "error" };

type Filter = "all" | QuestionStatus;

/**
 * One screen for a project: the person's projects (rail: the first page of the list, plus this project
 * if it is not on it, #49), the project's questions with counts and
 * filters (middle; a question opens below its row, with its answers and the answers clients sent for it, #121),
 * and the add form and the answer-link cards (right). The counts and filters are worked out from the questions
 * already loaded.
 */
export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const base = `/api/projects/${id}/questions/`;
  const signedOutNow = useRef(false); // set by a sign-out, cleared when a new load starts: a load already on its way must not undo it

  // The person signed out in the header (SessionStatus): show the signed-out page now, not after a refresh (#121).
  useEffect(() => {
    const signedOut = () => {
      signedOutNow.current = true;
      setState({ kind: "signed-out" });
    };
    window.addEventListener(SIGNED_OUT_EVENT, signedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, signedOut);
  }, []);

  useEffect(() => {
    let cancelled = false;
    signedOutNow.current = false; // a new load: whatever it finds is the truth now
    // The project itself is asked for on its own: the list is in pages (#49), so this project may not be on the
    // first one, and "is it yours" is answered by its own 404, not by looking for it in the list.
    Promise.all([apiFetch(`/api/projects/${id}/`), apiFetch("/api/projects/"), apiFetch(base)])
      .then(async ([projectRes, projectsRes, questionsRes]) => {
        if (cancelled || signedOutNow.current) return;
        // The backend's SessionAuthentication answers 403 (never 401) when nobody is signed in, and 404 for a
        // project the person is not on, so only a 404 means "not found" (#91). 401 is kept for a proxy or a
        // future authentication class.
        const signedOut = (r: Response) => r.status === 401 || r.status === 403;
        if (signedOut(questionsRes) || signedOut(projectRes) || signedOut(projectsRes)) return setState({ kind: "signed-out" });
        // A project you are not on is the same as one that does not exist.
        if (questionsRes.status === 404 || projectRes.status === 404) return setState({ kind: "not-found" });
        if (!projectRes.ok || !projectsRes.ok || !questionsRes.ok) return setState({ kind: "error" });
        const current = (await projectRes.json()) as Project;
        const page = (await projectsRes.json()) as ProjectPage;
        const questions = (await questionsRes.json()) as FullQuestion[];
        const projects = page.results.some((p) => p.id === current.id) ? page.results : [current, ...page.results];
        setState({ kind: "ready", projects, currentId: current.id, total: page.count, questions });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [id, base]);

  // The members are a nicety, loaded on their own: a slow or failed call (a refused status, a dropped
  // connection, a reply that is not JSON) never delays or breaks the project, it only leaves out the
  // list (review of #88).
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${id}/members/`)
      .then(async (response) => (response.ok ? ((await response.json()) as Member[]) : []))
      .catch(() => [] as Member[])
      .then((list) => {
        if (!cancelled) setMembers(Array.isArray(list) ? list : []);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** How long a question has been open, in the chosen language ("open for 3 days"). */
  const age = (createdAt: string) => {
    const { key, values } = ageKey(daysOpen(createdAt));
    return t(key, values);
  };

  const replace = (updated: FullQuestion) => {
    setState((s) =>
      s.kind === "ready" ? { ...s, questions: s.questions.map((q) => (q.id === updated.id ? updated : q)) } : s,
    );
  };

  /** A submission became this question's answer: read the question again so its card shows the answer. */
  async function reloadQuestion(number: number) {
    try {
      const response = await apiFetch(`${base}${number}/`);
      if (response.ok) replace((await response.json()) as FullQuestion);
    } catch {
      // the answer is saved; the card catches up the next time the page loads
    }
  }

  /** Open a question from the summary card. One this page has not loaded (added by a teammate meanwhile) is read first. */
  async function openQuestion(number: number) {
    if (state.kind === "ready" && !state.questions.some((q) => q.number === number)) {
      try {
        const response = await apiFetch(`${base}${number}/`);
        if (!response.ok) return;
        const found = (await response.json()) as FullQuestion;
        setState((s) =>
          s.kind === "ready" && !s.questions.some((q) => q.number === found.number)
            ? { ...s, questions: [...s.questions, found].sort((a, b) => a.number - b.number) }
            : s,
        );
      } catch {
        return; // the card still lists it; the next Refresh or load shows it
      }
    }
    setFilter("all");
    setSelected(number);
    setFocusDetail(true);
  }

  // What clients sent through the answer link: one state for the answers inside the questions and the summary card.
  const submissions = useSubmissions(id, { enabled: state.kind === "ready", onAccepted: reloadQuestion });

  // The open question's own area. After a decision the pressed button is gone, and "Open" in the summary card jumps
  // here: the keyboard goes to this area, which also scrolls it into view.
  const detail = useRef<HTMLElement>(null);
  const [focusDetail, setFocusDetail] = useState(false);
  useEffect(() => {
    if (focusDetail) {
      detail.current?.focus();
      setFocusDetail(false);
    }
  }, [focusDetail, selected]);

  const shell = (body: ReactNode) => (
    <div className="min-h-screen bg-background [overflow-wrap:anywhere]">
      <header className="bg-navy pattern-lattice text-navy-foreground">
        <nav className="mx-auto flex max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-6">
          <Wordmark className="font-display text-xl font-semibold" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <LanguageSwitch />
            <SessionStatus layout="nav" wakingNote={false} />
          </div>
        </nav>
        <CarpetStrip />
      </header>
      {body}
    </div>
  );

  if (state.kind === "loading")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <LedgerLoading label={t("workspace.loading")} />
      </div>,
    );
  if (state.kind === "signed-out")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <EmptyState strip={false}>
          <SignInPrompt line="workspace.signInLine" />
        </EmptyState>
      </div>,
    );
  if (state.kind === "not-found")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <EmptyState strip={false}>
          <p>{t("workspace.notFound")}</p>
          <div>
            <Link href="/projects" className={buttonClasses("secondary")}>
              {t("workspace.back")}
            </Link>
          </div>
        </EmptyState>
      </div>,
    );
  if (state.kind === "error")
    return shell(
      <div className="mx-auto max-w-3xl p-4">
        <Alert tone="error">{t("workspace.loadError")}</Alert>
      </div>,
    );

  const { projects, currentId, total, questions } = state;
  // By the number the server answered with, not the address: /projects/05 is project 5 (review of #105).
  const project = projects.find((p) => p.id === currentId)!;
  const count = (s: QuestionStatus) => questions.filter((q) => q.status === s).length;
  // The question that is open stays on screen whatever the filter says: its own change of status (or a teammate's)
  // must not take the row, and a typed answer inside it, away.
  const shown = filter === "all" ? questions : questions.filter((q) => q.status === filter || q.number === selected);

  async function add(values: QuestionFields): Promise<SubmitResult> {
    const response = await apiFetch(base, { method: "POST", body: values });
    if (response.status === 201) {
      const created = (await response.json()) as FullQuestion;
      setState((s) => (s.kind === "ready" ? { ...s, questions: [...s.questions, created] } : s));
      return null;
    }
    return await failure(response, t("error.addQuestion"), [...QUESTION_FIELDS]);
  }

  return shell(
    <div className="mx-auto grid max-w-[90rem] grid-cols-1 gap-4 p-4 sm:p-6 lg:grid-cols-[15rem_minmax(0,1fr)_24rem]">
      <nav aria-label={t("session.yourProjects")} className="min-w-0 rounded-md bg-navy p-3 text-navy-foreground lg:self-start">
        <Eyebrow tone="navy" className="px-2 pb-2">
          {t("workspace.projects")}
        </Eyebrow>
        <ul className="grid list-none gap-1">
          {projects.map((p) => {
            const active = p.id === currentId;
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
        {total > projects.length && (
          <Link href="/projects" className="mt-2 flex min-h-11 items-center px-2 text-sm hover:underline">
            {t("workspace.allProjects", { n: total })}
          </Link>
        )}
      </nav>

      <main className="grid min-w-0 content-start gap-4">
        <div className="grid gap-1">
          <Eyebrow>{project.client_name}</Eyebrow>
          <h1 className="text-3xl font-semibold">{project.name}</h1>
          {members.length > 0 && (
            <ul aria-label={t("members.label")} className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm text-muted-foreground">
              {members.map((m) => (
                <li key={m.user_id}>{`${m.name || m.email} · ${t(`role.${m.role}`)}`}</li>
              ))}
            </ul>
          )}
          {project.my_role === "owner" && <MembersPanel projectId={project.id} members={members} onMembers={setMembers} />}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STATUSES.map((s) => (
            <Card key={s} data-testid={`stat-${s}`} className="grid gap-1 p-3 sm:p-3">
              <span className="text-xs text-muted-foreground">{t(`status.${s}`)}</span>
              <span className="font-display text-2xl font-semibold">{count(s)}</span>
            </Card>
          ))}
        </div>

        <div className="flex flex-wrap gap-2" role="group" aria-label={t("workspace.filterGroup")}>
          {(["all", ...STATUSES] as Filter[]).map((f) => (
            <Button
              key={f}
              variant="secondary"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={filter === f ? "border-primary text-primary" : undefined}
            >
              {f === "all" ? t("workspace.all") : t(`status.${f}`)}
            </Button>
          ))}
        </div>

        {shown.length === 0 ? (
          <EmptyState strip={false}>
            <p>{questions.length === 0 ? t("workspace.none") : t("workspace.noneWithStatus")}</p>
          </EmptyState>
        ) : (
          <ul className="grid list-none gap-2">
            {shown.map((q) => {
              const waiting = q.status === "open" || q.status === "asked";
              const isOpen = selected === q.number;
              const sentHere = submissions.pending.filter((s) => s.question_number === q.number);
              return (
                <li key={q.id}>
                  <Card className={cx("grid gap-3 p-3 sm:p-3", isOpen && "border-primary")}>
                    <button
                      type="button"
                      onClick={() => setSelected(isOpen ? null : q.number)}
                      aria-expanded={isOpen}
                      aria-controls={isOpen ? `question-${q.number}` : undefined}
                      className="m-0 grid min-h-11 min-w-0 cursor-pointer gap-1 border-0 bg-transparent p-0 text-left text-inherit [font:inherit]"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-primary">{q.label}</span>
                        <StatusChip status={q.status} />
                        {sentHere.length > 0 && (
                          <span className="rounded-md bg-saffron px-2 py-0.5 font-mono text-xs text-navy">
                            {t("submissions.waiting", { n: sentHere.length })}
                          </span>
                        )}
                      </span>
                      <span>{q.text}</span>
                      {waiting && (
                        <span className="text-xs text-muted-foreground">
                          {age(q.created_at)}
                        </span>
                      )}
                    </button>
                    {isOpen && (
                      <section
                        id={`question-${q.number}`}
                        ref={detail}
                        tabIndex={-1}
                        aria-label={t("workspace.selected")}
                        className="grid gap-3 border-t pt-3"
                      >
                        <QuestionItem
                          key={q.id}
                          inline
                          question={q}
                          base={base}
                          onChanged={replace}
                          extra={<WaitingAnswers items={sentHere} submissions={submissions} onSettled={() => setFocusDetail(true)} />}
                        />
                      </section>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <aside className="grid min-w-0 content-start gap-4">
        <Card className="grid gap-4">
          <h2 className="text-lg font-semibold">{t("workspace.add")}</h2>
          <QuestionForm idPrefix="add" submitLabel={t("form.add")} busyLabel={t("form.adding")} clearOnSuccess onSubmit={add} />
        </Card>

        <SubmissionsPanel
          submissions={submissions}
          onOpen={(number) => void openQuestion(number)}
        />
        <AnswerLinkPanel projectId={project.id} />

      </aside>
    </div>,
  );
}
