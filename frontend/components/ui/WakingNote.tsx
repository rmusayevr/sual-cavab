"use client";

import { cx } from "@/lib/cx";
import { en } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n";
import { useAfterDelay } from "@/lib/useAfterDelay";

/**
 * Why the wait is long (#38). The free staging services sleep after 15 idle minutes; measured, the
 * first request then takes about 33 s (web) and 83 to 93 s (API), and a warm one 0.1 s. After five
 * seconds of waiting, say so. The wording is one constant so the language layer (#71) can swap it.
 */
/** The English wording; the note itself shows the chosen language. */
export const WAKING_TEXT = en["waking"];

export function WakingNote({
  active,
  tone = "paper",
  className,
}: {
  active: boolean;
  /** "navy" inherits the header's light text, so it reads on navy. */
  tone?: "paper" | "navy";
  className?: string;
}) {
  const slow = useAfterDelay(active);
  const t = useT();
  if (!slow) return null;
  return (
    <p role="status" className={cx("text-sm", tone === "navy" ? "opacity-80" : "text-muted-foreground", className)}>
      {t("waking")}
    </p>
  );
}
