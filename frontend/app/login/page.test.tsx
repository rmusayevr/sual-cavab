import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LoginPage from "./page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

// The sign-in page (#72): the owner asked for invention where the example shows nothing, inside
// the example's rules. A navy lattice page with a ledger card.
describe("LoginPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the one page with a heading 'Sign in', the sentence about accounts, and the form", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Accounts are created by an administrator.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("has the wordmark as a link home, so a visitor is never stuck here", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: /Sual.?Cavab/ })).toHaveAttribute("href", "/");
  });

  it("is a navy page on the lattice (the one pattern allowed over a whole surface, and only on navy)", () => {
    const { container } = render(<LoginPage />);

    const lattice = container.querySelector(".pattern-lattice")!;
    expect(lattice).toHaveClass("bg-navy");
    expect(lattice.tagName).toBe("MAIN");
  });

  it("puts the form on a cream ledger card topped by a carpet strip, with a monospace eyebrow", () => {
    const { container } = render(<LoginPage />);

    const card = container.querySelector(".bg-card")!;
    expect(card.firstElementChild).toHaveClass("pattern-carpet");
    expect(card.firstElementChild).toHaveAttribute("aria-hidden", "true");
    expect(within(card as HTMLElement).getByText("Access")).toHaveClass("font-mono", "uppercase");
    expect(within(card as HTMLElement).getByLabelText("Email")).toBeInTheDocument();
  });

  it("has no carpet strip anywhere else (one per screen)", () => {
    const { container } = render(<LoginPage />);

    expect(container.querySelectorAll(".pattern-carpet").length).toBe(1);
  });
});
