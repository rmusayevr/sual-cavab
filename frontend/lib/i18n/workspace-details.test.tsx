import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Workspace from "@/components/Workspace";

import { setLanguage, translate, type Key, type Language } from "./index";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const project = { id: 5, name: "Ticketing", client_name: "Invented Client", description: "", my_role: "owner", open_question_count: 2, created_at: "", updated_at: "" };
const q = (n: number, status: string) => ({
  id: n,
  number: n,
  label: `Q${n}`,
  text: `Invented question ${n}`,
  why_it_matters: "",
  blocks: "",
  status,
  created_at: "2026-01-01T00:00:00Z",
  current_answer: null,
  previous_answers: [],
});
const members = [
  { user_id: 1, email: "owner@example.invalid", name: "Olga Owner", role: "owner", added_at: "" },
  { user_id: 2, email: "member@example.invalid", name: "", role: "member", added_at: "" },
];

function api(draftStatus = 200, draftBody: unknown = { draft: "Invented draft." }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/draft/")) return json(draftStatus, draftBody);
      if (url.includes("/questions/")) return json(200, [q(1, "open"), q(2, "answered")]);
      if (url.endsWith("/members/")) return json(200, members);
      return json(200, [project]);
    }),
  );
}

afterEach(() => {
  act(() => setLanguage("en"));
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// The members, the ages and the drafting messages of the workspace in both languages (#83), with the
// words looked up from the dictionary.
for (const lang of ["en", "az"] as Language[]) {
  const t = (key: Key, values?: Record<string, string | number>) => translate(lang, key, values);

  describe(`the workspace's members and ages in ${lang}`, () => {
    it("names the member list and each role in the language", async () => {
      act(() => setLanguage(lang));
      api();
      render(<Workspace />);

      const list = await screen.findByRole("list", { name: t("members.label") });
      expect(within(list).getByText(`Olga Owner · ${t("role.owner")}`)).toBeInTheDocument();
      expect(within(list).getByText(`member@example.invalid · ${t("role.member")}`)).toBeInTheDocument();
    });

    it("words the age of an open question in the language", async () => {
      act(() => setLanguage(lang));
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-04T12:00:00Z"));
      api();
      render(<Workspace />);

      const row = (await screen.findByText("Invented question 1")).closest("li")!;
      expect(within(row).getByText(t("age.many", { n: 3 }))).toBeInTheDocument();
    });

    it("words a refused draft in the language: the server says drafting is not set up", async () => {
      act(() => setLanguage(lang));
      api(503, {});
      render(<Workspace />);
      fireEvent.click(await screen.findByRole("checkbox", { name: t("workspace.pick", { label: "Q1" }) }));

      fireEvent.click(screen.getByRole("button", { name: t("draft.write") }));

      expect(await screen.findByRole("alert")).toHaveTextContent(t("draft.err.noSetup"));
    });
  });
}

describe("a drafting message already on screen", () => {
  it("follows a change of language, and the server's own validation text is shown as the server wrote it", async () => {
    api(400, { questions: ["Not open or asked in this project: Q9."] });
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: translate("en", "workspace.pick", { label: "Q1" }) }));
    fireEvent.click(screen.getByRole("button", { name: translate("en", "draft.write") }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not open or asked in this project: Q9.");

    act(() => setLanguage("az"));

    expect(screen.getByRole("alert")).toHaveTextContent("Not open or asked in this project: Q9.");
  });

  it("changes our own message when the language changes after it appeared", async () => {
    api(429, {});
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: translate("en", "workspace.pick", { label: "Q1" }) }));
    fireEvent.click(screen.getByRole("button", { name: translate("en", "draft.write") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(translate("en", "draft.err.rateLimited"));

    act(() => setLanguage("az"));

    expect(screen.getByRole("alert")).toHaveTextContent(translate("az", "draft.err.rateLimited"));
  });
});
