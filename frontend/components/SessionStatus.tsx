"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch, type CurrentUser } from "@/lib/api";

import { Alert } from "./ui/Alert";
import { Button, buttonClasses } from "./ui/Button";
import { Card } from "./ui/Card";

type State =
  | { kind: "loading" }
  | { kind: "signed-in"; user: CurrentUser }
  | { kind: "signed-out" }
  | { kind: "error" };

export default function SessionStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [signOutFailed, setSignOutFailed] = useState(false);

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

  switch (state.kind) {
    case "loading":
      return <p className="text-muted-foreground">Checking your session…</p>;
    case "signed-in":
      return (
        <div className="grid gap-3">
          <Card className="grid gap-3">
            <p>Signed in as {state.user.name || state.user.email}.</p>
            <div className="flex flex-wrap gap-2">
              <Link href="/projects" className={buttonClasses("primary")}>
                Your projects
              </Link>
              <Button variant="secondary" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </Card>
          {signOutFailed && <Alert tone="error">Sign-out failed. You are still signed in.</Alert>}
        </div>
      );
    case "signed-out":
      return (
        <div>
          <Link href="/login" className={buttonClasses("primary")}>
            Sign in
          </Link>
        </div>
      );
    case "error":
      return <Alert tone="error">Could not reach the server.</Alert>;
  }
}
