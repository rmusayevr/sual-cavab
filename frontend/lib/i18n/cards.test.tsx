import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestionItem } from "@/components/QuestionItem";
import type { FullQuestion } from "@/lib/questions";
import { transitionKey } from "@/lib/questions";

import { setLanguage, translate, type Key, type Language } from "./index";

const answer = {
  id: 1,
  text: "Invented answer text.",
  answered_by: "Invented Person",
  answered_on: "2026-01-02",
  channel: "chat" as const,
  channel_note: "",
  recorded_by: "x@example.invalid",
  recorded_at: "2026-01-02T00:00:00Z",
  superseded_at: null,
};
const question = (status: FullQuestion["status"], extra: Partial<FullQuestion> = {}): FullQuestion => ({
  id: 1,
  number: 1,
  label: "Q1",
  text: "Invented question text?",
  why_it_matters: "Invented reason",
  blocks: "Invented task",
  status,
  created_at: "2026-01-01T00:00:00Z",
  current_answer: null,
  previous_answers: [],
  ...extra,
});

const show = (q: FullQuestion) =>
  render(
    <ul>
      <QuestionItem question={q} base="/api/projects/5/questions/" onChanged={() => {}} />
    </ul>,
  );

afterEach(() => {
  act(() => setLanguage("en"));
  localStorage.clear();
  vi.unstubAllGlobals();
});

// The selected-question card and its forms, in both languages, words looked up from the dictionary
// (#71). What a person typed (question text, reason, answer, names) is shown as typed.
for (const lang of ["en", "az"] as Language[]) {
  const t = (key: Key, values?: Record<string, string | number>) => translate(lang, key, values);

  describe(`the question card in ${lang}`, () => {
    it("labels the reason, what it blocks and the answers, and leaves typed text alone", () => {
      act(() => setLanguage(lang));
      show(question("answered", { current_answer: answer, previous_answers: [{ ...answer, id: 2, text: "Old invented answer." }] }));

      expect(screen.getByText(t("question.why", { text: "Invented reason" }))).toBeInTheDocument();
      expect(screen.getByText(t("question.blocks", { text: "Invented task" }))).toBeInTheDocument();
      expect(screen.getByText(t("question.answer"))).toBeInTheDocument();
      expect(screen.getByText(t("question.earlier"))).toBeInTheDocument();
      expect(screen.getAllByText(new RegExp(t("question.by", { who: "Invented Person" })))).toHaveLength(2);
      expect(screen.getByText("Invented question text?")).toBeInTheDocument();
      expect(screen.getByText("Invented answer text.")).toBeInTheDocument();
    });

    it("words each status change button and Edit in the language", () => {
      act(() => setLanguage(lang));
      show(question("open"));

      for (const to of ["asked", "answered", "dropped"] as const)
        expect(screen.getByRole("button", { name: t(transitionKey("open", to)) })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("question.edit") })).toBeInTheDocument();
    });

    it("words the buttons that undo a status in the language", () => {
      act(() => setLanguage(lang));
      for (const [from, expected] of [["asked", "transition.unask"], ["answered", "transition.reopen"], ["dropped", "transition.restore"]] as const) {
        const { unmount } = show(question(from));
        expect(screen.getByRole("button", { name: t(expected) })).toBeInTheDocument();
        unmount();
      }
    });

    it("words the edit form", () => {
      act(() => setLanguage(lang));
      show(question("open"));

      fireEvent.click(screen.getByRole("button", { name: t("question.edit") }));

      expect(screen.getByLabelText(t("form.question"))).toHaveValue("Invented question text?");
      expect(screen.getByLabelText(t("form.why"))).toBeInTheDocument();
      expect(screen.getByLabelText(t("form.blocks"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("question.save") })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("question.cancel") })).toBeInTheDocument();
    });

    it("words the answer form, its channels and its buttons", () => {
      act(() => setLanguage(lang));
      show(question("open"));

      fireEvent.click(screen.getByRole("button", { name: t("transition.recordAnswer") }));

      for (const key of ["answer.text", "answer.by", "answer.date", "answer.where", "answer.note"] as Key[])
        expect(screen.getByLabelText(t(key))).toBeInTheDocument();
      const where = screen.getByLabelText(t("answer.where"));
      for (const c of ["chat", "meeting", "email", "other"] as const)
        expect(within(where).getByRole("option", { name: t(`channel.${c}`) })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("answer.save") })).toBeInTheDocument();
    });

    it("says in the language that a failed status change could not reach the server", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
      show(question("open"));

      fireEvent.click(screen.getByRole("button", { name: t("transition.markAsked") }));

      expect(await screen.findByRole("alert")).toHaveTextContent(t("error.server"));
    });
  });
}

describe("the example's words", () => {
  it("are used for the card: Niyə vacibdir, Bloklayır, Cavabı qeyd et", () => {
    expect(translate("az", "form.why")).toBe("Niyə vacibdir");
    expect(translate("az", "question.blocks", { text: "x" })).toMatch(/^Bloklayır/);
    expect(translate("az", "transition.recordAnswer")).toBe("Cavabı qeyd et");
  });
});

// Review of #81: the first version of these tests only checked that each label exists, not which
// field it belongs to, and left the answer's channel word, Cancel, "Saving…" and the failure
// fallbacks unchecked.
for (const lang of ["en", "az"] as Language[]) {
  const t = (key: Key, values?: Record<string, string | number>) => translate(lang, key, values);
  const refused = () => vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

  describe(`the card's details in ${lang}`, () => {
    it("puts each label on its own field", () => {
      act(() => setLanguage(lang));
      show(question("open"));
      fireEvent.click(screen.getByRole("button", { name: t("question.edit") }));

      expect(screen.getByLabelText(t("form.why"))).toHaveValue("Invented reason");
      expect(screen.getByLabelText(t("form.blocks"))).toHaveValue("Invented task");
    });

    it("shows the channel an answer was given on with the form's own word for it", () => {
      act(() => setLanguage(lang));
      show(question("answered", { current_answer: { ...answer, channel: "email" } }));

      expect(screen.getByText(new RegExp(t("channel.email")))).toBeInTheDocument();
      expect(screen.queryByText(/ email$/)).not.toBeInTheDocument();
    });

    it("words the answer form's Cancel, and returns to the card", () => {
      act(() => setLanguage(lang));
      show(question("open"));
      fireEvent.click(screen.getByRole("button", { name: t("transition.recordAnswer") }));

      fireEvent.click(screen.getByRole("button", { name: t("question.cancel") }));

      expect(screen.getByRole("button", { name: t("question.edit") })).toBeInTheDocument();
    });

    it("says in the language that a refused status change failed", async () => {
      act(() => setLanguage(lang));
      refused();
      show(question("open"));

      fireEvent.click(screen.getByRole("button", { name: t("transition.markAsked") }));

      expect(await screen.findByRole("alert")).toHaveTextContent(t("error.changeStatus"));
    });

    it("says in the language that a refused save failed", async () => {
      act(() => setLanguage(lang));
      refused();
      show(question("open"));
      fireEvent.click(screen.getByRole("button", { name: t("question.edit") }));
      fireEvent.change(screen.getByLabelText(t("form.question")), { target: { value: "Changed invented text?" } });

      fireEvent.click(screen.getByRole("button", { name: t("question.save") }));

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(t("error.saveQuestion")));
    });

    it("shows the busy word on the save button while a save is running", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
      show(question("open"));
      fireEvent.click(screen.getByRole("button", { name: t("question.edit") }));
      fireEvent.change(screen.getByLabelText(t("form.question")), { target: { value: "Changed invented text?" } });

      fireEvent.click(screen.getByRole("button", { name: t("question.save") }));

      expect(await screen.findByRole("button", { name: t("question.saving") })).toBeDisabled();
    });
  });
}
