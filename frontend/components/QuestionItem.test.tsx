import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch } from "@/lib/api";
import type { FullQuestion } from "@/lib/questions";

import { QuestionItem } from "./QuestionItem";

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
const TRANSITION_1 = "POST /api/projects/5/questions/1/transition/";
const EDIT_1 = "PATCH /api/projects/5/questions/1/";
const QUESTION_1 = "GET /api/projects/5/questions/1/";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A test-only stand-in for the list around the questions: it loads them and keeps what a changed
 * question sends back, the way the workspace does. The behaviour under test is QuestionItem's.
 * (These tests came from the old questions page, QuestionsManager, removed in #83.)
 */
function Board({ projectId }: { projectId: string }) {
  const base = `/api/projects/${projectId}/questions/`;
  const [questions, setQuestions] = useState<FullQuestion[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch(base)
      .then((response) => response.json())
      .then((list) => {
        if (!cancelled) setQuestions(list as FullQuestion[]);
      });
    return () => {
      cancelled = true;
    };
  }, [base]);
  if (questions === null) return null;
  return (
    <ul>
      {questions.map((q) => (
        <QuestionItem
          key={q.id}
          question={q}
          base={base}
          onChanged={(updated) => setQuestions((list) => (list ?? []).map((x) => (x.id === updated.id ? updated : x)))}
        />
      ))}
    </ul>
  );
}

describe("QuestionItem: status buttons", () => {
  const MOVES = ["Mark asked", "Record answer", "Drop", "Un-ask", "Re-open", "Restore"];

  const buttonsFor = async (status: string) => {
    backend({ [LIST]: () => json(200, [question(1, { status })]) });
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the server/i);
    fireEvent.click(screen.getByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("button", { name: "Un-ask" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});


describe("QuestionItem: edit", () => {
  it("sends only the field that was changed and shows the saved text", async () => {
    const calls = backend({
      [LIST]: () => json(200, [question(1, { text: "Old text", status: "asked" })]),
      [EDIT_1]: () => json(200, question(1, { text: "New text", status: "asked" })),
    });
    render(<Board projectId="5" />);
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

  it("clears an old error message once an edit is saved", async () => {
    let first = true;
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => {
        first = false;
        return Promise.reject(new Error("offline"));
      },
      [EDIT_1]: () => json(200, question(1, { text: "Changed" })),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Drop" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(first).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // opening the form starts clean
    fireEvent.change(screen.getByLabelText("Question", { selector: "#edit-1-text" }), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends nothing when nothing was changed", async () => {
    const calls = backend({ [LIST]: () => json(200, [question(1)]) });
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Question", { selector: "#edit-1-text" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This field may not be blank.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("cancel leaves the question unchanged and sends nothing", async () => {
    const calls = backend({ [LIST]: () => json(200, [question(1)]) });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Question", { selector: "#edit-1-text" }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Invented question 1")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});

describe("QuestionItem: record an answer", () => {
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
    render(<Board projectId="5" />);
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

  // The server refuses an answer date after today in Asia/Baku (#48), so the default must not be after
  // Baku's date, and not after the browser's own date either (a browser in the Americas must not be
  // handed its own future). Which of the two it is depends on the machine's time zone, so this checks
  // the rule at a moment when the calendars differ (20:30 UTC is already the 6th in Baku); the exact
  // dates per zone are in lib/questions.test.ts.
  it("starts with a date that is neither after Baku's today nor after the browser's, and the chat channel", async () => {
    backend({ [LIST]: () => json(200, [question(1)]) });
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-03-05T20:30:00Z");
    vi.setSystemTime(now);
    const pad = (n: number) => String(n).padStart(2, "0");
    const own = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const baku = "2026-03-06";
    try {
      render(<Board projectId="5" />);
      fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
      const value = (screen.getByLabelText("Date") as HTMLInputElement).value;
      expect(value <= baku).toBe(true);
      expect(value <= own).toBe(true);
      expect([own, baku]).toContain(value);
      expect(screen.getByLabelText("Where")).toHaveValue("chat");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the API's message next to the date and keeps what was typed", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { answer: { answered_on: ["The answer cannot be dated in the future."] } }),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(await screen.findByText("The answer cannot be dated in the future.")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days.");
  });

  // #36, the owner's choice B: when the server refuses the answer because the question moved under the
  // person (a teammate answered or dropped it), the form stays open with what they typed, the question
  // behind it is reloaded, and saving is offered again only if the question can still be answered.
  const KEPT_COPY = "Your answer was not saved, but it is kept below so you can copy it. The question cannot be answered in its present state.";
  const KEPT_RETRY = "Your answer was not saved, but it is kept below. Check the question, then save it again.";

  it("keeps the typed answer when a teammate dropped the question meanwhile: the reason, the reloaded question, no save, a hint to copy", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A dropped question cannot become answered."], allowed: ["open"] }),
      [QUESTION_1]: () => json(200, question(1, { status: "dropped" })),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A dropped question cannot become answered.");
    expect(await screen.findByText("Dropped")).toBeInTheDocument(); // the question behind the form is up to date
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days."); // nothing typed is lost
    expect(screen.getByLabelText("Answered by")).toHaveValue("Əli Məmmədov");
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("Weekly sync");
    expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument(); // nothing the status forbids is offered
    expect(screen.getByRole("status")).toHaveTextContent(KEPT_COPY); // announced, and it says the answer was NOT saved

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Answer")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("keeps the typed answer, and offers no save, when a teammate answered the question meanwhile", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A answered question cannot become answered."], allowed: ["open"] }),
      [QUESTION_1]: () => json(200, question(1, { status: "answered", current_answer: answerOf({ text: "Their answer." }) })),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByText("Their answer.")).toBeInTheDocument(); // what the teammate recorded
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days."); // and what this person typed
    expect(screen.queryByRole("button", { name: "Save answer" })).not.toBeInTheDocument();
  });

  it("keeps the form when the reloaded question can still be answered, and saving again works", async () => {
    let attempts = 0;
    const calls = backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => {
        attempts += 1;
        return attempts === 1
          ? json(400, { to: ["The question was changed. Check it and try again."], allowed: ["answered"] })
          : json(200, question(1, { status: "answered", current_answer: answerOf({ text: "30 days." }) }));
      },
      [QUESTION_1]: () => json(200, question(1, { status: "asked" })), // a teammate marked it asked: still answerable
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The question was changed. Check it and try again.");
    expect(screen.getByText(KEPT_RETRY)).toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days.");

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByRole("button", { name: "Re-open" })).toBeInTheDocument(); // saved: the card is back in view mode
    expect(screen.queryByLabelText("Answer")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const posts = calls.filter((c) => c.method === "POST" && c.url.endsWith("/transition/"));
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toEqual(posts[0].body); // the same answer, sent again
  });

  it("keeps the form and the text when the reload fails too, and still offers saving (the server decides)", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A dropped question cannot become answered."], allowed: ["open"] }),
      [QUESTION_1]: () => Promise.reject(new Error("offline")),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("A dropped question cannot become answered.");
    expect(screen.getByLabelText("Answer")).toHaveValue("30 days.");
    expect(screen.getByRole("button", { name: "Save answer" })).toBeInTheDocument();
  });

  it("forgets the hint when the form is cancelled and opened again", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A dropped question cannot become answered."], allowed: ["open"] }),
      [QUESTION_1]: () => json(200, question(1, { status: "asked" })),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await screen.findByText(KEPT_RETRY);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));

    expect(screen.queryByText(KEPT_RETRY)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Answer")).toHaveValue(""); // a fresh form, not the old text
  });

  it("shows a message the form has no input for, instead of failing silently", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(502, { error: "Bad gateway" }),
    });
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
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
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    const message = await screen.findByText("The answer cannot be dated in the future.");
    const input = screen.getByLabelText("Date");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
  });

  it("clears an old error message once an answer is recorded", async () => {
    let first = true;
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: (body) => {
        if (first) {
          first = false;
          return Promise.reject(new Error("offline"));
        }
        return json(200, question(1, { status: (body as { to: string }).to, current_answer: answerOf() }));
      },
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Drop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the server/i);

    fireEvent.click(screen.getByRole("button", { name: "Record answer" }));
    expect(screen.queryByText(/could not reach the server/i)).not.toBeInTheDocument();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    expect(await screen.findByRole("button", { name: "Re-open" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the refusal reason when reloading the question also fails", async () => {
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => json(400, { to: ["A answered question cannot become asked."], allowed: ["open"] }),
      [QUESTION_1]: () => Promise.reject(new Error("offline")),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Mark asked" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A answered question cannot become asked.");
  });

  it("cancel closes the form without sending", async () => {
    const calls = backend({ [LIST]: () => json(200, [question(1)]) });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Answer")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});


describe("QuestionItem look (#56)", () => {
  it("shows a question's status as a chip with the word in it, and its text on its own line", async () => {
    backend({ [LIST]: () => json(200, [question(1, { status: "asked" })]) });
    render(<Board projectId="5" />);

    const item = await screen.findByTestId("question");
    expect(within(item).getByText("Asked").firstElementChild).toHaveClass("bg-status-asked");
    expect(within(item).getByText("Invented question 1")).toBeInTheDocument();
  });

  it("every action on a question is easy to tap, and dropping looks different from the rest", async () => {
    backend({ [LIST]: () => json(200, [question(1)]) });
    render(<Board projectId="5" />);

    const item = await screen.findByTestId("question");
    const buttons = within(item).getAllByRole("button");
    for (const button of buttons) expect(button).toHaveClass("min-h-11");
    const drop = buttons.find((b) => /drop/i.test(b.textContent ?? ""));
    expect(drop).toBeDefined();
    expect(drop).toHaveClass("btn-danger");
    expect(within(item).getByRole("button", { name: "Edit" })).not.toHaveClass("btn-danger");
  });

  it("shows a question's number in monospace and red, and its answer as the example's green-ruled block", async () => {
    backend({ [LIST]: () => json(200, [question(1, { status: "answered", current_answer: answerOf() })]) });
    render(<Board projectId="5" />);

    const item = await screen.findByTestId("question");
    expect(within(item).getByText("Q1")).toHaveClass("font-mono", "text-xs", "text-primary");
    const block = within(item).getByText("30 days.").parentElement!;
    expect(block).toHaveClass("border-l-4", "border-status-answered", "bg-muted");
  });
});

describe("QuestionItem: answers", () => {
  // from the old questions page's list tests: the current answer and the history of older ones
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
    render(<Board projectId="5" />);

    expect(await screen.findByText(/Corrected: 30 days\./)).toBeInTheDocument();
    expect(screen.getByText(/14 days\./)).toBeInTheDocument();
    expect(screen.getAllByText(/Əli Məmmədov/).length).toBeGreaterThan(0);
  });

  it("shows no 'Blocks' line for a question that blocks nothing, and one for a question that does", async () => {
    backend({ [LIST]: () => json(200, [question(1), question(2, { blocks: "Checkout" })]) });
    render(<Board projectId="5" />);
    await screen.findByText("Invented question 1");

    expect(screen.getAllByText(/^Blocks: /)).toHaveLength(1);
    expect(screen.getByText("Blocks: Checkout")).toBeInTheDocument();
  });

  it("the answer form uses a date input and a select, all easy to tap", async () => {
    backend({ [LIST]: () => json(200, [question(1)]) });
    render(<Board projectId="5" />);

    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));

    expect(await screen.findByLabelText("Date")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText("Where").tagName).toBe("SELECT");
    for (const label of ["Answer", "Answered by", "Date", "Where", "Note (optional)"]) expect(screen.getByLabelText(label)).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Save answer" })).toHaveClass("min-h-11");
  });

  it("drops the old reason when saving is tried again and the server refuses for another reason", async () => {
    let attempts = 0;
    backend({
      [LIST]: () => json(200, [question(1)]),
      [TRANSITION_1]: () => {
        attempts += 1;
        return attempts === 1
          ? json(400, { to: ["The question was changed. Check it and try again."], allowed: ["answered"] })
          : json(400, { answer: { answered_on: ["The answer cannot be dated in the future."] } });
      },
      [QUESTION_1]: () => json(200, question(1, { status: "asked" })),
    });
    render(<Board projectId="5" />);
    fireEvent.click(await screen.findByRole("button", { name: "Record answer" }));
    fireEvent.change(screen.getByLabelText("Answer"), { target: { value: "30 days." } });
    fireEvent.change(screen.getByLabelText("Answered by"), { target: { value: "Əli Məmmədov" } });
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await screen.findByText("The question was changed. Check it and try again.");

    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));

    expect(await screen.findByText("The answer cannot be dated in the future.")).toBeInTheDocument();
    expect(screen.queryByText("The question was changed. Check it and try again.")).not.toBeInTheDocument();
  });
});
