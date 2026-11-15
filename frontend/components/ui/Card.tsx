import type { HTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/**
 * A raised block on the page background: a project, a question, a form. `min-w-0` and
 * `overflow-wrap:anywhere` let a long unbroken word (a pasted link) wrap instead of widening
 * the page past a phone screen (reviews of #54 and #56).
 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "min-w-0 rounded-md border bg-card p-4 text-card-foreground shadow-card [overflow-wrap:anywhere] sm:p-5",
        className,
      )}
      {...rest}
    />
  );
}
