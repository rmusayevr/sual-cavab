import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import NotFound from "@/app/not-found";
import ProjectsPage from "@/app/projects/page";

import { setLanguage, translate, type Key, type Language } from "./index";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const page = (results: unknown[], count = results.length) => ({ count, page: 1, page_size: 25, results });
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
      // question text is the ledger entry: English in both languages, like a typed question
      expect(within(list).getByText("Who can issue a refund — only admins, or support too?")).toBeInTheDocument();
      expect(within(list).getAllByText(t("status.open"), { exact: false })).toHaveLength(3);
      for (const key of ["landing.eyebrow", "landing.lead", "landing.f1.title", "landing.f1.text", "landing.f2.title", "landing.f2.text", "landing.f3.title", "landing.f3.text", "landing.f4.title", "landing.f4.text", "landing.review.title", "landing.review.text"] as Key[])
        expect(screen.getByText(t(key)), key).toBeInTheDocument();
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
          url.includes("/auth/me") ? json(200, { id: 1, email: "a@example.invalid", name: "Ada" }) : json(200, page([project(1, "owner", 3), project(2, "member", 0)])),
        ),
      );

      render(<ProjectsPage />);

      expect(screen.getByRole("heading", { level: 1, name: t("projects.title") })).toBeInTheDocument();
      expect(screen.getByText(t("projects.lead"))).toBeInTheDocument();
      expect(await screen.findByText(`Invented client 1 ${t("projects.owner")} · ${t("projects.stillOpen", { n: 3 })}`)).toBeInTheDocument();
      // a member's row does not say owner
      expect(screen.getByText(`Invented client 2 · ${t("projects.stillOpen", { n: 0 })}`)).toBeInTheDocument();
      expect(screen.getByText("Invented project 1")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: t("projects.newTitle") })).toBeInTheDocument();
      expect(screen.getByLabelText(t("projects.name"))).toBeInTheDocument();
      expect(screen.getByLabelText(t("projects.client"))).toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("projects.create") })).toBeInTheDocument();
    });

    it("puts the sign-in button where the language's sentence wants it, with the spaces kept", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal("fetch", vi.fn(async () => json(401, {})));

      render(<ProjectsPage />);

      const links = await screen.findAllByRole("link", { name: t("session.signIn") });
      const sentence = links.at(-1)!.parentElement!;
      expect(sentence.textContent).toBe(t("projects.signInLine").replace("{link}", t("session.signIn")));
    });

    it("says in the language that the projects could not be loaded", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("/auth/me") ? json(200, { id: 1, email: "a@example.invalid", name: "Ada" }) : json(500, {}))));

      render(<ProjectsPage />);

      expect(await screen.findByText(t("projects.loadError"))).toBeInTheDocument();
    });

    it("says in the language that the server could not be reached when creating a project", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init?: RequestInit) => {
          if (url.includes("/auth/me")) return json(200, { id: 1, email: "a@example.invalid", name: "Ada" });
          if (init?.method === "POST") throw new Error("offline");
          return json(200, page([]));
        }),
      );
      render(<ProjectsPage />);
      await screen.findByText(t("projects.empty"));
      fireEvent.change(screen.getByLabelText(t("projects.name")), { target: { value: "Invented" } });
      fireEvent.change(screen.getByLabelText(t("projects.client")), { target: { value: "Invented" } });

      fireEvent.click(screen.getByRole("button", { name: t("projects.create") }));

      expect(await screen.findByRole("alert")).toHaveTextContent(t("error.server"));
    });

    it("says in the language that the person is on no project", async () => {
      act(() => setLanguage(lang));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => (url.includes("/auth/me") ? json(200, { id: 1, email: "a@example.invalid", name: "Ada" }) : json(200, page([])))),
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
          return json(200, page([]));
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

describe("an error already on screen", () => {
  it("follows the language when it is changed afterwards", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/auth/me")) return json(200, { id: 1, email: "a@example.invalid", name: "Ada" });
        if (init?.method === "POST") return json(400, {});
        return json(200, page([]));
      }),
    );
    render(<ProjectsPage />);
    await screen.findByText(translate("en", "projects.empty"));
    fireEvent.change(screen.getByLabelText(translate("en", "projects.name")), { target: { value: "Invented" } });
    fireEvent.change(screen.getByLabelText(translate("en", "projects.client")), { target: { value: "Invented" } });
    fireEvent.click(screen.getByRole("button", { name: translate("en", "projects.create") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(translate("en", "projects.createFailed"));

    act(() => setLanguage("az"));

    expect(screen.getByRole("alert")).toHaveTextContent(translate("az", "projects.createFailed"));
  });
});
