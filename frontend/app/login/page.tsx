import type { Metadata } from "next";

import LoginForm from "@/components/LoginForm";
import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";

export const metadata: Metadata = { title: "Sign in · Sual-Cavab" };

export default function LoginPage() {
  return (
    <PageShell title="Sign in">
      <p className="text-muted-foreground">Accounts are created by an administrator.</p>
      <Card className="max-w-sm">
        <LoginForm />
      </Card>
    </PageShell>
  );
}
