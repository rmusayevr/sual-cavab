import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectList from "./ProjectList";

const project = (id: number, name: string, role: "owner" | "member" = "member") => ({
  id,
  name,
  client_name: "Invented Client",
  description: "",
  my_role: role,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("ProjectList", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a loading message first", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<ProjectList />);

    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
  });

  it("lists my projects with a link to each", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner"), project(2, "Refunds")])));

    render(<ProjectList />);

    expect(await screen.findByRole("link", { name: "Ticketing" })).toHaveAttribute("href", "/projects/1");
    expect(screen.getByRole("link", { name: "Refunds" })).toHaveAttribute("href", "/projects/2");
  });

  it("says so when I am on no project", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));

    render(<ProjectList />);

    expect(await screen.findByText(/not on any project yet/)).toBeInTheDocument();
  });

  it("links to sign-in when the backend refuses an anonymous user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, { detail: "Authentication credentials were not provided." })));

    render(<ProjectList />);

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });

  it("reports a failed load instead of showing an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, {})));

    render(<ProjectList />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load projects.");
  });

  it("adds a new project to the list after creating it", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      if (init?.method === "POST") return json(201, project(7, "Brand New", "owner"));
      return json(200, []);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectList />);

    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "Brand New" } });
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "Invented Client" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("link", { name: "Brand New" })).toHaveAttribute("href", "/projects/7");
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ name: "Brand New", client_name: "Invented Client" });
  });

  it("shows an error and keeps the form when creating fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      if (init?.method === "POST") return json(400, { name: ["This field is required."] });
      return json(200, []);
    }));
    render(<ProjectList />);

    fireEvent.change(await screen.findByLabelText("Project name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not create the project");
    expect(screen.getByLabelText("Project name")).toHaveValue("x");
  });
});
