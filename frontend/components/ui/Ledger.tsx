import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * Small pieces of the ledger look, for the screens the design example does not show (#72).
 * They follow the example's rules: the carpet is a thin strip and never a background, an eyebrow
 * is small monospace capitals, saffron text only on navy.
 */

/** A carpet-diamond strip, 8 px tall: a seam or the top of a card. Decoration only. */
export function CarpetStrip({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("h-2 pattern-carpet", className)} />;
}

/** The small label above a heading. Saffron on navy; the primary red on paper (saffron is 2:1 there). */
export function Eyebrow({
  tone = "paper",
  className,
  children,
}: {
  tone?: "paper" | "navy";
  className?: string;
  children: ReactNode;
}) {
  return (
    <p className={cx("font-mono text-xs uppercase tracking-[0.25em]", tone === "navy" ? "text-saffron" : "text-primary", className)}>
      {children}
    </p>
  );
}

/**
 * What is loading, and rows of the ledger that fill in (a pulse, off when the person asks for less
 * motion). The words stay: they are what a screen reader announces and what the tests look for.
 */
export function LedgerLoading({ label }: { label: string }) {
  return (
    <div role="status" className="grid gap-3">
      <p className="text-muted-foreground">{label}</p>
      <div aria-hidden="true" className="grid gap-2 motion-safe:animate-pulse">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-14 rounded-md border bg-card" />
        ))}
      </div>
    </div>
  );
}

/**
 * An empty or missing thing: a card under a carpet strip that says what to do next. The example
 * allows ONE carpet strip per screen: a page that already has one (a header seam) passes
 * `strip={false}` (review of #76).
 */
export function EmptyState({
  className,
  strip = true,
  children,
}: {
  className?: string;
  strip?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx("min-w-0 overflow-hidden rounded-md border bg-card text-card-foreground shadow-card", className)}>
      {strip && <CarpetStrip />}
      <div className="grid gap-3 p-5 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}
