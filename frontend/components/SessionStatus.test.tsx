import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import SessionStatus from "./SessionStatus";
import { WAKING_TEXT } from "./ui/WakingNote";

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

  it("shows signed out when sign-out is refused because the session already ended", async () => {
    let meCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/auth/me/") {
        meCalls += 1;
        return meCalls === 1
          ? new Response(JSON.stringify({ id: 1, email: "ada@example.com", name: "" }), { status: 200 })
          : new Response(JSON.stringify({ detail: "Authentication credentials were not provided." }), { status: 403 });
      }
      return new Response(JSON.stringify({ detail: "Authentication credentials were not provided." }), { status: 403 });
    }));
    render(<SessionStatus />);

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an unreachable server instead of claiming the user is signed out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down"); }));

    render(<SessionStatus />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });
});

describe("SessionStatus look (#54)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the sign-in link looks like a button and stays a link", async () => {
    vi.stubGlobal("fetch", respond(403, { detail: "Authentication credentials were not provided." }));

    render(<SessionStatus />);

    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveClass("min-h-11", "btn-primary");
  });

  it("when signed in, offers the projects as a link and sign-out as a button, both easy to tap", async () => {
    vi.stubGlobal("fetch", respond(200, { id: 1, email: "ada@example.com", name: "Ada Lovelace" }));

    render(<SessionStatus />);

    const projects = await screen.findByRole("link", { name: "Your projects" });
    expect(projects).toHaveAttribute("href", "/projects");
    expect(projects).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveClass("min-h-11");
  });
});

describe("SessionStatus in the navy header (#74)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs out with a button that has a transparent outline look, so it reads on navy", async () => {
    vi.stubGlobal("fetch", respond(200, { id: 1, email: "ada@example.com", name: "Ada Lovelace" }));

    render(<SessionStatus layout="nav" />);

    const button = await screen.findByRole("button", { name: "Sign out" });
    expect(button).toHaveClass("btn-ghost", "text-inherit"); // btn-ghost has the transparent fill (tested on the CSS)
    expect(button).not.toHaveClass("bg-card");
  });

  it("wraps a long email instead of widening the header past a phone screen", async () => {
    vi.stubGlobal("fetch", respond(200, { id: 1, email: "ayselmammadovahuseynova.consulting@example.az", name: "" }));

    const { container } = render(<SessionStatus layout="nav" />);

    await screen.findByText(/Signed in as ayselmammadovahuseynova/);
    expect(container.firstElementChild).toHaveClass("min-w-0", "[overflow-wrap:anywhere]");
  });

  it("says when sign-out failed, under the actions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/me/") return new Response(JSON.stringify({ id: 1, email: "ada@example.com", name: "Ada" }), { status: 200 });
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      return new Response(init?.method === "POST" ? "{}" : null, { status: 500 });
    }));

    render(<SessionStatus layout="nav" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-out failed. You are still signed in.");
  });

  it("says when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));

    render(<SessionStatus layout="nav" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");
  });

  it("shows the loading words in a quiet style before the session is known", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<SessionStatus layout="nav" />);

    expect(screen.getByText("Checking your session…")).toHaveClass("text-sm");
  });
});

describe("SessionStatus: a slow first answer (#38)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  for (const layout of ["block", "nav"] as const) {
    it(`says why in the ${layout} layout once the wait passes five seconds, and not before`, () => {
      vi.useFakeTimers();
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

      render(<SessionStatus layout={layout} />);

      expect(screen.getByText("Checking your session…")).toBeInTheDocument();
      expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(5000));
      expect(screen.getByText(WAKING_TEXT)).toBeInTheDocument();
    });
  }

  it("takes the note away as soon as a slow answer comes", async () => {
    vi.useFakeTimers();
    let answer!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))));

    render(<SessionStatus />);
    act(() => vi.advanceTimersByTime(6000));
    expect(screen.getByText(WAKING_TEXT)).toBeInTheDocument();

    await act(async () => answer(new Response("{}", { status: 403 })));

    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
  });

  it("can leave the note out, for a page whose body already shows it", () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<SessionStatus layout="nav" wakingNote={false} />);
    act(() => vi.advanceTimersByTime(6000));

    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
    expect(screen.getByText("Checking your session…")).toBeInTheDocument();
  });

});
