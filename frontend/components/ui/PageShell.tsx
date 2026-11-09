import type { ReactNode } from "react";

/**
 * The frame of a page: a centred column that fits a phone (16 px gutter) and a laptop.
 *
 * `grid-cols-1` lets the column shrink below its widest word, and `overflow-wrap:anywhere`
 * lets a long unbroken word (a pasted link, a long email) break, instead of widening the
 * whole column past the screen where the page then clips it (reviews of #54 and #56).
 */
export function PageShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-4 px-4 py-6 [overflow-wrap:anywhere] sm:px-6">
      {title && <h1 className="text-2xl font-semibold text-text">{title}</h1>}
      {children}
    </main>
  );
}
