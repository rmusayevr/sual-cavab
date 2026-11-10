import type { Metadata } from "next";

import LoginForm from "@/components/LoginForm";
import { LanguageSwitch, T } from "@/lib/i18n";
import { CarpetStrip, Eyebrow } from "@/components/ui/Ledger";
import { Wordmark } from "@/components/ui/Wordmark";

export const metadata: Metadata = { title: "Sign in · Sual-Cavab" };

// A page the design example does not show (#72): the landing page's navy lattice, with the form on a
// cream ledger card topped by a carpet strip (as the example's sample question card is).
export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-navy px-6 py-12 text-navy-foreground pattern-lattice">
      <div className="flex w-full max-w-sm items-center justify-between gap-4">
        <Wordmark className="font-display text-2xl font-semibold" />
        <LanguageSwitch />
      </div>
      <div className="w-full max-w-sm overflow-hidden rounded-md bg-card text-card-foreground shadow-card">
        <CarpetStrip />
        <div className="grid gap-4 p-6">
          <div className="grid gap-2">
            <Eyebrow>
              <T k="login.eyebrow" />
            </Eyebrow>
            <h1 className="text-3xl font-semibold">
              <T k="login.title" />
            </h1>
            <p className="text-sm text-muted-foreground">
              <T k="login.note" />
            </p>
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
