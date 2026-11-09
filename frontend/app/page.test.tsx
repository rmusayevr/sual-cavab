import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { statusDot, statusLabel } from "@/lib/status";

import HomePage from "./page";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

// The landing page (#69), from the owner's design example. The sample questions and the sample
// message are invented text.
describe("HomePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const pending = () => vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

  it("asks the question the product answers, as the main heading", () => {
    pending();

    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "How many questions are still open?" })).toBeInTheDocument();
  });

  it("shows the product name as a wordmark that links home", () => {
    pending();

    render(<HomePage />);

    expect(screen.getByRole("link", { name: /Sual.?Cavab/ })).toHaveAttribute("href", "/");
  });

  it("offers a way to start and a link to the source, as a red button and an outline button", () => {
    pending();

    render(<HomePage />);

    expect(screen.getByRole("link", { name: "Start tracking" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Start tracking" })).toHaveClass("btn-primary");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/rmusayevr/sual-cavab");
    expect(screen.getByRole("link", { name: "GitHub" })).toHaveClass("btn-ghost");
  });

  it("shows a sample list of questions with numbers in monospace and the status words from the one table", () => {
    pending();

    render(<HomePage />);

    const list = screen.getByRole("list", { name: "Sample questions" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByText("Q1")).toHaveClass("font-mono");
    expect(within(rows[0]).getByText(statusLabel.open).firstElementChild).toHaveClass(statusDot.open);
    expect(within(rows[1]).getByText(statusLabel.asked).firstElementChild).toHaveClass(statusDot.asked);
    expect(within(rows[2]).getByText(statusLabel.answered).firstElementChild).toHaveClass(statusDot.answered);
  });

  it("lists the four things it does, numbered", () => {
    pending();

    render(<HomePage />);

    for (const title of ["Questions per project", "A clear status", "Open at a glance", "Drafted messages"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
    for (const n of ["01", "02", "03", "04"]) expect(screen.getByText(n)).toHaveClass("font-mono");
  });

  it("says the person reviews and sends, shows a sample message, and offers no way to send anything", () => {
    pending();

    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 2, name: "You review it. You send it." })).toBeInTheDocument();
    expect(screen.getByText(/Nothing leaves without you/)).toBeInTheDocument();
    const message = screen.getByText(/Salam, Leyla xanım!/).closest("blockquote")!;
    for (const term of ["refund", "admin", "support"]) expect(within(message).getByText(term).tagName).toBe("B");
    expect(screen.queryByRole("button", { name: /send|email|share|post/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send|email|share|post|mailto/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it("uses the carpet pattern only as strips that screen readers skip", () => {
    pending();

    const { container } = render(<HomePage />);

    const strips = container.querySelectorAll(".pattern-carpet");
    expect(strips.length).toBeGreaterThan(0);
    for (const strip of strips) {
      expect(strip).toHaveAttribute("aria-hidden", "true");
      expect(strip.className).toMatch(/\bh-(2|3)\b/); // 8 to 12 px tall: a strip, never a background
    }
    expect(container.querySelectorAll(".pattern-lattice").length).toBe(1);
    expect(container.querySelector(".pattern-lattice")).toHaveClass("bg-navy");
  });

  it("has a footer that names the licence", () => {
    pending();

    render(<HomePage />);

    expect(screen.getByRole("contentinfo")).toHaveTextContent("Sual-Cavab · MIT");
  });

  it("keeps the session actions in the header: sign in when signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { detail: "Authentication credentials were not provided." })));

    render(<HomePage />);

    const nav = screen.getByRole("navigation");
    expect(await within(nav).findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("keeps the session actions in the header: the projects and sign out when signed in", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { id: 1, email: "ada@example.com", name: "Ada Lovelace" })));

    render(<HomePage />);

    const nav = screen.getByRole("navigation");
    expect(await within(nav).findByRole("link", { name: "Your projects" })).toHaveAttribute("href", "/projects");
    expect(within(nav).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(within(nav).getByText(/Signed in as Ada Lovelace/)).toBeInTheDocument();
  });

  it("tells a visitor when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    render(<HomePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });
});
