"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import {
  DEFAULT_DAYS,
  MAX_DAYS,
  MIN_DAYS,
  answerUrl,
  isLinkInfo,
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
 * keeps a hash and cannot show it again, and nothing here writes it to storage or the address bar.
 */
export default function AnswerLinkPanel({ projectId }: { projectId: number }) {
  const t = useT();
  const base = `/api/projects/${projectId}/answer-link/`;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [days, setDays] = useState(String(DEFAULT_DAYS));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [making, setMaking] = useState(false);
  const [link, setLink] = useState<string | null>(null); // the full link, only right after it was made
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);
  const [asking, setAsking] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch(base);
      const body = response.ok ? await response.json() : null;
      setState(isLinkInfo(body) ? { kind: "ready", info: body } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  }, [base]);

  useEffect(() => {
    // Read once on mount; the setState calls happen after the request, not during the render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function onMake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        setAsking(false);
      } else {
        setErrors(await failure(response, t("answerLink.createFailed"), ["days"]));
      }
    } catch {
      setErrors({ form: t("error.server") });
    } finally {
      setMaking(false);
    }
  }

  async function onRevoke() {
    setRevoking(true);
    setRevokeError(null);
    try {
      const response = await apiFetch(base, { method: "DELETE" });
      if (response.status === 204) {
        setLink(null);
        setAsking(false);
        await load();
      } else {
        const problem = await failure(response, t("answerLink.revokeFailed"), []);
        setRevokeError(problem.form ?? t("answerLink.revokeFailed"));
        setAsking(false);
      }
    } catch {
      setRevokeError(t("error.server"));
    } finally {
      setRevoking(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link ?? "");
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  const info = state.kind === "ready" ? state.info : null;
  const active = info?.exists && info.state === "active";

  function statusLine(i: AnswerLinkInfo): string {
    if (!i.exists) return t("answerLink.none");
    if (i.state === "active") return t("answerLink.active", { who: i.created_by, date: shortDate(i.expires_at) });
    if (i.state === "expired") return t("answerLink.expired", { date: shortDate(i.expires_at) });
    if (i.state === "revoked") return t("answerLink.revoked");
    return t("answerLink.creatorInactive");
  }

  return (
    <Card className="grid gap-3" aria-labelledby={`answer-link-heading-${projectId}`}>
      <h2 id={`answer-link-heading-${projectId}`} className="text-lg font-semibold">
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
                {(props) => <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} {...props} />}
              </Field>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={copy}>
                  {t("answerLink.copy")}
                </Button>
                {copied === "yes" && <span role="status">{t("answerLink.copied")}</span>}
                {copied === "failed" && <span role="status">{t("answerLink.copyFailed")}</span>}
              </div>
            </div>
          )}

          <form onSubmit={onMake} className="grid gap-3" aria-label={t("answerLink.create")}>
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
            <div>
              <Button type="submit" disabled={making}>
                {making ? t("answerLink.creating") : active ? t("answerLink.createNew") : t("answerLink.create")}
              </Button>
            </div>
          </form>

          {active &&
            (asking ? (
              <div role="group" aria-label={t("answerLink.revokeAsk")} className="flex flex-wrap items-center gap-2">
                <span>{t("answerLink.revokeAsk")}</span>
                <Button variant="danger" onClick={onRevoke} disabled={revoking}>
                  {revoking ? t("answerLink.revoking") : t("answerLink.revokeYes")}
                </Button>
                <Button variant="secondary" autoFocus onClick={() => setAsking(false)} disabled={revoking}>
                  {t("question.cancel")}
                </Button>
              </div>
            ) : (
              <div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRevokeError(null);
                    setAsking(true);
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
