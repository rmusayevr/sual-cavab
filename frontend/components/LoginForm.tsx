"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiFetch } from "@/lib/api";

import { Alert } from "./ui/Alert";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Field";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch("/api/auth/login/", { method: "POST", body: { email, password } });
      if (response.ok) {
        router.replace("/");
        return;
      }
      if (response.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else if (response.status === 400) setError("Email or password is incorrect.");
      else setError("Sign-in failed. Try again.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label="Email">
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
      <Field label="Password">
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
      {error && <Alert tone="error">{error}</Alert>}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
