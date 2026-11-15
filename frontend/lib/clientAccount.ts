/** What the screens of a client account read from the server (#121): their projects, and a project's open questions. */

export type ClientProject = { id: number; name: string };

export type OwnAnswer = { text: string; state: "pending" | "accepted"; submitted_at: string };

export type ClientAccountQuestion = {
  number: number;
  label: string;
  text: string;
  why_it_matters: string;
  blocks: string;
  /** What this person already sent for it. Theirs only. */
  mine: OwnAnswer[];
};

/** This person's own answer on a question that has since closed. Never the team's answer. */
export type EarlierAnswer = { label: string; question_text: string; text: string; state: "pending" | "accepted" };

export type ClientAccountView = {
  project_name: string;
  questions: ClientAccountQuestion[];
  earlier: EarlierAnswer[];
};
