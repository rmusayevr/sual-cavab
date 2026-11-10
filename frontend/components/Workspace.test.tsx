import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
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

const members = [
  { user_id: 1, email: "owner@example.invalid", name: "Olga Owner", role: "owner", added_at: "2026-01-01T00:00:00Z" },
  { user_id: 2, email: "member@example.invalid", name: "", role: "member", added_at: "2026-01-02T00:00:00Z" },
];

let draftBody: unknown = null;
let served: typeof questions = questions;
function api(overrides: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      for (const [part, make] of Object.entries(overrides)) if (url.includes(part)) return make();
      if (url.endsWith("/draft/")) {
        draftBody = JSON.parse(String(init?.body));
        return json(200, { draft: "Salam, bir neçə sualımız var." });
      }
      if (url.includes("/questions/")) return json(200, served);
      if (url.endsWith("/members/")) return json(200, members);
      return json(200, projects);
    }),
  );
}

describe("Workspace (#70)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    draftBody = null;
    served = questions;
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

  // Review of #79: Next keeps a page it was left in the background, with its state, and loads the
  // questions again when it comes back. A question answered meanwhile must not stay ticked.
  it("drops a ticked question that was answered while the page was in the background", async () => {
    api();
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <Workspace />
      </Activity>
    );
    const { rerender } = render(view("visible"));
    fireEvent.click(await screen.findByRole("checkbox", { name: /Q1/ }));
    expect(screen.getByRole("button", { name: "Write a draft" })).toBeEnabled();

    rerender(view("hidden"));
    served = questions.map((x) => (x.number === 1 ? { ...x, status: "answered" } : x));
    rerender(view("visible"));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: /Q1/ })).toBeDisabled());
    expect(screen.getByRole("checkbox", { name: /Q1/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Write a draft" })).toBeDisabled();
  });

  it("unticks a question once it is answered in the detail pane", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Q1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Q1.*Which payment providers/ }));
    // the status change answers with the question as the server now has it
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { ...questions[0], status: "dropped" })),
    );

    const detail = screen.getByRole("region", { name: "Selected question" });
    fireEvent.click(await within(detail).findByRole("button", { name: /drop/i }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Write a draft" })).toBeDisabled());
    expect(screen.getByText(/Tick up to 10/)).toBeInTheDocument();
  });

  it("names the ticked questions, also the ones a filter hides", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Q2/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Q1/ }));

    fireEvent.click(screen.getByRole("button", { name: "Answered" }));

    expect(screen.getByText("2 questions ticked: Q1, Q2.")).toBeInTheDocument();
  });

  // #83: what the old overview and Still open pages showed, now in the workspace.
  it("lists the project's members with their roles, falling back to the email for a nameless one", async () => {
    api();
    render(<Workspace />);

    const list = await screen.findByRole("list", { name: "Members" });
    expect(within(list).getByText("Olga Owner · owner")).toBeInTheDocument();
    expect(within(list).getByText("member@example.invalid · member")).toBeInTheDocument();
  });

  it("still shows the project when the members cannot be loaded, without a members list", async () => {
    api({ "/members/": () => json(500, {}) });
    render(<Workspace />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Members" })).not.toBeInTheDocument();
  });

  it("says how long an open or asked question has been open, and nothing for answered or dropped ones", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-04T12:00:00Z")); // 3 days after the questions were created
    try {
      api();
      render(<Workspace />);
      await screen.findByText("Which payment providers are allowed?");

      const row = (text: string) => screen.getByText(text).closest("li")!;
      expect(within(row("Which payment providers are allowed?")).getByText("open for 3 days")).toBeInTheDocument();
      expect(within(row("Who approves refunds?")).getByText("open for 3 days")).toBeInTheDocument();
      expect(within(row("Which currency do we show?")).queryByText(/open for/)).not.toBeInTheDocument();
      expect(within(row("Do we need a mobile app?")).queryByText(/open for/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // Review of #88: the members are loaded on their own; however that call fails, the project is shown.
  it("shows the project when the members call fails on the network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/members/")) throw new Error("offline");
        if (url.includes("/questions/")) return json(200, served);
        return json(200, projects);
      }),
    );
    render(<Workspace />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Members" })).not.toBeInTheDocument();
  });

  it("shows the project when the members reply is not JSON", async () => {
    api({ "/members/": () => new Response("<html>bad gateway</html>", { status: 200 }) });
    render(<Workspace />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not wait for a members call that never answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/members/")) return new Promise<Response>(() => {});
        if (url.includes("/questions/")) return Promise.resolve(json(200, served));
        return Promise.resolve(json(200, projects));
      }),
    );
    render(<Workspace />);

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.getByText("Which payment providers are allowed?")).toBeInTheDocument();
  });

  it("words the age for under a day, exactly one day and many days (never '0 days' or '1 days')", async () => {
    for (const [now, expected] of [
      ["2026-01-01T10:00:00Z", "open for less than a day"],
      ["2026-01-02T00:00:00Z", "open for 1 day"],
      ["2026-01-03T00:00:00Z", "open for 2 days"],
    ] as const) {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(now));
      try {
        api();
        const { unmount } = render(<Workspace />);
        const row = (await screen.findByText("Which payment providers are allowed?")).closest("li")!;
        expect(within(row).getByText(expected)).toBeInTheDocument();
        unmount();
      } finally {
        vi.useRealTimers();
      }
    }
  });
});
