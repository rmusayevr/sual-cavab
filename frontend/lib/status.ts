/**
 * The four question statuses and how each is shown. ONE table, so a label and its colour
 * cannot drift apart (DESIGN.md, section 1). The labels are English for now; the language
 * layer (#71) turns this into one table per language and keeps the dot classes.
 */
import { en } from "./i18n/en";
import type { QuestionStatus } from "./projects";

export type { QuestionStatus };

export const STATUSES: QuestionStatus[] = ["open", "asked", "answered", "dropped"];

/**
 * The English words, taken from the dictionary (lib/i18n): the words live there, one set per
 * language, so there is no second table to drift. Screens show `t(`status.${status}`)`.
 */
export const statusLabel: Record<QuestionStatus, string> = {
  open: en["status.open"],
  asked: en["status.asked"],
  answered: en["status.answered"],
  dropped: en["status.dropped"],
};

/** The colour of the dot beside the word; a token class, never a literal colour. */
export const statusDot: Record<QuestionStatus, string> = {
  open: "bg-status-open",
  asked: "bg-status-asked",
  answered: "bg-status-answered",
  dropped: "bg-status-dropped",
};
