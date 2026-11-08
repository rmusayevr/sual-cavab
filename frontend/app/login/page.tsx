import type { Metadata } from "next";

import LoginForm from "@/components/LoginForm";

export const metadata: Metadata = { title: "Sign in · Sual-Cavab" };

export default function LoginPage() {
  return (
    <main style={{ padding: "2rem", maxWidth: "40rem" }}>
      <h1>Sign in</h1>
      <p>Accounts are created by an administrator.</p>
      <LoginForm />
    </main>
  );
}
