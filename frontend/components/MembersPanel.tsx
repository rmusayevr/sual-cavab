"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Member, Role } from "@/lib/projects";

import { failure } from "./QuestionItem";
import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Field";

/**
 * Add and remove the members of a project (#33). Shown to an owner only; the rule is the one approved on
 * #5 and the API enforces it (a member gets 403 from it), so hiding the panel is a courtesy, not the guard.
 * After each change the list is read again from the server, not patched here, so what is shown is what
 * the server has. An owner who removes themselves has lost the project: they go to the projects list.
 */
export default function MembersPanel({
  projectId,
  members,
  onMembers,
}: {
  projectId: number;
  members: Member[];
  onMembers: (list: Member[]) => void;
}) {
  const t = useT();
  const router = useRouter();
  const base = `/api/projects/${projectId}/members/`;
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [asking, setAsking] = useState<number | null>(null); // the user_id whose removal is being confirmed
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [meId, setMeId] = useState<number | null>(null); // who is signed in, to word the question for removing yourself
  const returnFocusTo = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/me/")
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((me) => {
        if (!cancelled && me && typeof me.id === "number") setMeId(me.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // After Cancel the question goes away and the Remove button it replaced comes back: put the keyboard on it.
  useEffect(() => {
    if (asking === null && returnFocusTo.current !== null) {
      document.getElementById(`remove-${returnFocusTo.current}`)?.focus();
      returnFocusTo.current = null;
    }
  }, [asking]);

  const who = (m: Member) => m.name || m.email;

  /** Read the list again. A 404 means the person can no longer see the project (they removed themselves). */
  async function refresh() {
    try {
      const response = await apiFetch(base);
      if (response.status === 404) return router.push("/projects");
      if (response.ok) {
        const list = await response.json();
        if (Array.isArray(list)) onMembers(list as Member[]);
      }
    } catch {
      // the change itself went through; the old list stays until the next load
    }
  }

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdding(true);
    setErrors({});
    setNotice(null);
    try {
      const response = await apiFetch(base, { method: "POST", body: { email, role } });
      if (response.status === 201) {
        const added = (await response.json()) as Member;
        setEmail("");
        setRole("member");
        setNotice(t("members.added", { who: added.name || added.email }));
        onMembers([...members.filter((m) => m.user_id !== added.user_id), added]); // shown now; the read below confirms it
        await refresh();
      } else {
        setErrors(await failure(response, t("members.addFailed"), ["email", "role"]));
        if (response.status === 404) await refresh(); // the project is gone for this person: refresh sends them away
      }
    } catch {
      setErrors({ form: t("error.server") });
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(member: Member) {
    setRemoving(true);
    setListError(null);
    setNotice(null);
    try {
      const response = await apiFetch(`${base}${member.user_id}/`, { method: "DELETE" });
      if (response.status === 204) {
        setAsking(null);
        if (member.user_id === meId) return router.push("/projects"); // they removed themselves: the project is gone for them
        setNotice(t("members.removed", { who: who(member) }));
        await refresh();
      } else {
        const problem = await failure(response, t("members.removeFailed"), []);
        setListError(problem.form ?? t("members.removeFailed"));
        setAsking(null);
        if (response.status === 404) await refresh();
      }
    } catch {
      setListError(t("error.server"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <details className="rounded-md border border-control-border bg-card p-3">
      <summary className="min-h-11 cursor-pointer py-2 font-medium">{t("members.manage")}</summary>
      <div className="grid gap-4 pt-2">
        <p className="text-sm text-muted-foreground">{t("members.hint")}</p>
        <ul className="m-0 grid list-none gap-2 p-0">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{`${who(m)} · ${t(`role.${m.role}`)}`}</span>
              {asking === m.user_id ? (
                <span
                  role="group"
                  aria-label={m.user_id === meId ? t("members.removeSelfAsk") : t("members.removeAsk", { who: who(m) })}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span>{m.user_id === meId ? t("members.removeSelfAsk") : t("members.removeAsk", { who: who(m) })}</span>
                  <Button variant="danger" onClick={() => onRemove(m)} disabled={removing}>
                    {removing ? t("members.removing") : t("members.removeYes")}
                  </Button>
                  <Button
                    variant="secondary"
                    autoFocus
                    onClick={() => {
                      returnFocusTo.current = m.user_id;
                      setAsking(null);
                    }}
                    disabled={removing}
                  >
                    {t("members.removeNo")}
                  </Button>
                </span>
              ) : (
                <Button
                  id={`remove-${m.user_id}`}
                  variant="secondary"
                  disabled={removing}
                  onClick={() => {
                    setListError(null);
                    setNotice(null);
                    setAsking(m.user_id);
                  }}
                  aria-label={t("members.removeLabel", { who: who(m) })}
                >
                  {t("members.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
        {listError && <Alert tone="error">{listError}</Alert>}

        <form onSubmit={onAdd} className="grid gap-3" aria-label={t("members.addTitle")}>
          <h3 className="font-medium">{t("members.addTitle")}</h3>
          <Field label={t("members.email")} error={errors.email}>
            {(props) => (
              <Input
                type="email"
                name="email"
                autoComplete="off"
                required
                disabled={adding}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                {...props}
              />
            )}
          </Field>
          <Field label={t("members.role")} error={errors.role}>
            {(props) => (
              <Select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} {...props}>
                <option value="member">{t("role.member")}</option>
                <option value="owner">{t("role.owner")}</option>
              </Select>
            )}
          </Field>
          {errors.form && <Alert tone="error">{errors.form}</Alert>}
          <Button type="submit" disabled={adding}>
            {adding ? t("members.adding") : t("members.add")}
          </Button>
        </form>
        <p role="status" className="text-sm">
          {notice}
        </p>
      </div>
    </details>
  );
}
