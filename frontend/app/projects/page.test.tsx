import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectsPage from "./page";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

// The projects page (#72): a navy header band with a carpet seam, then the ledger of projects.
describe("ProjectsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const quiet = () => vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

  it("has the page title as the one heading, in a navy header with a monospace eyebrow", () => {
    quiet();

    const { container } = render(<ProjectsPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Your projects" })).toBeInTheDocument();
    const header = container.querySelector("header")!;
    expect(header).toHaveClass("bg-navy");
    expect(within(header).getByText("Ledger")).toHaveClass("font-mono", "uppercase", "text-saffron");
  });

  // DESIGN.md section 4: "If a screen has more than one carpet strip visible, remove one." So the
  // page has EXACTLY one, the seam under the header, in every state it can be in (review of #76).
  const stubApi = (me: Response, projects: Response) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("/auth/me") ? me.clone() : projects.clone())));
  const user = () => json(200, { id: 1, email: "ada@example.com", name: "Ada Lovelace" });
  const project = { id: 1, name: "Ticketing", client_name: "Invented Client", description: "", my_role: "owner", open_question_count: 3 };

  it("has exactly one carpet strip while loading", () => {
    quiet();

    const { container } = render(<ProjectsPage />);

    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(1);
    expect(container.querySelector(".pattern-carpet")).toHaveAttribute("aria-hidden", "true");
  });

  it("has exactly one carpet strip with a list of projects and the new-project card", async () => {
    stubApi(user(), json(200, [project]));

    const { container } = render(<ProjectsPage />);

    await screen.findByRole("link", { name: "Ticketing" });
    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(1);
  });

  it("has exactly one carpet strip when the list is empty", async () => {
    stubApi(user(), json(200, []));

    const { container } = render(<ProjectsPage />);

    await screen.findByText(/not on any project yet/);
    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(1);
  });

  it("has exactly one carpet strip when signed out", async () => {
    stubApi(json(403, {}), json(403, {}));

    const { container } = render(<ProjectsPage />);

    await screen.findByText(/to see your projects/);
    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(1);
  });

  it("has one h1 and no other level-1 heading", async () => {
    stubApi(user(), json(200, [project]));

    render(<ProjectsPage />);

    await screen.findByRole("link", { name: "Ticketing" });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("keeps the wordmark link home and the session actions in the header", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/auth/me") ? json(200, { id: 1, email: "ada@example.com", name: "Ada Lovelace" }) : json(200, []),
      ),
    );

    const { container } = render(<ProjectsPage />);

    const header = container.querySelector("header")!;
    expect(within(header).getByRole("link", { name: /Sual.?Cavab/ })).toHaveAttribute("href", "/");
    expect(await within(header).findByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });
});
