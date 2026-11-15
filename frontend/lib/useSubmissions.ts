"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "./api";
import { isSubmissionList, type Submission } from "./answerLink";
import { useT } from "./i18n";
import { fieldErrors } from "./questions";

export type SubmissionsState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; pending: Submission[] };

/** A refusal, and what it was about: one answer, or "all" (dismiss all), so it is shown where it belongs. */
export type Problem = { message: string; id: number | "all" };

/**
 * What clients sent through the answer link, waiting for a member to decide, and the ways to decide (#114).
 * One of these per workspace: the answers shown inside each question and the summary card read the same state,
 * so they cannot disagree. Nothing a client sends is an answer until a member accepts it; accepting uses the same
 * status change as every other answer. After each change the lists are read again from the server.
 */
export function useSubmissions(
  projectId: string | number,
  {
    enabled,
    onAccepted,
  }: {
    /** False until the project itself has loaded: there is nothing to ask for before that. */
    enabled: boolean;
    /** Called with the question's number after a submission became its answer, so the page can reload that question. */
    onAccepted: (questionNumber: number) => void;
  },
) {
  const t = useT();
  const base = `/api/projects/${projectId}/submissions/`;
  const inFlight = useRef(false);
  const latestLoad = useRef(0); // only the newest read may change what is shown
  const [state, setState] = useState<SubmissionsState>({ kind: "loading" });
  const [dismissed, setDismissed] = useState<Submission[] | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [askAll, setAskAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const read = useCallback(
    async (which: "pending" | "dismissed"): Promise<Submission[] | null> => {
      try {
        const response = await apiFetch(`${base}?state=${which}`);
        const body = response.ok ? await response.json() : null;
        return isSubmissionList(body) ? body : null;
      } catch {
        return null;
      }
    },
    [base],
  );

  const load = useCallback(
    async (alsoDismissed: boolean) => {
      const mine = ++latestLoad.current;
      const [pending, other] = await Promise.all([read("pending"), alsoDismissed ? read("dismissed") : Promise.resolve(undefined)]);
      if (mine !== latestLoad.current) return; // a newer read has started: its answer is the one to show
      setState(pending ? { kind: "ready", pending } : { kind: "error" });
      if (pending && pending.length <= 1) setAskAll(false); // "dismiss all" is not offered for one, and must not come back unasked
      if (other !== undefined) setDismissed(other);
    },
    [read],
  );

  useEffect(() => {
    if (!enabled) return;
    // Read once the project is there; the setState calls happen after the request, not during the render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(false);
  }, [enabled, load]);

  /** Do one change, then read the lists again (also after a refusal: the refusal usually means the list is out of date). */
  async function change(path: string, body: unknown, fallback: string, id: number | "all", then?: () => void): Promise<boolean> {
    if (inFlight.current) return false; // a second click while the first is still on its way
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const response = await apiFetch(`${base}${path}`, { method: "POST", body });
      if (response.ok) {
        then?.();
        await load(showDismissed);
        return true;
      }
      let reply: unknown = null;
      try {
        reply = await response.json();
      } catch {
        // not JSON (a proxy error page): the fallback is the message
      }
      const reasons = Object.values(fieldErrors(reply));
      setProblem({ message: reasons.length > 0 ? reasons.join(" ") : fallback, id });
      await load(showDismissed);
      return false;
    } catch {
      setProblem({ message: t("error.server"), id });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const pending = state.kind === "ready" ? state.pending : [];

  return {
    state,
    pending,
    dismissed,
    showDismissed,
    askAll,
    setAskAll,
    busy,
    problem,
    /** Read the lists again (what arrived meanwhile appears). */
    refresh: () => load(showDismissed),
    toggleDismissed: () => {
      const next = !showDismissed;
      setShowDismissed(next);
      if (next) {
        setDismissed(null); // not the list from the last time it was open
        void load(true);
      }
    },
    /** Make the answer the question's answer. `text` may be edited from what the client sent; the original stays. */
    accept: (s: Submission, text: string) =>
      change(`${s.id}/accept/`, { text }, t("submissions.acceptFailed"), s.id, () => onAccepted(s.question_number)),
    dismiss: (s: Submission) => change(`${s.id}/dismiss/`, {}, t("submissions.dismissFailed"), s.id),
    restore: (s: Submission) => change(`${s.id}/restore/`, {}, t("submissions.restoreFailed"), s.id),
    dismissAll: () => change("dismiss-pending/", {}, t("submissions.dismissFailed"), "all", () => setAskAll(false)),
  };
}

export type SubmissionsApi = ReturnType<typeof useSubmissions>;
