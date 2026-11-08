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

/** The part of a question the Still open view shows. */
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

export function ageText(days: number): string {
  if (days === 0) return "open for less than a day";
  return days === 1 ? "open for 1 day" : `open for ${days} days`;
}
