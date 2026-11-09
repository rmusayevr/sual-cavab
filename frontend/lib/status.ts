/**
 * The four question statuses and how each is shown. ONE table, so a label and its colour
 * cannot drift apart (DESIGN.md, section 1). The labels are English for now; the language
 * layer (#71) turns this into one table per language and keeps the dot classes.
 */
import type { QuestionStatus } from "./projects";

export type { QuestionStatus };

export const STATUSES: QuestionStatus[] = ["open", "asked", "answered", "dropped"];

export const statusLabel: Record<QuestionStatus, string> = {
  open: "Open",
  asked: "Asked",
  answered: "Answered",
  dropped: "Dropped",
};

/** The colour of the dot beside the word; a token class, never a literal colour. */
export const statusDot: Record<QuestionStatus, string> = {
  open: "bg-status-open",
  asked: "bg-status-asked",
  answered: "bg-status-answered",
  dropped: "bg-status-dropped",
};
