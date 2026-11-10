import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import NotFound from "@/app/not-found";
import ProjectsPage from "@/app/projects/page";

import { setLanguage, translate, type Key, type Language } from "./index";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const project = (id: number, role: "owner" | "member", open: number) => ({
  id,
  name: `Invented project ${id}`,
  client_name: `Invented client ${id}`,
  description: "",
  my_role: role,
  open_question_count: open,
  created_at: "",
  updated_at: "",
});

afterEach(() => {
  act(() => setLanguage("en"));
  localStorage.clear();
  vi.unstubAllGlobals();
});

// The landing page, the projects page and the 404 in both languages, words from the dictionary (#71).
for (const lang of ["en", "az"] as Language[]) {
  const t = (key: Key, values?: Record<string, string | number>) => translate(lang, key, values);
  const pending = () => vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

  describe(`the landing page in ${lang}`, () => {
    it("asks its question, offers the start button and labels the sample list", () => {
      act(() => setLanguage(lang));
      pending();

      render(<HomePage />);

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(t("landing.h1a").trim() + " " + t("landing.h1b"));
      expect(screen.getByRole("link", { name: t("landing.start") })).toHaveAttribute("href", "/projects");
      const list = screen.getByRole("list", { name: t("landing.sample") });
      expect(within(list).getByText(t("landing.q1"))).toBeInTheDocument();
      expect(within(list).getAllByText(t("status.open"), { exact: false })).toHaveLength(3);
      expect(screen.getByText(t("landing.f4.title"))).toBeInTheDocument();
      expect(screen.getByText(t("landing.review.title"))).toBeInTheDocument();
    });

    it("shows the sample message the same in both languages, as drafted", () => {
      act(() => setLanguage(lang));
      pending();

      render(<HomePage />);

      expect(screen.getByText(/Salam, Leyla xanım!/)).toBeInTheDocument();
    });
  });

  describe(`the projects page in ${lang}`, () => {
    it("titles the page and lists a project with its own words", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("/auth/me") ? json(200, { id: 1, email: "a@example.invalid", name: "Ada" }) : json(200, [project(1, "owner", 3), project(2, "member", 0)]),
        ),
      );

      render(<ProjectsPage />);

      expect(screen.getByRole("heading", { level: 1, name: t("projects.title") })).toBeInTheDocument();
      expect(screen.getByText(t("projects.lead"))).toBeInTheDocument();
      expect(await screen.findByText(new RegExp(`${t("projects.owner").trim()}.*${t("projects.stillOpen", { n: 3 })}`))).toBeInTheDocument();
      expect(screen.getByText("Invented project 1")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: t("projects.newTitle") })).toBeInTheDocument();
      expect(screen.getByLabelText(t("projects.name"))).toBeInTheDocument();
      expect(screen.getByLabelText(t("projects.client"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("projects.create") })).toBeInTheDocument();
    });

    it("says in the language that the person is on no project", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => (url.includes("/auth/me") ? json(200, { id: 1, email: "a@example.invalid", name: "Ada" }) : json(200, []))),
      );

      render(<ProjectsPage />);

      expect(await screen.findByText(t("projects.empty"))).toBeInTheDocument();
    });

    it("says in the language that creating a project failed", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.includes("/auth/me")) return json(200, { id: 1, email: "a@example.invalid", name: "Ada" });
          if (init?.method === "POST") return json(400, {});
          return json(200, []);
        }),
      );
      render(<ProjectsPage />);
      await screen.findByText(t("projects.empty"));
      fireEvent.change(screen.getByLabelText(t("projects.name")), { target: { value: "Invented" } });
      fireEvent.change(screen.getByLabelText(t("projects.client")), { target: { value: "Invented" } });

      fireEvent.click(screen.getByRole("button", { name: t("projects.create") }));

      expect(await screen.findByRole("alert")).toHaveTextContent(t("projects.createFailed"));
    });
  });

  describe(`the 404 page in ${lang}`, () => {
    it("says the page is not in the ledger and offers the way back", () => {
      act(() => setLanguage(lang));

      render(<NotFound />);

      expect(screen.getByRole("heading", { level: 1, name: t("notfound.title") })).toBeInTheDocument();
      expect(screen.getByText(t("notfound.text"))).toBeInTheDocument();
      expect(screen.getByRole("link", { name: t("workspace.back") })).toHaveAttribute("href", "/projects");
    });
  });
}
