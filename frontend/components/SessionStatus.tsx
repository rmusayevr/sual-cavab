"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch, type CurrentUser } from "@/lib/api";
import { useT } from "@/lib/i18n";

import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";
import { WakingNote } from "./ui/WakingNote";

type State =
  | { kind: "loading" }
  | { kind: "signed-in"; user: CurrentUser }
  | { kind: "signed-out" }
  | { kind: "error" };

/**
 * `wakingNote={false}` is for a page whose body already shows the note while it loads (the projects
 * page): both wait on the same sleeping server, and the same sentence twice reads twice.
 */
export default function SessionStatus({
  layout = "block",
  wakingNote = true,
}: { layout?: "block" | "nav"; wakingNote?: boolean } = {}) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [signOutFailed, setSignOutFailed] = useState(false);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/auth/me/")
      .then(async (response) => {
        if (cancelled) return;
        if (response.ok) setState({ kind: "signed-in", user: (await response.json()) as CurrentUser });
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

  // Only show "signed out" once the backend confirms it: on a shared computer,
  // a refused logout that looked successful would leave the session usable.
  // A refusal can mean "already signed out" (403, no session) or "still signed
  // in but the request was rejected" (403, CSRF): ask the backend which.
  async function signOut() {
    setSignOutFailed(false);
    try {
      const response = await apiFetch("/api/auth/logout/", { method: "POST" });
      if (response.ok) {
        setState({ kind: "signed-out" });
        return;
      }
      const me = await apiFetch("/api/auth/me/");
      if (me.status === 401 || me.status === 403) setState({ kind: "signed-out" });
      else setSignOutFailed(true);
    } catch {
      setSignOutFailed(true);
    }
  }

  // "nav": inline, for the navy header of the landing page. Same words, same behaviour. The
  // outline button takes the header's colour, so it reads on navy.
  const nav = layout === "nav";

  switch (state.kind) {
    case "loading":
      return (
        <div className="grid min-w-0 gap-1">
          <p className={nav ? "text-sm opacity-80" : "text-muted-foreground"}>{t("session.checking")}</p>
          {wakingNote && <WakingNote active tone={nav ? "navy" : "paper"} />}
        </div>
      );
    case "signed-in":
      return (
        <div className="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
          {nav ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm opacity-80">{t("session.signedInAs", { who: state.user.name || state.user.email })}</p>
              <Link href="/projects" className={buttonClasses("primary")}>
                {t("session.yourProjects")}
              </Link>
              <Button variant="secondary" onClick={signOut}>
                {t("session.signOut")}
              </Button>
            </div>
          ) : (
            <Card className="grid gap-3">
              <p>{t("session.signedInAs", { who: state.user.name || state.user.email })}</p>
              <div className="flex flex-wrap gap-2">
                <Link href="/projects" className={buttonClasses("primary")}>
                  {t("session.yourProjects")}
                </Link>
                <Button variant="secondary" onClick={signOut}>
                  {t("session.signOut")}
                </Button>
              </div>
            </Card>
          )}
          {signOutFailed && <Alert tone="error">{t("session.signOutFailed")}</Alert>}
        </div>
      );
    case "signed-out":
      return (
        <div>
          <Link href="/login" className={buttonClasses("primary")}>
            {t("session.signIn")}
          </Link>
        </div>
      );
    case "error":
      return <Alert tone="error">{t("error.server")}</Alert>;
  }
}
