import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound, { metadata } from "./not-found";

// The 404 page (#72): a ledger joke the owner can accept or reject, in the example's own language.
describe("NotFound", () => {
  it("says the page is not in the ledger, in a heading", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { level: 1, name: "This page is not in the ledger." })).toBeInTheDocument();
  });

  it("has a tab title that says the page was not found (WCAG 2.4.2), not just the product name", () => {
    expect(String(metadata.title)).toMatch(/not found/i);
    expect(String(metadata.title)).toMatch(/Sual-Cavab/);
  });

  it("names the missing 'question' as Q404, in monospace", () => {
    render(<NotFound />);

    expect(screen.getByText("Q404")).toHaveClass("font-mono");
  });

  it("offers the way back as a button-looking link", () => {
    render(<NotFound />);

    const link = screen.getByRole("link", { name: "Back to your projects" });
    expect(link).toHaveAttribute("href", "/projects");
    expect(link).toHaveClass("btn-primary", "min-h-11");
  });

  it("is a navy lattice page with one carpet strip", () => {
    const { container } = render(<NotFound />);

    expect(container.querySelector(".pattern-lattice")).toHaveClass("bg-navy");
    expect(container.querySelectorAll(".pattern-carpet").length).toBe(1);
  });
});
