import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Workspace from "./Workspace";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const project = (id: number, name: string, open: number) => ({
  id,
  name,
  client_name: `Client ${id}`,
  description: "",
  my_role: "owner",
  open_question_count: open,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});
const projects = [project(5, "Ticketing", 2), project(6, "Portal", 0)];

const q = (number: number, status: string, text: string) => ({
  id: number,
  number,
  label: `Q${number}`,
  text,
  why_it_matters: `Why ${number}`,
  blocks: `Blocks ${number}`,
  status,
  created_at: "2026-01-01T00:00:00Z",
  current_answer: null,
  previous_answers: [],
});
const questions = [
  q(1, "open", "Which payment providers are allowed?"),
  q(2, "asked", "Who approves refunds?"),
  q(3, "answered", "Which currency do we show?"),
  q(4, "dropped", "Do we need a mobile app?"),
];

let draftBody: unknown = null;
function api(overrides: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      for (const [part, make] of Object.entries(overrides)) if (url.includes(part)) return make();
      if (url.endsWith("/draft/")) {
        draftBody = JSON.parse(String(init?.body));
        return json(200, { draft: "Salam, bir neçə sualımız var." });
      }
      if (url.includes("/questions/")) return json(200, questions);
      return json(200, projects);
    }),
  );
}

describe("Workspace (#70)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    draftBody = null;
  });

  it("lists the person's projects in a rail, the open one marked, with the open counts", async () => {
    api();
    render(<Workspace />);

    const rail = await screen.findByRole("navigation", { name: "Your projects" });
    const current = within(rail).getByRole("link", { name: /Ticketing/ });
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("href", "/projects/5");
    expect(current).toHaveTextContent("2");
    expect(within(rail).getByRole("link", { name: /Portal/ })).not.toHaveAttribute("aria-current");
  });

  it("titles the middle pane with the project and counts the four statuses from the loaded questions", async () => {
    api();
    render(<Workspace />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(within(screen.getByRole("main")).getByText("Client 5")).toBeInTheDocument();
    for (const [label, count] of [["Open", "1"], ["Asked", "1"], ["Answered", "1"], ["Dropped", "1"]]) {
      expect(screen.getByTestId(`stat-${label.toLowerCase()}`)).toHaveTextContent(`${label}${count}`);
    }
  });

  it("filters the rows by status, and says which filter is on", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    fireEvent.click(screen.getByRole("button", { name: "Answered" }));

    expect(screen.getByRole("button", { name: "Answered" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("Which payment providers are allowed?")).not.toBeInTheDocument();
    expect(screen.getByText("Which currency do we show?")).toBeInTheDocument();
  });

  it("lets only open and asked questions be picked", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    expect(screen.getByRole("checkbox", { name: /Q1/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Q2/ })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /Q3/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Q4/ })).toBeDisabled();
  });

  it("shows the selected question on the right, with its reason and what it blocks", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Q2.*Who approves refunds/ }));

    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(within(detail).getByText("Who approves refunds?")).toBeInTheDocument();
    expect(within(detail).getByText(/Why 2/)).toBeInTheDocument();
    expect(within(detail).getByText(/Blocks 2/)).toBeInTheDocument();
  });

  it("writes a draft for the picked questions, in order, and offers to edit and copy it", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Q2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Q1/ }));

    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));

    const box = await screen.findByLabelText(/Draft \(edit it/);
    expect(box).toHaveValue("Salam, bir neçə sualımız var.");
    expect(draftBody).toEqual({ questions: [1, 2] });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("says what is sent to Claude, and never offers to send the message", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Q1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByLabelText(/Draft \(edit it/);

    expect(screen.getByText(/is sent to Claude to write the draft/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send|mail|whatsapp/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send|mail|whatsapp/i })).not.toBeInTheDocument();
  });

  it("keeps the write button off until a question is picked", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    expect(screen.getByRole("button", { name: "Write a draft" })).toBeDisabled();
  });

  it("has exactly one carpet strip", async () => {
    api();
    const { container } = render(<Workspace />);
    await screen.findByRole("heading", { level: 1, name: "Ticketing" });

    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(1);
  });

  it("says the project is not found when the server says 404", async () => {
    api({ "/questions/": () => json(404, {}) });
    render(<Workspace />);

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });

  it("says so when the questions could not be loaded", async () => {
    api({ "/questions/": () => json(500, {}) });
    render(<Workspace />);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load the project."));
  });
});
