import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProjectList from "./ProjectList";

const project = (id: number, name: string, role: "owner" | "member" = "member", open = 0) => ({
  id,
  name,
  client_name: "Invented Client",
  description: "",
  my_role: role,
  open_question_count: open,
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

  it("shows how many questions are still open on each project, including none", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3), project(2, "Refunds")])));

    render(<ProjectList />);

    await screen.findByRole("link", { name: "Ticketing" });
    expect(screen.getByText(/3 still open/)).toBeInTheDocument();
    expect(screen.getByText(/0 still open/)).toBeInTheDocument();
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

describe("ProjectList look (#55)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the client, the role and the count under the project's name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3)])));

    render(<ProjectList />);

    const link = await screen.findByRole("link", { name: "Ticketing" });
    expect(link.closest("li")).toHaveTextContent("Invented Client (owner) · 3 still open");
  });

  it("the new-project form uses the shared fields and button", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));

    render(<ProjectList />);

    expect(await screen.findByLabelText("Project name")).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Client")).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Create project" })).toHaveClass("min-h-11");
  });

  it("the sign-in link for a signed-out visitor is easy to tap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(403, {})));

    render(<ProjectList />);

    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link).toHaveAttribute("href", "/login");
    expect(link).toHaveClass("min-h-11");
  });

  it("each project is a card, and its name is a link that is easy to tap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3)])));

    render(<ProjectList />);

    const link = await screen.findByRole("link", { name: "Ticketing" });
    expect(link.closest("li")!.firstElementChild).toHaveClass("rounded-md", "shadow-card");
    expect(link).toHaveClass("min-h-11");
  });
});

describe("ProjectList: no bullets (#55)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the list of projects is a card list without bullet markers (there is no browser reset)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3)])));

    render(<ProjectList />);

    expect(await screen.findByRole("list")).toHaveClass("list-none");
  });
});

describe("ProjectList: the ledger (#72)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("numbers the projects like ledger lines, in monospace and red", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3), project(2, "Refunds")])));

    render(<ProjectList />);

    await screen.findByRole("link", { name: "Ticketing" });
    expect(screen.getByText("01")).toHaveClass("font-mono", "text-xs", "text-primary");
    expect(screen.getByText("02")).toHaveClass("font-mono");
  });

  it("shows the project's name in the serif, as a link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3)])));

    render(<ProjectList />);

    expect(await screen.findByRole("link", { name: "Ticketing" })).toHaveClass("font-display");
  });

  it("marks a project that is still waiting with a saffron count, like the example's rail, and no mark for 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [project(1, "Ticketing", "owner", 3), project(2, "Refunds", "member", 0)])));

    const { container } = render(<ProjectList />);

    await screen.findByRole("link", { name: "Ticketing" });
    const chips = container.querySelectorAll(".bg-saffron");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("3");
    expect(chips[0]).toHaveAttribute("aria-hidden", "true"); // the sentence under the name says it
    expect(chips[0]).toHaveClass("font-mono", "text-accent-foreground");
  });

  it("an empty list is a card under a carpet strip that says what to do next", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));

    const { container } = render(<ProjectList />);

    const message = await screen.findByText(/not on any project yet/);
    const card = message.closest(".bg-card")!;
    expect(card.firstElementChild).toHaveClass("pattern-carpet");
    expect(container.querySelectorAll(".pattern-carpet").length).toBeGreaterThanOrEqual(1);
  });

  it("loading shows what is loading and ledger rows that fill in", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const { container } = render(<ProjectList />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading projects…");
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass("motion-safe:animate-pulse");
  });

  it("the new-project card is topped by a carpet strip, with a monospace eyebrow and a serif heading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [])));

    render(<ProjectList />);

    const heading = await screen.findByRole("heading", { level: 2, name: "New project" });
    const card = heading.closest("section")!;
    expect(card.firstElementChild).toHaveClass("pattern-carpet");
  });
});
