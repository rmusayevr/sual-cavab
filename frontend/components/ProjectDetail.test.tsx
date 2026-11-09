import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectDetail from "./ProjectDetail";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const project = {
  id: 5,
  name: "Ticketing",
  client_name: "Invented Client",
  description: "Refund rules and date changes.",
  my_role: "member",
  open_question_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const members = [
  { user_id: 1, email: "owner@example.com", name: "Olga Owner", role: "owner", added_at: "2026-01-01T00:00:00Z" },
  { user_id: 2, email: "member@example.com", name: "", role: "member", added_at: "2026-01-02T00:00:00Z" },
];

const openQuestion = {
  id: 1,
  number: 1,
  label: "Q1",
  text: "Which payment providers are allowed?",
  why_it_matters: "",
  blocks: "Checkout",
  status: "open",
  created_at: "2026-01-01T00:00:00Z",
};

/** Members, questions or the project, by URL. */
function answer(url: string, fallback: Response): Response {
  if (url.endsWith("/members/")) return json(200, members);
  if (url.includes("/questions/")) return json(200, [openQuestion]);
  return fallback;
}

describe("ProjectDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the project and its members", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url, json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.getByText(/Olga Owner · owner/)).toBeInTheDocument();
    expect(screen.getByText(/member@example.com · member/)).toBeInTheDocument();
  });

  it("shows what the project is still waiting on", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url, json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("heading", { name: /still open \(1\)/i })).toBeInTheDocument();
    expect(screen.getByText(/Which payment providers are allowed\?/)).toBeInTheDocument();
    expect(screen.getByText(/Blocks: Checkout/)).toBeInTheDocument();
  });

  it("links to the screen that drafts a message from the open questions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url, json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("link", { name: "Draft a message" })).toHaveAttribute("href", "/projects/5/draft");
  });

  it("links to the screen where questions are added, edited and answered", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url, json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("link", { name: "Manage questions" })).toHaveAttribute(
      "href",
      "/projects/5/questions",
    );
  });

  it("shows not found for a project the backend hides", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { detail: "No Project matches the given query." })));

    render(<ProjectDetail />);

    expect(await screen.findByText(/Project not found/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your projects" })).toHaveAttribute("href", "/projects");
  });

  it("reports a failed load instead of showing a half-empty page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/members/") ? json(500, {}) : answer(url, json(200, project)))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the project.");
  });

  it("shows a loading message first", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ProjectDetail />);

    expect(screen.getByText("Loading project…")).toBeInTheDocument();
  });
});

describe("ProjectDetail look (#55)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("offers the two actions as links that are easy to tap", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url, json(200, project))));

    render(<ProjectDetail />);

    for (const name of ["Manage questions", "Draft a message"]) {
      expect(await screen.findByRole("link", { name })).toHaveClass("min-h-11");
    }
  });

  it("shows the question's status as a chip with the word in it", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => answer(url, json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByText("Open")).toHaveClass("rounded-full");
  });

  it("a project that is not found says so and links back, as a message and not an error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, {})));

    render(<ProjectDetail />);

    expect(await screen.findByText(/Project not found/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your projects" })).toHaveAttribute("href", "/projects");
  });
});
