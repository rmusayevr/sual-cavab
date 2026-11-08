import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SessionStatus from "./SessionStatus";

const respond = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

describe("SessionStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading message before the session is known", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<SessionStatus />);

    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
  });

  it("shows who is signed in", async () => {
    vi.stubGlobal("fetch", respond(200, { id: 1, email: "ada@example.com", name: "Ada Lovelace" }));

    render(<SessionStatus />);

    expect(await screen.findByText(/Signed in as Ada Lovelace/)).toBeInTheDocument();
  });

  it("falls back to the email when the user has no name", async () => {
    vi.stubGlobal("fetch", respond(200, { id: 1, email: "ada@example.com", name: "" }));

    render(<SessionStatus />);

    expect(await screen.findByText(/Signed in as ada@example.com/)).toBeInTheDocument();
  });

  it("links to sign-in when the backend refuses an anonymous user", async () => {
    vi.stubGlobal("fetch", respond(403, { detail: "Authentication credentials were not provided." }));

    render(<SessionStatus />);

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("reports an unreachable server instead of claiming the user is signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));

    render(<SessionStatus />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });
});
