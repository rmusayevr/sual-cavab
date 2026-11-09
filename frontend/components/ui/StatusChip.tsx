import { cx } from "@/lib/cx";

export type QuestionStatus = "open" | "asked" | "answered" | "dropped";

const chips: Record<QuestionStatus, { label: string; classes: string }> = {
  open: { label: "Open", classes: "bg-open-bg text-open-fg" },
  asked: { label: "Asked", classes: "bg-asked-bg text-asked-fg" },
  answered: { label: "Answered", classes: "bg-answered-bg text-answered-fg" },
  dropped: { label: "Dropped", classes: "bg-dropped-bg text-dropped-fg" },
};

/** A question's status. The word is always shown: colour alone is never the signal. */
export function StatusChip({ status, className }: { status: QuestionStatus; className?: string }) {
  const chip = chips[status];
  return (
    <span
      className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", chip.classes, className)}
    >
      {chip.label}
    </span>
  );
}
