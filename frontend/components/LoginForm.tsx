"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";
import { useT, type Key } from "@/lib/i18n";
import { safeNext } from "@/lib/safeNext";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Field";
import { WakingNote } from "./ui/WakingNote";

export default function LoginForm() {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<Key | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch("/api/auth/login/", { method: "POST", body: { email, password } });
      if (response.ok) {
        // Read when the form is sent, from the address the person is on: back to the page that asked for the
        // sign-in (#96), only if it is a page of this app.
        router.replace(safeNext(new URLSearchParams(window.location.search).get("next")) ?? "/");
        return;
      }
      if (response.status === 429) setError("login.tooMany");
      else if (response.status === 400) setError("login.incorrect");
      else setError("login.failed");
    } catch {
      setError("error.server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label={t("login.email")}>
        {(props) => (
          <Input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...props}
          />
        )}
      </Field>
      <Field label={t("login.password")}>
        {(props) => (
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...props}
          />
        )}
      </Field>
      {error && <Alert tone="error">{t(error)}</Alert>}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? t("login.submitting") : t("login.submit")}
      </Button>
      <WakingNote active={submitting} />
    </form>
  );
}
