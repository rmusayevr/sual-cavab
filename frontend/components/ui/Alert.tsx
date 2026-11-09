import type { ReactNode } from "react";

import { cx } from "@/lib/cx";

/**
 * A message above or below content. An error is announced to screen readers at
 * once (role="alert"); information is announced politely (role="status").
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
        "rounded-lg border px-3 py-2 text-sm",
        tone === "error" ? "border-error-fg bg-error-bg text-error-fg" : "border-asked-fg bg-asked-bg text-asked-fg",
        className,
      )}
    >
      {children}
    </div>
  );
}
