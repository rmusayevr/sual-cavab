import type { ReactNode } from "react";

import SessionStatus from "@/components/SessionStatus";
import { LanguageSwitch } from "@/lib/i18n";

import { CarpetStrip, Eyebrow } from "./Ledger";
import { Wordmark } from "./Wordmark";

/**
 * The navy band at the top of a page: the wordmark (a link home), the session actions, then an
 * eyebrow, the page title and a sentence, with a carpet strip as the seam into the paper ground
 * (the landing page's header, made reusable; #72).
 */
export function AppHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="bg-navy pattern-lattice text-navy-foreground">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-5">
        <Wordmark className="font-display text-xl font-semibold" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <LanguageSwitch />
          <SessionStatus layout="nav" wakingNote={false} />
        </div>
      </nav>
      <div className="mx-auto grid max-w-6xl gap-3 px-6 pb-12 pt-6">
        <Eyebrow tone="navy">{eyebrow}</Eyebrow>
        <h1 className="text-4xl font-semibold md:text-5xl">{title}</h1>
        {children && <div className="max-w-xl opacity-80">{children}</div>}
      </div>
      <CarpetStrip className="h-3" />
    </header>
  );
}
