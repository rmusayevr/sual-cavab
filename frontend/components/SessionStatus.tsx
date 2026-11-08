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

  async function signOut() {
    await apiFetch("/api/auth/logout/", { method: "POST" });
    setState({ kind: "signed-out" });
  }

  switch (state.kind) {
    case "loading":
      return <p>Checking your session…</p>;
    case "signed-in":
      return (
        <p>
          Signed in as {state.user.name || state.user.email}.{" "}
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </p>
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
