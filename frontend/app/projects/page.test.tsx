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

  it("separates the header from the list with one carpet strip", () => {
    quiet();

    const { container } = render(<ProjectsPage />);

    expect(container.querySelectorAll(".pattern-carpet").length).toBeGreaterThanOrEqual(1);
    for (const strip of container.querySelectorAll(".pattern-carpet")) expect(strip).toHaveAttribute("aria-hidden", "true");
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
