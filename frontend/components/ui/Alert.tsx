import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A message above or below content. An error is announced to screen readers at once
 * (role="alert") and is shown in the pomegranate red, as emphasis (the example reserves
 * --destructive for destructive actions); information is announced politely (role="status")
 * and carries the saffron rule of the example's message card.
 */
export function Alert({
  tone = "info",
  className,
  children,
}: {
  tone?: "error" | "info";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-md border bg-card px-3 py-2 text-sm",
        tone === "error" ? "border-primary text-primary" : "border-l-4 border-l-saffron text-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
