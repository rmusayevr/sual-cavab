import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Workspace from "./Workspace";

const route = vi.hoisted(() => ({ id: "5" }));
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: route.id }),
  usePathname: () => `/projects/${route.id}`,
  useRouter: () => ({ push }),
}));

// The two answer-link cards have their own tests (AnswerLinkPanel.test.tsx, SubmissionsPanel.test.tsx) and are
// tested together with the workspace in Workspace.answerlink.test.tsx. Here they are stubs: their own requests would
// otherwise answer from this file's hand-built mocks and show error alerts that have nothing to do with these tests.
vi.mock("./AnswerLinkPanel", () => ({ default: () => null }));
vi.mock("./SubmissionsPanel", () => ({ default: () => null }));

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

let served: typeof questions = questions;
function api(overrides: Record<string, () => Response> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      for (const [part, make] of Object.entries(overrides)) if (url.includes(part)) return make();
      if (url.includes("/questions/")) return json(200, served);
      if (url.endsWith("/members/")) return json(200, members);
      return projectsReply(url);
    }),
  );
}

describe("Workspace (#70)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("has no drafting and no ticking left: no draft box, no checkboxes, no write button", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /draft/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Claude/)).not.toBeInTheDocument();
  });

  // The rule outlived drafting: the app sends nothing (harness-loop.json stopFor; #114 answers happen in the app).
  it("offers no way to send, mail, share or post anything", async () => {
    api();
    render(<Workspace />);
    await screen.findByText("Which payment providers are allowed?");

    const words = /send|e-?mail|share|post|whatsapp|telegram|sms/i;
    expect(screen.queryByRole("button", { name: words })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: words })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"], a[href^="sms:"], a[href*="wa.me"], a[href*="t.me"]')).toBeNull();
  });

  it("opens the question below its own row, with its reason and what it blocks", async () => {
    api();
    render(<Workspace />);
    const row = await screen.findByRole("button", { name: /Q2.*Who approves refunds/ });
    expect(screen.queryByRole("region", { name: "Selected question" })).not.toBeInTheDocument();

    fireEvent.click(row);

    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row.closest("li")).toContainElement(detail); // inside the same card, below the question
    expect(within(detail).getByText(/Why 2/)).toBeInTheDocument();
    expect(within(detail).getByText(/Blocks 2/)).toBeInTheDocument();
    expect(within(detail).queryByText("Who approves refunds?")).not.toBeInTheDocument(); // the row above already says it
  });

  it("closes the question when its row is pressed again, and opens only one at a time", async () => {
    api();
    render(<Workspace />);
    const q1 = await screen.findByRole("button", { name: /Q1.*Which payment providers/ });
    const q2 = screen.getByRole("button", { name: /Q2.*Who approves refunds/ });

    fireEvent.click(q1);
    fireEvent.click(q2);
    expect(screen.getAllByRole("region", { name: "Selected question" })).toHaveLength(1);
    expect(q1).toHaveAttribute("aria-expanded", "false");
    expect(q2.closest("li")).toContainElement(screen.getByRole("region", { name: "Selected question" }));

    fireEvent.click(q2);

    expect(screen.queryByRole("region", { name: "Selected question" })).not.toBeInTheDocument();
    expect(q2).toHaveAttribute("aria-expanded", "false");
  });

  it("has nothing on the right-hand side for the selected question any more", async () => {
    api();
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: /Q1.*Which payment providers/ }));

    const aside = screen.getByRole("complementary");
    expect(within(aside).queryByRole("region", { name: "Selected question" })).not.toBeInTheDocument();
    expect(within(aside).getByRole("heading", { name: "Add a question" })).toBeInTheDocument();
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

  it("lets a long question without spaces shrink inside its row", async () => {
    served = [q(1, "open", "https://example.invalid/a/very/long/link/that/has/no/spaces/at/all/ever/and/keeps/going")];
    api();
    render(<Workspace />);

    const button = (await screen.findByText(/very\/long\/link/)).closest("button")!;
    expect(button).toHaveClass("min-w-0");
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

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByText("A dropped question cannot become answered.")).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(within(detail).getByLabelText("Answer")).toHaveValue("Thirty days, in writing."); // kept through the reload
    expect(within(detail).queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
    expect(within(detail).getByText(/kept below so you can copy it/)).toBeInTheDocument();
    expect(within(detail.closest("li")!).getAllByText("Dropped").length).toBeGreaterThan(0); // the row shows the question as it is now
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

  describe("members: who sees the controls (#33)", () => {
    const withRole = (role: "owner" | "member" | null) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url.includes("/questions/")) return json(200, served);
          if (url.endsWith("/members/")) return json(200, members);
          const mine = { ...projects[0], my_role: role };
          if (url === "/api/projects/5/") return json(200, mine);
          return json(200, pageOf([mine, projects[1]]));
        }),
      );
    };

    it("shows an owner the Manage members section", async () => {
      withRole("owner");

      render(<Workspace />);

      expect(await screen.findByText("Manage members")).toBeInTheDocument();
    });

    it("shows nothing to a person whose role is not known", async () => {
      withRole(null);

      render(<Workspace />);

      await screen.findByRole("list", { name: "Members" });
      expect(screen.queryByText("Manage members")).not.toBeInTheDocument();
    });

    it("shows a member the list of members and no controls", async () => {
      withRole("member");

      render(<Workspace />);

      await screen.findByRole("list", { name: "Members" });
      expect(screen.queryByText("Manage members")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    });
  });
});

// #121: the page the person is looking at must follow a sign-out, not wait for a refresh.
describe("Workspace: signing out (#121)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const signedInAs = (logout: () => Response) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (url === "/api/auth/me/") return json(200, { id: 1, email: "owner@example.invalid", name: "Olga Owner" });
        if (url === "/api/auth/logout/" && init?.method === "POST") return logout();
        if (url.includes("/questions/")) return json(200, served);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );

  it("shows the signed-out page at once when the person signs out in the header, and no longer shows the project", async () => {
    signedInAs(() => new Response(null, { status: 204 }));
    render(<Workspace />);
    await screen.findByRole("heading", { level: 1, name: "Ticketing" });

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText(/to see this project/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Ticketing" })).not.toBeInTheDocument();
    expect(screen.queryByText("Which payment providers are allowed?")).not.toBeInTheDocument();
    expect(screen.queryByText("Olga Owner · owner")).not.toBeInTheDocument();
  });

  it("keeps the project on screen when the sign-out was refused and the person is still signed in", async () => {
    signedInAs(() => json(403, { detail: "CSRF Failed" }));
    render(<Workspace />);
    await screen.findByRole("heading", { level: 1, name: "Ticketing" });

    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(await screen.findByText(/Sign-out failed/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.queryByText(/to see this project/)).not.toBeInTheDocument();
  });
});

// Review of #122: the open question must stay on screen while it is open, whatever the filter says.
describe("Workspace: the open question and the filter (#121)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    served = questions;
  });

  it("keeps the open question on screen when its status stops matching the filter, and drops it once it is closed", async () => {
    api({ "/transition/": () => json(200, { ...questions[0], status: "asked" }) });
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Open" })); // the filter: Q1 is the only open question
    const row = await screen.findByRole("button", { name: /Q1.*Which payment providers/ });
    fireEvent.click(row);

    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" })); // Q1 is now asked, which the filter hides

    expect(await screen.findByText("Asked", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Selected question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Q1.*Which payment providers/ })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: /Q1.*Which payment providers/ })); // closed: the filter applies again

    expect(screen.queryByRole("button", { name: /Q1.*Which payment providers/ })).not.toBeInTheDocument();
  });

  it("keeps a typed answer when a teammate dropped the question meanwhile, also under a filter that then hides it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (init?.method === "POST" && url.endsWith("/transition/"))
          return json(400, { to: ["A dropped question cannot become answered."], allowed: ["open"] });
        if (url === "/api/projects/5/questions/1/") return json(200, { ...questions[0], status: "dropped" });
        if (url.includes("/answer-link/")) return json(200, { exists: false });
        if (url.includes("/submissions/")) return json(200, []);
        if (url.includes("/questions/")) return json(200, served);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Open" })); // the filter that "dropped" will stop matching
    fireEvent.click(await screen.findByRole("button", { name: /Q1.*Which payment providers/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "Thirty days, in writing." } });

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByText("A dropped question cannot become answered.")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveValue("Thirty days, in writing."); // not thrown away with the row
  });

  it("gives an open question's button a target only while the question is open (no pointer to nothing)", async () => {
    api();
    render(<Workspace />);
    const row = await screen.findByRole("button", { name: /Q1.*Which payment providers/ });
    expect(row).not.toHaveAttribute("aria-controls");

    fireEvent.click(row);

    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(row.getAttribute("aria-controls")).toBe(detail.id);
  });
});

// Review of #122: a sign-out that arrives while the first load is still on its way must not be undone by its answer.
describe("Workspace: a sign-out during the first load (#121)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays signed out when the load that was already on its way answers afterwards", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/projects/5/") return new Promise<Response>((resolve) => (release = resolve));
        if (url.includes("/questions/")) return json(200, served);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    render(<Workspace />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/projects/5/", expect.anything()));

    act(() => {
      window.dispatchEvent(new Event("sual:signed-out"));
    });
    await act(async () => release(projectsReply("/api/projects/5/")));

    expect(await screen.findByText(/to see this project/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Ticketing" })).not.toBeInTheDocument();
  });
});
