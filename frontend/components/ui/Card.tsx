import type { HTMLAttributes } from "react";

import { cx } from "@/lib/cx";

/** A raised block on the page background: a project, a question, a form. */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-xl border border-border bg-surface p-4 sm:p-5", className)} {...rest} />;
}
