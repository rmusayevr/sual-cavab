import type { Metadata } from "next";
import Link from "next/link";

import { buttonClasses } from "@/components/ui/Button";
import { CarpetStrip } from "@/components/ui/Ledger";
import { LanguageSwitch, T } from "@/lib/i18n";
import { Wordmark } from "@/components/ui/Wordmark";

// The 404 page (#72). A ledger line: the missing "question" gets the number Q404.
export const metadata: Metadata = { title: "Page not found · Sual-Cavab" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-navy px-6 py-12 text-navy-foreground pattern-lattice">
      <div className="flex w-full max-w-md items-center justify-between gap-4">
        <Wordmark className="font-display text-2xl font-semibold" />
        <LanguageSwitch />
      </div>
      <div className="w-full max-w-md overflow-hidden rounded-md bg-card text-card-foreground shadow-card">
        <CarpetStrip />
        <div className="grid gap-4 p-6">
          <p className="font-mono text-xs text-primary">Q404</p>
          <h1 className="text-3xl font-semibold">
            <T k="notfound.title" />
          </h1>
          <p className="text-sm text-muted-foreground">
            <T k="notfound.text" />
          </p>
          <div>
            <Link href="/projects" className={buttonClasses("primary")}>
              <T k="workspace.back" />
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
