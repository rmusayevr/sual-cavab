"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch, type CurrentUser } from "@/lib/api";

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
      return <p>Checking your session…</p>;
    case "signed-in":
      return (
        <>
          <p>
            Signed in as {state.user.name || state.user.email}.{" "}
            <button type="button" onClick={signOut}>
              Sign out
            </button>
          </p>
          {signOutFailed && <p role="alert">Sign-out failed. You are still signed in.</p>}
        </>
      );
    case "signed-out":
      return (
        <p>
          <Link href="/login">Sign in</Link>
        </p>
      );
    case "error":
      return <p role="alert">Could not reach the server.</p>;
  }
}
