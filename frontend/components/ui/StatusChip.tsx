import { cx } from "@/lib/cx";
import { statusDot, statusLabel, type QuestionStatus } from "@/lib/status";

/**
 * A question's status: a coloured dot and the word (DESIGN.md, section 1). The word is always
 * shown, so colour is never the only signal. The words and the dot colours come from ONE table
 * (lib/status.ts).
 */
export function StatusChip({ status, className }: { status: QuestionStatus; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-xs", className)}>
      <span aria-hidden="true" className={cx("h-2 w-2 shrink-0 rounded-full", statusDot[status])} />
      {statusLabel[status]}
    </span>
  );
}
