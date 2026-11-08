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
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const members = [
  { user_id: 1, email: "owner@example.com", name: "Olga Owner", role: "owner", added_at: "2026-01-01T00:00:00Z" },
  { user_id: 2, email: "member@example.com", name: "", role: "member", added_at: "2026-01-02T00:00:00Z" },
];

describe("ProjectDetail", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the project and its members", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/members/") ? json(200, members) : json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.getByText(/Olga Owner · owner/)).toBeInTheDocument();
    expect(screen.getByText(/member@example.com · member/)).toBeInTheDocument();
  });

  it("shows not found for a project the backend hides", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(404, { detail: "No Project matches the given query." })));

    render(<ProjectDetail />);

    expect(await screen.findByText(/Project not found/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to your projects" })).toHaveAttribute("href", "/projects");
  });

  it("reports a failed load instead of showing a half-empty page", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.endsWith("/members/") ? json(500, {}) : json(200, project))));

    render(<ProjectDetail />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the project.");
  });

  it("shows a loading message first", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ProjectDetail />);

    expect(screen.getByText("Loading project…")).toBeInTheDocument();
  });
});
