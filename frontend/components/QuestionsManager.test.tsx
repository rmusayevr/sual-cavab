import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import QuestionsManager from "./QuestionsManager";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const answerOf = (over: Record<string, unknown> = {}) => ({
  id: 1,
  text: "30 days.",
  answered_by: "Əli Məmmədov",
  answered_on: "2026-03-01",
  channel: "email",
  channel_note: "",
  recorded_by: "mark@example.com",
  recorded_at: "2026-03-01T10:00:00Z",
  superseded_at: null,
  ...over,
});

const question = (n: number, over: Record<string, unknown> = {}) => ({
  id: n,
  number: n,
  label: `Q${n}`,
  text: `Invented question ${n}`,
  why_it_matters: "",
  blocks: "",
  status: "open",
  created_at: "2026-03-05T12:00:00Z",
  current_answer: null,
  previous_answers: [],
  ...over,
});

type Call = { url: string; method: string; body: unknown };

/** Routes fetch by "METHOD url"; records every call. */
function backend(routes: Record<string, (body: unknown) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected request: ${method} ${url}`);
    return route(body);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

const LIST = "GET /api/projects/5/questions/";
const ADD = "POST /api/projects/5/questions/";
const TRANSITION_1 = "POST /api/projects/5/questions/1/transition/";
const EDIT_1 = "PATCH /api/projects/5/questions/1/";
const QUESTION_1 = "GET /api/projects/5/questions/1/";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("QuestionsManager: the list", () => {
  it("shows a loading state first", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<QuestionsManager projectId="5" />);
    expect(screen.getByText(/loading questions/i)).toBeInTheDocument();
  });

  it("says so when the project has no questions yet", async () => {
    backend({ [LIST]: () => json(200, []) });
    render(<QuestionsManager projectId="5" />);
    expect(await screen.findByText(/no questions yet/i)).toBeInTheDocument();
  });

  it("shows an error, not an empty list, when loading fails", async () => {
    backend({ [LIST]: () => json(500, {}) });
    render(<QuestionsManager projectId="5" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the questions/i);
    expect(screen.queryByText(/no questions yet/i)).not.toBeInTheDocument();
  });

  it("shows not found for a project the backend hides", async () => {
    backend({ [LIST]: () => json(404, { detail: "No Project matches the given query." }) });
    render(<QuestionsManager projectId="5" />);
    expect(await screen.findByText(/project not found/i)).toBeInTheDocument();
  });

  it("lists every question with its status, including answered and dropped ones", async () => {
    backend({
      [LIST]: () =>
        json(200, [
          question(1),
          question(2, { status: "answered", current_answer: answerOf() }),
          question(3, { status: "dropped" }),
        ]),
    });
    render(<QuestionsManager projectId="5" />);
    const items = await screen.findAllByTestId("question");
    expect(items).toHaveLength(3);
    expect(within(items[1]).getByText(/answered/)).toBeInTheDocument();
    expect(within(items[2]).getByText(/dropped/)).toBeInTheDocument();
  });

  it("shows the current answer and the history of older ones", async () => {
    backend({
      [LIST]: () =>
        json(200, [
          question(1, {
            status: "answered",
            current_answer: answerOf({ id: 2, text: "Corrected: 30 days." }),
            previous_answers: [answerOf({ id: 1, text: "14 days.", superseded_at: "2026-03-02T00:00:00Z" })],
          }),
        ]),
    });
    render(<QuestionsManager projectId="5" />);
    expect(await screen.findByText(/Corrected: 30 days\./)).toBeInTheDocument();
    expect(screen.getByText(/14 days\./)).toBeInTheDocument();
    expect(screen.getAllByText(/Əli Məmmədov/).length).toBeGreaterThan(0);
  });
});

describe("QuestionsManager: status buttons", () => {
  const MOVES = ["Mark asked", "Record answer", "Drop", "Un-ask", "Re-open", "Restore"];

  const buttonsFor = async (status: string) => {
    backend({ [LIST]: () => json(200, [question(1, { status })]) });
    render(<QuestionsManager projectId="5" />);
    await screen.findByText("Invented question 1");
    return screen
      .getAllByRole("button")
      .map((b) => b.textContent ?? "")
      .filter((t) => MOVES.includes(t));
  };

  it("offers asked, answer and drop on an open question", async () => {
    expect(await buttonsFor("open")).toEqual(["Mark asked", "Record answer", "Drop"]);
  });

  it("offers un-ask, answer and drop on an asked question", async () => {
    expect(await buttonsFor("asked")).toEqual(["Un-ask", "Record answer", "Drop"]);
  });

  it("offers only re-open on an answered question", async () => {
    expect(await buttonsFor("answered")).toEqual(["Re-open"]);
  });

  it("offers only restore on a dropped question", async () => {
    expect(await buttonsFor("dropped")).toEqual(["Restore"]);
  });

  it("sends the transition and shows the new status from the response", async () => {
    const calls = backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(200, question(1, { status: "asked" })),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("button", { name: "Un-ask" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/transition/"))?.body).toEqual({ to: "asked" });
  });

  it("shows the server's refusal and reloads the question, which a teammate had already answered", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () =>
        json(400, { to: ["A answered question cannot become asked."], allowed: ["open"] }),
      [QUESTION_1]: () => json(200, question(1, { status: "answered", current_answer: answerOf() })),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A answered question cannot become asked.");
    expect(await screen.findByRole("button", { name: "Re-open" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark asked" })).not.toBeInTheDocument();
  });

  it("keeps the old status and shows a message when the reload fails too", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A answered question cannot become asked."], allowed: ["open"] }),
      [QUESTION_1]: () => json(500, {}),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A answered question cannot become asked.");
    expect(screen.getByRole("button", { name: "Mark asked" })).toBeInTheDocument();
  });

  it("clears an old error message after a later change succeeds", async () => {
    let first = true;
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => {
        if (first) {
          first = false;
          return Promise.reject(new Error("offline"));
        }
        return json(200, question(1, { status: "asked" }));
      },
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the server/i);
    fireEvent.click(screen.getByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("button", { name: "Un-ask" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("QuestionsManager: add", () => {
  it("posts the three fields and shows the new question", async () => {
    const calls = backend({
      [LIST]: () => json(200, []),
      [ADD]: () => json(201, question(1, { text: "Which providers?", blocks: "Checkout" })),
    });
    render(<QuestionsManager projectId="5" />);
    await screen.findByText(/no questions yet/i);

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Which providers?" } });
    fireEvent.change(screen.getByLabelText("Why it matters"), { target: { value: "Pricing" } });
    fireEvent.change(screen.getByLabelText("What it blocks"), { target: { value: "Checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    const added = await screen.findByTestId("question");
    expect(within(added).getByText("Which providers?")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      text: "Which providers?",
      why_it_matters: "Pricing",
      blocks: "Checkout",
    });
    expect(screen.getByLabelText("Question")).toHaveValue("");
  });

  it("shows the API's message next to the field and keeps what was typed", async () => {
    backend({
      [LIST]: () => json(200, []),
      [ADD]: () => json(400, { text: ["This field may not be blank."] }),
    });
    render(<QuestionsManager projectId="5" />);
    await screen.findByText(/no questions yet/i);

    fireEvent.change(screen.getByLabelText("What it blocks"), { target: { value: "Checkout" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));

    expect(await screen.findByText("This field may not be blank.")).toBeInTheDocument();
    expect(screen.getByLabelText("What it blocks")).toHaveValue("Checkout");
  });

  it("does not send twice while the first request is running", async () => {
    let release: (r: Response) => void = () => {};
    const calls = backend({
      [LIST]: () => json(200, []),
      [ADD]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    render(<QuestionsManager projectId="5" />);
    await screen.findByText(/no questions yet/i);

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Q?" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    const busy = await screen.findByRole("button", { name: /adding/i });
    expect(busy).toBeDisabled();
    // A disabled button cannot be clicked, but Enter in a field submits the form itself.
    fireEvent.submit(busy.closest("form")!);

    // Each send first fetches the CSRF cookie, so a second POST would show up a moment later.
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/questions/"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/questions/"))).toHaveLength(1);
    release(json(201, question(1, { text: "Q?" })));
    await waitFor(() => expect(screen.getByTestId("question")).toBeInTheDocument());
  });

  it("says so when the server cannot be reached and keeps what was typed", async () => {
    backend({
      [LIST]: () => json(200, []),
      [ADD]: () => Promise.reject(new Error("offline")),
    });
    render(<QuestionsManager projectId="5" />);
    await screen.findByText(/no questions yet/i);
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Q?" } });
    fireEvent.click(screen.getByRole("button", { name: "Add question" }));
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("Q?");
  });
});

describe("QuestionsManager: edit", () => {
  it("sends only the field that was changed and shows the saved text", async () => {
    const calls = backend({
      [LIST]: () => json(200, [question(1, { text: "Old text", status: "asked" })]),
      [EDIT_1]: () => json(200, question(1, { text: "New text", status: "asked" })),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const box = screen.getByLabelText("Question", { selector: "#edit-1-text" });
    expect(box).toHaveValue("Old text");
    fireEvent.change(box, { target: { value: "New text" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The edit form closes once the server has answered; its textarea also holds the text.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(screen.getByText("New text")).toBeInTheDocument();
    // Not why_it_matters or blocks: a teammate may have changed them since this page loaded.
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ text: "New text" });
  });

  it("sends nothing when nothing was changed", async () => {
    const calls = backend({ [LIST]: () => json(200, [question(1)]) });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("can clear a field: an emptied field is sent as an empty string", async () => {
    const calls = backend({
      [LIST]: () => json(200, [question(1, { blocks: "Checkout" })]),
      [EDIT_1]: () => json(200, question(1)),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("What it blocks", { selector: "#edit-1-blocks" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ blocks: "" });
  });

  it("shows the API's message and stays in edit mode", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [EDIT_1]: () => json(400, { text: ["This field may not be blank."] }),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Question", { selector: "#edit-1-text" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This field may not be blank.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("cancel leaves the question unchanged and sends nothing", async () => {
    const calls = backend({ [LIST]: () => json(200, [question(1)]) });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Question", { selector: "#edit-1-text" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Invented question 1")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

describe("QuestionsManager: record an answer", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "30 days." } });
    fireEvent.change(screen.getByLabelText("Answered by"), { target: { value: "Əli Məmmədov" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-03-01" } });
    fireEvent.change(screen.getByLabelText("Where"), { target: { value: "meeting" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Weekly sync" } });
  };

  it("opens a form, posts the answer with the transition and shows it", async () => {
    const calls = backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () =>
        json(200, question(1, { status: "answered", current_answer: answerOf({ channel: "meeting" }) })),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByRole("button", { name: "Re-open" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/transition/"))?.body).toEqual({
      to: "answered",
      answer: {
        text: "30 days.",
        answered_by: "Əli Məmmədov",
        answered_on: "2026-03-01",
        channel: "meeting",
        channel_note: "Weekly sync",
      },
    });
  });

  it("starts with today's date and the chat channel", async () => {
    backend({ [LIST]: () => json(200, [question(1)]) });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    expect(screen.getByLabelText("Date")).toHaveValue(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    expect(screen.getByLabelText("Where")).toHaveValue("chat");
  });

  it("shows the API's message next to the date and keeps what was typed", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { answer: { answered_on: ["The answer cannot be dated in the future."] } }),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(await screen.findByText("The answer cannot be dated in the future.")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days.");
  });

  it("shows the refusal when a teammate dropped the question meanwhile, and reloads it", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A dropped question cannot become answered."], allowed: ["open"] }),
      [QUESTION_1]: () => json(200, question(1, { status: "dropped" })),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A dropped question cannot become answered.");
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("shows a message the form has no input for, instead of failing silently", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(502, { error: "Bad gateway" }),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(await screen.findByText("Bad gateway")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days.");
  });

  it("shows a generic message when the server's reply is not JSON", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => new Response("<html>502</html>", { status: 502 }),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(await screen.findByText(/could not change the status/i)).toBeInTheDocument();
  });

  it("links the date's message to the date input", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { answer: { answered_on: ["The answer cannot be dated in the future."] } }),
    });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    const message = await screen.findByText("The answer cannot be dated in the future.");
    const input = screen.getByLabelText("Date");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("cancel closes the form without sending", async () => {
    const calls = backend({ [LIST]: () => json(200, [question(1)]) });
    render(<QuestionsManager projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Answer")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});
