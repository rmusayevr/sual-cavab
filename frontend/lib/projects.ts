import type { Key } from "./i18n/en";

export type Role = "owner" | "member";

export type Project = {
  id: number;
  name: string;
  client_name: string;
  description: string;
  my_role: Role | null;
  open_question_count: number;
  created_at: string;
  updated_at: string;
};

export type Member = {
  user_id: number;
  email: string;
  name: string;
  role: Role;
  added_at: string;
};

export type QuestionStatus = "open" | "asked" | "answered" | "dropped";

/** A question as the lists show it: its number, text, why it matters, what it blocks, its status and when it was made. */
export type Question = {
  id: number;
  number: number;
  label: string;
  text: string;
  why_it_matters: string;
  blocks: string;
  status: QuestionStatus;
  created_at: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since `createdAt`, never negative (a clock a little behind the server). */
export function daysOpen(createdAt: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / DAY_MS));
}

/** The dictionary key and values for how long a question has been open ("open for 3 days"), so a screen can show it in the chosen language. */
export function ageKey(days: number): { key: Key; values?: { n: number } } {
  if (days === 0) return { key: "age.zero" };
  return days === 1 ? { key: "age.one" } : { key: "age.many", values: { n: days } };
}
