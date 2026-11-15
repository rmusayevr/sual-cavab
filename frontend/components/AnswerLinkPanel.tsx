"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { SIGNED_OUT_EVENT, apiFetch } from "@/lib/api";
import {
  DEFAULT_DAYS,
  LINK_VISIBLE_MS,
  MAX_DAYS,
  MIN_DAYS,
  answerUrl,
  isLinkInfo,
  plainName,
  shortDate,
  type AnswerLinkInfo,
} from "@/lib/answerLink";
import { useT } from "@/lib/i18n";

import { failure } from "./QuestionItem";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Field, Input } from "./ui/Field";
import { LedgerLoading } from "./ui/Ledger";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; info: AnswerLinkInfo };

/**
 * The private link a client opens to see this project's open questions and send answers (#114). Any member can
 * make or revoke it; the API enforces that (a person who is not on the project gets a 404), this panel is only
 * the way in.
 *
 * The link itself is shown once, right after it is made, and held only in this component's memory: the server
 * keeps a hash and cannot show it again, and nothing here writes it to storage or the address bar. "Once" is
 * kept by dropping it when the person revokes or replaces the link, signs out, leaves the page (Next keeps a
 * page you leave alive but hidden, so a cleanup that runs on hiding is what counts), or after
 * LINK_VISIBLE_MS: a credential must not sit on a screen that someone walked away from.
 */
export default function AnswerLinkPanel({ projectId }: { projectId: number }) {
  const t = useT();
  const base = `/api/projects/${projectId}/answer-link/`;
  const revokeId = `answer-link-revoke-${projectId}`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [making, setMaking] = useState(false);
  const [link, setLink] = useState<string | null>(null); // the full link, only right after it was made
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [askRevoke, setAskRevoke] = useState(false);
  const [askReplace, setAskReplace] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const returnFocusToRevoke = useRef(false);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(base);
      const body = response.ok ? await response.json() : null;
      if (!isLinkInfo(body)) return setState({ kind: "error" });
      setState({ kind: "ready", info: body });
    } catch {
      setState({ kind: "error" });
    }
  }, [base]);

  useEffect(() => {
    // Read once on mount; the setState calls happen after the request, not during the render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // The link goes when the person signs out, and when this component is hidden or removed (the cleanup).
  useEffect(() => {
    const drop = () => {
      setLink(null);
      setCopied(null);
    };
    window.addEventListener(SIGNED_OUT_EVENT, drop);
    return () => {
      window.removeEventListener(SIGNED_OUT_EVENT, drop);
      drop();
    };
  }, []);

  // ... and after a few minutes, for a screen that was left alone.
  useEffect(() => {
    if (!link) return;
    const timer = setTimeout(() => setLink(null), LINK_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [link]);

  // After Cancel on the revoke question, the Revoke button it replaced comes back: put the keyboard on it.
  useEffect(() => {
    if (!askRevoke && returnFocusToRevoke.current) {
      document.getElementById(revokeId)?.focus();
      returnFocusToRevoke.current = false;
    }
  }, [askRevoke, revokeId]);

  async function make() {
    setMaking(true);
    setErrors({});
    setCopied(null);
    try {
      const response = await apiFetch(base, { method: "POST", body: { days: Number(days) } });
      if (response.status === 201) {
        const made = (await response.json()) as AnswerLinkInfo;
        if (made.exists && made.token) {
          setLink(answerUrl(window.location.origin, made.token));
          const { token: _token, ...withoutToken } = made;
          void _token;
          setState({ kind: "ready", info: withoutToken });
        }
        setAskReplace(false);
      } else {
        setAskReplace(false);
        setErrors(await failure(response, t("answerLink.createFailed"), ["days"]));
      }
    } catch {
      setAskReplace(false);
      setErrors({ form: t("error.server") });
    } finally {
      setMaking(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Replacing a live link ends the one the client already has: ask first, like revoking does.
    if (active) setAskReplace(true);
    else void make();
  }

  async function onRevoke() {
    setRevoking(true);
    setRevokeError(null);
    try {
      const response = await apiFetch(base, { method: "DELETE" });
      if (response.status === 204) {
        setLink(null);
        setAskRevoke(false);
        await load();
        headingRef.current?.focus();
      } else {
        const problem = await failure(response, t("answerLink.revokeFailed"), []);
        setRevokeError(problem.form ?? t("answerLink.revokeFailed"));
        setAskRevoke(false);
      }
    } catch {
      setRevokeError(t("error.server"));
    } finally {
      setRevoking(false);
    }
  }

  async function copy() {
    setCopied(null); // so the message is announced again on a second copy
    try {
      await navigator.clipboard.writeText(link ?? "");
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  const info = state.kind === "ready" ? state.info : null;
  const active = !!info && info.exists && info.state === "active";

  function statusLine(i: AnswerLinkInfo): string {
    if (!i.exists) return t("answerLink.none");
    // The name of whoever made it is a team member's own address, not an anonymous client's; still strip control characters.
    if (i.state === "active") return t("answerLink.active", { who: plainName(i.created_by), date: shortDate(i.expires_at) });
    if (i.state === "expired") return t("answerLink.expired", { date: shortDate(i.expires_at) });
    if (i.state === "revoked") return t("answerLink.revoked");
    return t("answerLink.creatorInactive");
  }

  return (
    <Card className="grid gap-3" aria-labelledby={`answer-link-heading-${projectId}`}>
      <h2 ref={headingRef} tabIndex={-1} id={`answer-link-heading-${projectId}`} className="text-lg font-semibold">
        {t("answerLink.title")}
      </h2>
      <p className="text-sm text-muted-foreground">{t("answerLink.hint")}</p>

      {state.kind === "loading" && <LedgerLoading label={t("answerLink.loading")} />}
      {state.kind === "error" && (
        <div className="grid gap-2">
          <Alert tone="error">{t("answerLink.loadError")}</Alert>
          <div>
            <Button variant="secondary" onClick={() => void load()}>
              {t("submissions.refresh")}
            </Button>
          </div>
        </div>
      )}

      {info && (
        <>
          <p>{statusLine(info)}</p>

          {link && (
            <div className="grid gap-2">
              <Alert>{t("answerLink.once")}</Alert>
              <Field label={t("answerLink.urlLabel")}>
                {(props) => (
                  <Input readOnly autoFocus value={link} onFocus={(e) => e.currentTarget.select()} {...props} />
                )}
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={copy}>
                  {t("answerLink.copy")}
                </Button>
                <span role="status">
                  {copied === "yes" && t("answerLink.copied")}
                  {copied === "failed" && t("answerLink.copyFailed")}
                </span>
              </div>
            </div>
          )}

          <form onSubmit={onSubmit} className="grid gap-3" aria-label={t("answerLink.create")}>
            <Field label={t("answerLink.days")} hint={t("answerLink.daysHint")} error={errors.days}>
              {(props) => (
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_DAYS}
                  max={MAX_DAYS}
                  step={1}
                  required
                  disabled={making}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  {...props}
                />
              )}
            </Field>
            {errors.form && <Alert tone="error">{errors.form}</Alert>}
            {askReplace ? (
              <div role="group" aria-label={t("answerLink.replaceAsk")} className="flex flex-wrap items-center gap-2">
                <span>{t("answerLink.replaceAsk")}</span>
                <Button variant="danger" disabled={making} onClick={() => void make()}>
                  {making ? t("answerLink.creating") : t("answerLink.replaceYes")}
                </Button>
                <Button variant="secondary" autoFocus disabled={making} onClick={() => setAskReplace(false)}>
                  {t("question.cancel")}
                </Button>
              </div>
            ) : (
              <div>
                <Button type="submit" disabled={making}>
                  {making ? t("answerLink.creating") : active ? t("answerLink.createNew") : t("answerLink.create")}
                </Button>
              </div>
            )}
          </form>

          {active &&
            (askRevoke ? (
              <div role="group" aria-label={t("answerLink.revokeAsk")} className="flex flex-wrap items-center gap-2">
                <span>{t("answerLink.revokeAsk")}</span>
                <Button variant="danger" onClick={onRevoke} disabled={revoking}>
                  {revoking ? t("answerLink.revoking") : t("answerLink.revokeYes")}
                </Button>
                <Button
                  variant="secondary"
                  autoFocus
                  disabled={revoking}
                  onClick={() => {
                    returnFocusToRevoke.current = true;
                    setAskRevoke(false);
                  }}
                >
                  {t("question.cancel")}
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  id={revokeId}
                  variant="secondary"
                  onClick={() => {
                    setRevokeError(null);
                    setAskRevoke(true);
                  }}
                >
                  {t("answerLink.revoke")}
                </Button>
              </div>
            ))}
          {revokeError && <Alert tone="error">{revokeError}</Alert>}
        </>
      )}
    </Card>
  );
}
