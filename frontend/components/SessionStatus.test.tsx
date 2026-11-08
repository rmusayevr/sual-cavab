import { fireEvent, render, screen } from "@testing-library/react";
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

  it("shows signed out after the backend confirms sign-out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/auth/me/"
        ? new Response(JSON.stringify({ id: 1, email: "ada@example.com", name: "" }), { status: 200 })
        : new Response(null, { status: 204 }),
    ));
    render(<SessionStatus />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("stays signed in and says so when the backend refuses sign-out", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url === "/api/auth/me/"
        ? new Response(JSON.stringify({ id: 1, email: "ada@example.com", name: "" }), { status: 200 })
        : new Response(JSON.stringify({ detail: "CSRF Failed" }), { status: 403 }),
    ));
    render(<SessionStatus />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-out failed. You are still signed in.");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("reports an unreachable server instead of claiming the user is signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));

    render(<SessionStatus />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });
});
