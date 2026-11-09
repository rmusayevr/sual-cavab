import Link from "next/link";

import { buttonClasses } from "@/components/ui/Button";
import { CarpetStrip } from "@/components/ui/Ledger";

// The 404 page (#72). A ledger line: the missing "question" gets the number Q404.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-navy px-6 py-12 text-navy-foreground pattern-lattice">
      <Link href="/" aria-label="Sual-Cavab, home" className="font-display text-2xl font-semibold">
        Sual<span className="text-saffron">·</span>Cavab
      </Link>
      <div className="w-full max-w-md overflow-hidden rounded-md bg-card text-card-foreground shadow-card">
        <CarpetStrip />
        <div className="grid gap-4 p-6">
          <p className="font-mono text-xs text-primary">Q404</p>
          <h1 className="text-3xl font-semibold">This page is not in the ledger.</h1>
          <p className="text-sm text-muted-foreground">Check the address, or go back to your projects.</p>
          <div>
            <Link href="/projects" className={buttonClasses("primary")}>
              Back to your projects
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
