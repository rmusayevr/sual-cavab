import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Workspace from "./Workspace";

const route = vi.hoisted(() => ({ id: "5" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: route.id }), usePathname: () => `/projects/${route.id}` }));

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

/** One page of the project list (#49), the way the API answers it. */
const pageOf = (results: unknown[], count = results.length) => ({ count, page: 1, page_size: 25, results });

/** What the API answers for a project URL: the list as a page, one project by its own address (404 if the person is not on it). */
function projectsReply(url: string): Response {
  const one = /^\/api\/projects\/(\d+)\/$/.exec(url);
  if (one) {
    const found = projects.find((p) => String(p.id) === one[1]);
    return found ? json(200, found) : json(404, { detail: "Not found." });
  }
  return json(200, pageOf(projects));
}

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
      return projectsReply(url);
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
        return projectsReply(url);
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
        return Promise.resolve(projectsReply(url));
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

  // #83: what the old questions and draft pages tested, now for the workspace they were folded into.
  type Sent = { method: string; url: string; body: unknown };
  /** A backend that also takes POSTs to /questions/ (the add form) and records every request. */
  function withAdd(onAdd: (body: unknown) => Response | Promise<Response>, list: unknown[] = []) {
    const sent: Sent[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        sent.push({ method, url, body });
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (method === "POST" && url.endsWith("/questions/")) return onAdd(body);
        if (url.includes("/questions/")) return json(200, list);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    return sent;
  }
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const adds = (sent: Sent[]) => sent.filter((c) => c.method === "POST" && c.url.endsWith("/questions/"));

  it("shows a loading state first, as ledger rows that pulse", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const { container } = render(<Workspace />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading project…");
    expect(container.querySelector('[aria-hidden="true"].motion-safe\\:animate-pulse, .motion-safe\\:animate-pulse')).not.toBeNull();
  });

  it("says so when the project has no questions yet, and offers the add form", async () => {
    served = [];
    api();
    render(<Workspace />);

    expect(await screen.findByText("No questions yet. Add the first one.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add question" })).toBeInTheDocument();
  });

  it("adds a question: posts the three fields, shows it in the list and empties the form", async () => {
    const sent = withAdd(() => json(201, { ...q(7, "open", "Which providers?"), blocks: "Checkout" }));
    render(<Workspace />);
    await screen.findByText("No questions yet. Add the first one.");

    fill("Question", "Which providers?");
    fill("Why it matters", "Pricing");
    fill("What it blocks", "Checkout");
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    expect(await screen.findByText("Which providers?")).toBeInTheDocument();
    expect(adds(sent)[0].body).toEqual({ text: "Which providers?", why_it_matters: "Pricing", blocks: "Checkout" });
    expect(screen.getByLabelText("Question")).toHaveValue("");
  });

  it("shows the API's message next to the field when adding is refused, and keeps what was typed", async () => {
    withAdd(() => json(400, { text: ["This field may not be blank."] }));
    render(<Workspace />);
    await screen.findByText("No questions yet. Add the first one.");

    fill("What it blocks", "Checkout");
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    expect(await screen.findByText("This field may not be blank.")).toBeInTheDocument();
    expect(screen.getByLabelText("What it blocks")).toHaveValue("Checkout");
  });

  it("does not add twice while the first request runs, even when the form is submitted again", async () => {
    let release: (r: Response) => void = () => {};
    const sent = withAdd(() => new Promise<Response>((resolve) => (release = resolve)));
    render(<Workspace />);
    await screen.findByText("No questions yet. Add the first one.");

    fill("Question", "Q?");
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    const busy = await screen.findByRole("button", { name: /adding/i });
    expect(busy).toBeDisabled();
    fireEvent.submit(busy.closest("form")!); // Enter in a field submits the form itself

    await waitFor(() => expect(adds(sent)).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adds(sent)).toHaveLength(1);
    release(json(201, q(8, "open", "Q?")));
    expect(await screen.findByText("Q?")).toBeInTheDocument();
  });

  it("says so when the server cannot be reached while adding, and keeps what was typed", async () => {
    withAdd(() => Promise.reject(new Error("offline")));
    render(<Workspace />);
    await screen.findByText("No questions yet. Add the first one.");

    fill("Question", "Q?");
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("Q?");
  });

  it("allows at most ten questions in one draft, and the other rows then look unavailable", async () => {
    served = Array.from({ length: 11 }, (_, n) => q(n + 1, "open", `Open question ${n + 1}`));
    api();
    render(<Workspace />);
    await screen.findByText("Open question 1");

    for (let n = 1; n <= 10; n++) fireEvent.click(screen.getByRole("checkbox", { name: `Pick Q${n}` }));

    expect(screen.getByRole("checkbox", { name: "Pick Q11" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Pick Q10" })).toBeEnabled(); // a ticked one can be unticked
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick Q10" }));
    expect(screen.getByRole("checkbox", { name: "Pick Q11" })).toBeEnabled();
  });

  it("says that writing again replaces the draft, and warns when the ticked questions no longer match it", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pick Q1" }));
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByLabelText(/Draft \(edit it/);
    expect(screen.getByRole("button", { name: "Write a new draft (replaces the one below)" })).toBeInTheDocument();
    expect(screen.queryByText("The ticked questions have changed since this draft was written.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Pick Q2" }));

    expect(screen.getByText("The ticked questions have changed since this draft was written.")).toBeInTheDocument();
  });

  it("lets a long question without spaces shrink inside its row", async () => {
    served = [q(1, "open", "https://example.invalid/a/very/long/link/that/has/no/spaces/at/all/ever/and/keeps/going")];
    api();
    render(<Workspace />);

    const button = (await screen.findByText(/very\/long\/link/)).closest("button")!;
    expect(button).toHaveClass("min-w-0");
  });

  // Review of #90: protections the old draft and questions pages' tests gave, which the first move lost.
  const fetchWithDraft = (draftAnswer: () => Response | Promise<Response>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (url.endsWith("/draft/")) return draftAnswer();
        if (url.includes("/questions/")) return json(200, served);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );

  it("keeps the picked questions and the write button after a failed draft, and shows no draft", async () => {
    fetchWithDraft(() => json(502, {}));
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pick Q1" }));

    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The draft could not be written. Try again in a minute.");
    expect(screen.getByRole("checkbox", { name: "Pick Q1" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Write a draft" })).toBeEnabled(); // not stuck on "Writing…"
    expect(screen.queryByLabelText("Draft (edit it before you send it)")).not.toBeInTheDocument();
  });

  it("offers no way to send, mail, share or post anything, with or without a draft, and says the app sends nothing", async () => {
    fetchWithDraft(() => json(200, { draft: "Invented draft." }));
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pick Q1" }));
    const sendWords = /send|e-?mail|share|post|whatsapp|telegram|sms|mailto/i;
    const shareLinks = 'a[href^="mailto:"], a[href^="sms:"], a[href^="whatsapp:"], a[href^="tg:"], a[href*="wa.me"], a[href*="t.me"]';
    const check = () => {
      for (const b of screen.getAllByRole("button")) expect(b.textContent ?? "", "button").not.toMatch(sendWords);
      for (const l of screen.queryAllByRole("link")) expect(l.textContent ?? "", "link").not.toMatch(sendWords);
      expect(document.querySelector(shareLinks)).toBeNull();
    };
    check();

    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByLabelText("Draft (edit it before you send it)");
    check();

    // the wording is checked as written (not through the dictionary), so deleting the guarantee fails here
    expect(screen.getByText(/The app never sends the message anywhere: you copy it and send it yourself\./)).toBeInTheDocument();
    expect(screen.getByText(/Nothing else about the project or the client is sent\./)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been sent\./)).toBeInTheDocument();
  });

  it("stops saying Copied once the text in the box is edited", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    fetchWithDraft(() => json(200, { draft: "Invented draft." }));
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pick Q1" }));
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Draft (edit it before you send it)"), { target: { value: "Invented draft, edited." } });

    expect(screen.queryByText("Copied.")).not.toBeInTheDocument();
  });

  it("tells the person to copy by hand when the browser refuses to copy", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    fetchWithDraft(() => json(200, { draft: "Invented draft." }));
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Pick Q1" }));
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));

    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

    expect(await screen.findByText("Could not copy. Select the text and copy it yourself.")).toBeInTheDocument();
  });

  it("dims the rows that cannot be added once ten are ticked, and lights them up again when one is unticked", async () => {
    served = Array.from({ length: 11 }, (_, n) => q(n + 1, "open", `Open question ${n + 1}`));
    api();
    render(<Workspace />);
    await screen.findByText("Open question 1");
    const rowOf = (n: number) => screen.getByRole("checkbox", { name: `Pick Q${n}` }).closest("li")!.firstElementChild!;

    for (let n = 1; n <= 10; n++) fireEvent.click(screen.getByRole("checkbox", { name: `Pick Q${n}` }));

    expect(rowOf(11)).toHaveClass("opacity-60");
    expect(rowOf(10)).not.toHaveClass("opacity-60"); // a ticked row can still be unticked
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick Q10" }));
    expect(rowOf(11)).not.toHaveClass("opacity-60");
  });

  it("gives the pick checkbox a tap target of 44 px, not only its 20 px box", async () => {
    api();
    render(<Workspace />);

    const label = (await screen.findByRole("checkbox", { name: "Pick Q1" })).closest("label")!;

    expect(label).toHaveClass("min-h-11", "min-w-11");
  });

  it("shows each question's status word in its row, for all four statuses", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    for (const [text, word] of [
      ["Which payment providers are allowed?", "Open"],
      ["Who approves refunds?", "Asked"],
      ["Which currency do we show?", "Answered"],
      ["Do we need a mobile app?", "Dropped"],
    ]) {
      expect(within(screen.getByText(text).closest("li")!).getByText(word)).toBeInTheDocument();
    }
  });

  it("has no bullet markers on its lists (there is no browser reset)", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    for (const list of screen.getAllByRole("list")) expect(list, list.getAttribute("aria-label") ?? "list").toHaveClass("list-none");
  });

  it("says so when the questions cannot be reached at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/questions/")) throw new Error("offline");
        return (url.endsWith("/members/") ? json(200, members) : projectsReply(url));
      }),
    );
    render(<Workspace />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the project.");
  });

  it("the add form uses the shared fields, tied to their labels, and the one-line field stays one line", async () => {
    served = [];
    api();
    render(<Workspace />);
    await screen.findByText("No questions yet. Add the first one.");

    for (const label of ["Question", "Why it matters", "What it blocks"]) expect(screen.getByLabelText(label)).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Question")).toHaveAttribute("id", "add-text");
    expect(screen.getByLabelText("What it blocks")).toHaveAttribute("rows", "1");
    expect(screen.getByLabelText("What it blocks")).not.toHaveClass("min-h-24");
  });

  // #36 (the owner's choice B), through the real workspace: the question is replaced by the reload and
  // the typed answer must survive that.
  it("keeps a typed answer in the form when the server refuses it because a teammate dropped the question", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (init?.method === "POST" && url.endsWith("/transition/"))
          return json(400, { to: ["A dropped question cannot become answered."], allowed: ["open"] });
        if (url === "/api/projects/5/questions/1/") return json(200, { ...questions[0], status: "dropped" });
        if (url.includes("/questions/")) return json(200, served);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Q1.*Which payment providers/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Thirty days, in writing." } });
    fireEvent.change(screen.getByLabelText("Answered by"), { target: { value: "Invented Person" } });

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByText("A dropped question cannot become answered.")).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(within(detail).getByLabelText("Answer")).toHaveValue("Thirty days, in writing."); // kept through the reload
    expect(within(detail).getByLabelText("Answered by")).toHaveValue("Invented Person");
    expect(within(detail).queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
    expect(within(detail).getByText(/kept below so you can copy it/)).toBeInTheDocument();
    expect(within(detail).getAllByText("Dropped").length).toBeGreaterThan(0); // the card shows the question as it is now
  });

  // #91: a 401 or 403 means the session ended (the backend answers 404 for a project the person is not
  // on), so the page says to sign in, as the projects page does, not that the project is gone.
  const answeringEverythingWith = (status: number) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/auth/csrf/"
          ? new Response(null, { status: 204 })
          : json(status, { detail: "Authentication credentials were not provided." }),
      ),
    );

  for (const status of [401, 403]) {
    it(`tells a signed-out person to sign in when the server answers ${status}, not that the project is gone`, async () => {
      answeringEverythingWith(status);
      render(<Workspace />);

      const sentence = (await screen.findByText(/to see this project\./)).closest("p")!;
      expect(sentence.textContent).toBe("Sign in to see this project.");
      expect(within(sentence).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fprojects%2F5");
      expect(screen.queryByText("Project not found.")).not.toBeInTheDocument();
      expect(screen.queryByText("Back to your projects")).not.toBeInTheDocument();
    });
  }

  it("still says the project is not found when the server answers 404 for it, with no sign-in sentence", async () => {
    answeringEverythingWith(404);
    render(<Workspace />);

    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
    expect(screen.queryByText(/to see this project\./)).not.toBeInTheDocument();
  });

  it("tells a signed-out person to sign in when only the project list is refused (403)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/questions/")) return json(200, served);
        if (url.endsWith("/members/")) return json(200, members);
        return json(403, {});
      }),
    );
    render(<Workspace />);

    expect(await screen.findByText(/to see this project\./)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells a signed-out person to sign in when ONLY the questions request is refused (403): the case #91 describes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/questions/")) return json(403, { detail: "Authentication credentials were not provided." });
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    render(<Workspace />);

    expect(await screen.findByText(/to see this project\./)).toBeInTheDocument();
    expect(screen.queryByText("Project not found.")).not.toBeInTheDocument();
  });

  it("puts 'sign in' before 'not found' when both could apply (the session ended between the two requests)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/questions/")) return json(404, {});
        if (url.endsWith("/members/")) return json(403, {});
        return json(403, {});
      }),
    );
    render(<Workspace />);

    expect(await screen.findByText(/to see this project\./)).toBeInTheDocument();
    expect(screen.queryByText("Project not found.")).not.toBeInTheDocument();
  });

  describe("the project list in pages (#49)", () => {
    afterEach(() => {
      route.id = "5";
    });

    it("opens /projects/05 as project 5 instead of crashing (the server reads 05 as 5)", async () => {
      route.id = "05";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("/questions/")) return json(200, served);
          if (url.endsWith("/members/")) return json(200, members);
          if (/^\/api\/projects\/0*5\/$/.test(url)) return json(200, projects[0]);
          return json(200, pageOf(projects));
        }),
      );

      render(<Workspace />);

      expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
      const rail = screen.getByRole("navigation", { name: "Your projects" });
      expect(within(rail).getByText("Ticketing").closest("a")).toHaveAttribute("aria-current", "page");
    });

    it("asks for the project by its own address, so a project past the first page still opens", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/projects/") return json(200, { count: 40, page: 1, page_size: 25, results: [project(6, "Portal", 0)] });
        if (url === "/api/projects/5/") return json(200, projects[0]);
        if (url.includes("/questions/")) return json(200, served);
        return json(200, members);
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<Workspace />);

      const rail = await screen.findByRole("navigation", { name: "Your projects" });
      expect(within(rail).getByText("Ticketing").closest("a")).toHaveAttribute("aria-current", "page");
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/5/", expect.anything());
    });

    it("links to the whole list when the rail shows only some of the projects", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "/api/projects/") return json(200, { count: 40, page: 1, page_size: 25, results: projects });
          if (url.includes("/questions/")) return json(200, served);
          if (url.endsWith("/members/")) return json(200, members);
          return projectsReply(url);
        }),
      );

      render(<Workspace />);

      const link = await screen.findByRole("link", { name: "All projects (40)" });
      expect(link).toHaveAttribute("href", "/projects");
    });

    it("has no such link when the rail shows every project", async () => {
      api();

      render(<Workspace />);

      await screen.findByRole("navigation", { name: "Your projects" });
      expect(screen.queryByRole("link", { name: /^All projects/ })).not.toBeInTheDocument();
    });

    it("says not found when the project's own address answers 404, even though the list loads", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "/api/projects/5/") return json(404, { detail: "Not found." });
          if (url.includes("/questions/")) return json(200, served);
          if (url.endsWith("/members/")) return json(200, members);
          return json(200, { count: 1, page: 1, page_size: 25, results: [projects[1]] });
        }),
      );

      render(<Workspace />);

      expect(await screen.findByText("Project not found.")).toBeInTheDocument();
    });
  });
});
