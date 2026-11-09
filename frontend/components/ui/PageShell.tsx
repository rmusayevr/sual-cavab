import type { ReactNode } from "react";

/** The frame of a page: a centred column that fits a phone (16 px gutter) and a laptop. */
export function PageShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6 sm:px-6">
      {title && <h1 className="text-2xl font-semibold text-text">{title}</h1>}
      {children}
    </main>
  );
}
