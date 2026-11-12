import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LoginForm from "@/components/LoginForm";
import SessionStatus from "@/components/SessionStatus";
import Workspace from "@/components/Workspace";
import { StatusChip } from "@/components/ui/StatusChip";
import { WakingNote } from "@/components/ui/WakingNote";
import LoginPage from "@/app/login/page";
import { statusLabel } from "@/lib/status";

import { en } from "./en";
import { setLanguage, translate, type Key, type Language } from "./index";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }), usePathname: () => "/projects/5", useRouter: () => ({ replace: () => {} }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const page = (results: unknown[], count = results.length) => ({ count, page: 1, page_size: 25, results });
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
const project = { id: 5, name: "Ticketing", client_name: "Invented Client", description: "", my_role: "owner", open_question_count: 2, created_at: "", updated_at: "" };

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/draft/")) return json(200, { draft: "Invented draft text." });
      if (url.includes("/questions/")) return json(200, [q(1, "open"), q(2, "asked"), q(3, "answered"), q(4, "dropped")]);
      if (url.includes("/auth/me")) return json(200, { id: 1, email: "ada@example.invalid", name: "Ada" });
      return /^\/api\/projects\/\d+\/$/.test(url) ? json(200, project) : json(200, page([project]));
    }),
  );
});

afterEach(() => {
  act(() => setLanguage("en"));
  localStorage.clear();
  vi.unstubAllGlobals();
});

// Each screen is checked in both languages with words looked up from the dictionary itself, so the
// test cannot drift from what the screen says (#71).
for (const lang of ["en", "az"] as Language[]) {
  const t = (key: Key, values?: Record<string, string | number>) => translate(lang, key, values);

  describe(`the workspace in ${lang}`, () => {
    beforeEach(() => act(() => setLanguage(lang)));

    it("shows the four statuses, the filters and the headings in the language", async () => {
      render(<Workspace />);

      expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
      const filters = screen.getByRole("group", { name: t("workspace.filterGroup") });
      for (const label of [t("workspace.all"), t("status.open"), t("status.asked"), t("status.answered"), t("status.dropped")])
        expect(within(filters).getByRole("button", { name: label })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: t("workspace.add") })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: t("draft.heading") })).toBeInTheDocument();
      expect(screen.getByRole("navigation", { name: t("session.yourProjects") })).toBeInTheDocument();
      expect(screen.getByText(t("workspace.selectPrompt"))).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: t("workspace.pick", { label: "Q1" }) })).toBeEnabled();
    });

    it("writes the draft panel's words, its notice and its buttons in the language", async () => {
      render(<Workspace />);
      fireEvent.click(await screen.findByRole("checkbox", { name: t("workspace.pick", { label: "Q1" }) }));

      expect(screen.getByText(t("draft.tickedOne", { list: "Q1" }))).toBeInTheDocument();
      expect(screen.getByText(t("draft.notice"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t("draft.write") }));

      expect(await screen.findByLabelText(t("draft.label"))).toHaveValue("Invented draft text.");
      expect(screen.getByRole("button", { name: t("draft.copy") })).toBeInTheDocument();
      expect(screen.getByText(t("draft.notSent"))).toBeInTheDocument();
      // what the person (or the model) wrote is never translated
      expect(screen.getByText("Invented question 1")).toBeInTheDocument();
    });
  });

  describe(`the session status in ${lang}`, () => {
    beforeEach(() => act(() => setLanguage(lang)));

    it("says who is signed in and offers the actions in the language", async () => {
      render(<SessionStatus />);

      expect(await screen.findByText(t("session.signedInAs", { who: "Ada" }))).toBeInTheDocument();
      expect(screen.getByRole("link", { name: t("session.yourProjects") })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("session.signOut") })).toBeInTheDocument();
    });

    it("says it is checking while it waits", () => {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

      render(<SessionStatus />);

      expect(screen.getByText(t("session.checking"))).toBeInTheDocument();
    });
  });

  describe(`signing in in ${lang}`, () => {
    beforeEach(() => act(() => setLanguage(lang)));

    it("labels the form and the button in the language", () => {
      render(<LoginForm />);

      expect(screen.getByLabelText(t("login.email"))).toBeInTheDocument();
      expect(screen.getByLabelText(t("login.password"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("login.submit") })).toBeInTheDocument();
    });

    it("explains a wrong password in the language", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => json(400, {})));
      render(<LoginForm />);
      fireEvent.change(screen.getByLabelText(t("login.email")), { target: { value: "ada@example.invalid" } });
      fireEvent.change(screen.getByLabelText(t("login.password")), { target: { value: "x" } });

      fireEvent.click(screen.getByRole("button", { name: t("login.submit") }));

      expect(await screen.findByRole("alert")).toHaveTextContent(t("login.incorrect"));
    });

    it("has the page's own words and the switch", () => {
      render(<LoginPage />);

      expect(screen.getByRole("heading", { level: 1, name: t("login.title") })).toBeInTheDocument();
      expect(screen.getByText(t("login.note"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "AZ" })).toBeInTheDocument();
    });
  });

  describe(`the status chip and the wake note in ${lang}`, () => {
    beforeEach(() => act(() => setLanguage(lang)));

    it("shows each status with its word from the one table", () => {
      for (const s of ["open", "asked", "answered", "dropped"] as const) {
        const { unmount } = render(<StatusChip status={s} />);
        expect(screen.getByText(t(`status.${s}`))).toBeInTheDocument();
        unmount();
      }
    });

    it("explains the wait after five seconds", () => {
      vi.useFakeTimers();
      try {
        render(<WakingNote active />);
        act(() => vi.advanceTimersByTime(5000));
        expect(screen.getByText(t("waking"))).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });
  });
}

describe("one table of status words", () => {
  it("keeps the exported English labels equal to the English dictionary", () => {
    expect(statusLabel).toEqual({
      open: en["status.open"],
      asked: en["status.asked"],
      answered: en["status.answered"],
      dropped: en["status.dropped"],
    });
  });
});
