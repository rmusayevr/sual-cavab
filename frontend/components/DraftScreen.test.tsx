import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import DraftScreen, { MAX_QUESTIONS } from "./DraftScreen";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const question = (n: number, over: Record<string, unknown> = {}) => ({
  id: n,
  number: n,
  label: `Q${n}`,
  text: `Invented question ${n}`,
  why_it_matters: "",
  blocks: "",
  status: "open",
  created_at: "2026-03-05T12:00:00Z",
  ...over,
});

type Call = { url: string; method: string; body: unknown };

function backend(routes: Record<string, (body: unknown) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      const route = routes[`${method} ${url}`];
      if (!route) throw new Error(`unexpected request: ${method} ${url}`);
      return route(body);
    }),
  );
  return calls;
}

const LIST = "GET /api/projects/5/questions/?status=open,asked";
const DRAFT = "POST /api/projects/5/draft/";
const THREE = [question(1), question(2, { status: "asked" }), question(3)];

const pick = async (...labels: string[]) => {
  for (const label of labels) fireEvent.click(await screen.findByRole("checkbox", { name: new RegExp(`^${label}\\b`) }));
};

const draftBackend = (extra: Record<string, (body: unknown) => Response | Promise<Response>> = {}) =>
  backend({ [LIST]: () => json(200, THREE), ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DraftScreen: loading the questions", () => {
  it("shows a loading state first", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<DraftScreen />);
    expect(screen.getByText(/loading questions/i)).toBeInTheDocument();
  });

  it("asks only for open and asked questions of this project", async () => {
    const calls = draftBackend();
    render(<DraftScreen />);
    await screen.findByText(/Invented question 1/);
    expect(calls[0].url).toBe("/api/projects/5/questions/?status=open,asked");
  });

  it("says so when nothing is open, and offers no draft button", async () => {
    backend({ [LIST]: () => json(200, []) });
    render(<DraftScreen />);
    expect(await screen.findByText(/nothing is open/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /write a draft/i })).not.toBeInTheDocument();
  });

  it("shows an error, not an empty list, when loading fails", async () => {
    backend({ [LIST]: () => json(500, {}) });
    render(<DraftScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the questions/i);
    expect(screen.queryByText(/nothing is open/i)).not.toBeInTheDocument();
  });

  it("shows not found for a project the backend hides", async () => {
    backend({ [LIST]: () => json(404, { detail: "No Project matches the given query." }) });
    render(<DraftScreen />);
    expect(await screen.findByText(/project not found/i)).toBeInTheDocument();
  });
});

describe("DraftScreen: choosing and writing", () => {
  it("tells the person what is sent to Claude, and that the app sends nothing", async () => {
    draftBackend();
    render(<DraftScreen />);
    const notice = await screen.findByText(/is sent to Claude/i);
    expect(notice).toHaveTextContent(/never sends the message anywhere/i);
    expect(notice).toHaveTextContent(/nothing else about the project or the client/i);
  });

  it("has no send, email or share button anywhere", async () => {
    draftBackend();
    render(<DraftScreen />);
    await screen.findByText(/Invented question 1/);
    expect(screen.queryByRole("button", { name: /send|email|share|post/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send|email|mailto/i })).not.toBeInTheDocument();
  });

  it("cannot ask until at least one question is picked", async () => {
    draftBackend();
    render(<DraftScreen />);
    const button = await screen.findByRole("button", { name: "Write a draft" });
    expect(button).toBeDisabled();
    await pick("Q1");
    expect(button).toBeEnabled();
  });

  it("sends the picked numbers, in order, and nothing else", async () => {
    const calls = draftBackend({ [DRAFT]: () => json(200, { draft: "Salam!", model: "claude-sonnet-5-5" }) });
    render(<DraftScreen />);
    await pick("Q3", "Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByLabelText(/draft \(edit it/i);
    expect(calls.find((c) => c.url.endsWith("/draft/") && c.method === "POST")?.body).toEqual({ questions: [1, 3] });
  });

  it("shows the draft in an editable box and says nothing was sent", async () => {
    draftBackend({ [DRAFT]: () => json(200, { draft: "Salam! Q1: provayderlər?", model: "claude-sonnet-5-5" }) });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    const box = await screen.findByLabelText(/draft \(edit it/i);
    expect(box).toHaveValue("Salam! Q1: provayderlər?");
    fireEvent.change(box, { target: { value: "Edited text" } });
    expect(box).toHaveValue("Edited text");
    expect(screen.getByText(/nothing has been sent/i)).toBeInTheDocument();
  });

  it("allows at most ten questions", async () => {
    backend({ [LIST]: () => json(200, Array.from({ length: 12 }, (_, i) => question(i + 1))) });
    render(<DraftScreen />);
    for (let n = 1; n <= MAX_QUESTIONS; n++) await pick(`Q${n}`);
    expect(screen.getByRole("checkbox", { name: /^Q11\b/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /^Q1\b/ })).toBeEnabled(); // a picked one can still be unpicked
    fireEvent.click(screen.getByRole("checkbox", { name: /^Q1\b/ }));
    expect(screen.getByRole("checkbox", { name: /^Q11\b/ })).toBeEnabled();
  });

  it("does not send twice while the first request is running", async () => {
    let release: (r: Response) => void = () => {};
    const calls = draftBackend({ [DRAFT]: () => new Promise<Response>((resolve) => (release = resolve)) });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    const busy = await screen.findByRole("button", { name: /writing/i });
    expect(busy).toBeDisabled();
    fireEvent.submit(busy.closest("form")!); // Enter in the form
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/draft/"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((c) => c.method === "POST" && c.url.endsWith("/draft/"))).toHaveLength(1);
    release(json(200, { draft: "Salam", model: "m" }));
    await screen.findByLabelText(/draft \(edit it/i);
  });
});

describe("DraftScreen: when drafting does not work", () => {
  const fails = async (response: () => Response | Promise<Response>) => {
    draftBackend({ [DRAFT]: response });
    render(<DraftScreen />);
    await pick("Q1", "Q2");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    return await screen.findByRole("alert");
  };

  it("says drafting is not set up when the server answers 503", async () => {
    expect(await fails(() => json(503, { detail: "Drafting is not set up on this server." }))).toHaveTextContent(
      "Drafting is not set up on this server.",
    );
  });

  it("shows the fixed message when the draft could not be written (502)", async () => {
    expect(await fails(() => json(502, { detail: "The draft could not be written. Try again in a minute." }))).toHaveTextContent(
      "The draft could not be written. Try again in a minute.",
    );
  });

  it("says so when the limit is reached (429)", async () => {
    expect(await fails(() => json(429, { detail: "Request was throttled." }))).toHaveTextContent(/a lot of drafts/i);
  });

  it("shows the server's reason when it refuses the selection (400)", async () => {
    expect(await fails(() => json(400, { questions: ["Not open or asked in this project: Q2."] }))).toHaveTextContent(
      "Not open or asked in this project: Q2.",
    );
  });

  it("says so when the server cannot be reached", async () => {
    expect(await fails(() => Promise.reject(new Error("offline")))).toHaveTextContent(/could not reach the server/i);
  });

  it("does not claim the project is gone when the session has ended (403)", async () => {
    expect(await fails(() => json(403, { detail: "Authentication credentials were not provided." }))).toHaveTextContent(
      /signed out\. Sign in again/i,
    );
  });

  it("falls back to a plain message for a reply it cannot read", async () => {
    expect(await fails(() => new Response("<html>oops</html>", { status: 500 }))).toHaveTextContent(
      "Could not write the draft.",
    );
  });

  it("keeps the picked questions after a failure, and shows no draft", async () => {
    await fails(() => json(502, {}));
    expect(screen.getByRole("checkbox", { name: /^Q1\b/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^Q2\b/ })).toBeChecked();
    expect(screen.queryByLabelText(/draft \(edit it/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Write a draft" })).toBeEnabled();
  });

  it("keeps an earlier draft when a second attempt fails", async () => {
    let first = true;
    draftBackend({
      [DRAFT]: () => {
        if (first) {
          first = false;
          return json(200, { draft: "First draft", model: "m" });
        }
        return json(502, {});
      },
    });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByDisplayValue("First draft");
    fireEvent.click(screen.getByRole("button", { name: /write a new draft/i }));
    await screen.findByRole("alert");
    expect(screen.getByDisplayValue("First draft")).toBeInTheDocument();
  });
});

describe("DraftScreen: a draft that is already on screen", () => {
  const shown = async () => {
    draftBackend({ [DRAFT]: () => json(200, { draft: "First draft", model: "m" }) });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByDisplayValue("First draft");
  };

  it("says that writing again replaces it", async () => {
    await shown();
    expect(screen.getByRole("button", { name: /write a new draft \(replaces the one below\)/i })).toBeInTheDocument();
  });

  it("warns when the ticked questions no longer match the draft", async () => {
    await shown();
    expect(screen.queryByText(/ticked questions have changed/i)).not.toBeInTheDocument();
    await pick("Q2");
    expect(screen.getByText(/ticked questions have changed/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Q2\b/ })); // back to the same set
    expect(screen.queryByText(/ticked questions have changed/i)).not.toBeInTheDocument();
  });
});

describe("DraftScreen: copying", () => {
  const withClipboard = (writeText: (text: string) => Promise<void>) =>
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  const draftShown = async () => {
    draftBackend({ [DRAFT]: () => json(200, { draft: "Original draft", model: "m" }) });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    return await screen.findByLabelText(/draft \(edit it/i);
  };

  it("copies what is in the box now, including edits", async () => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    const box = await draftShown();
    fireEvent.change(box, { target: { value: "Edited draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("Edited draft");
  });

  it("stops saying Copied once the text is edited", async () => {
    withClipboard(async () => {});
    const box = await draftShown();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await screen.findByText("Copied.");
    fireEvent.change(box, { target: { value: "Changed after copying" } });
    expect(screen.queryByText("Copied.")).not.toBeInTheDocument();
  });

  it("tells the person to copy by hand when the browser refuses", async () => {
    withClipboard(async () => {
      throw new Error("denied");
    });
    await draftShown();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });
});

describe("DraftScreen look (#57)", () => {
  it("each question is a row that is easy to tap, with the checkbox and the whole text in one label", async () => {
    draftBackend();
    render(<DraftScreen />);

    const box = await screen.findByRole("checkbox", { name: /^Q1\b/ });
    expect(box.closest("label")).toHaveClass("min-h-11", "rounded-lg");
    expect(box.closest("label")).toHaveTextContent("Invented question 1");
  });

  it("the buttons are easy to tap", async () => {
    draftBackend({ [DRAFT]: () => json(200, { draft: "Salam!", model: "m" }) });
    render(<DraftScreen />);
    await pick("Q1");

    expect(screen.getByRole("button", { name: "Write a draft" })).toHaveClass("min-h-11");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    expect(await screen.findByRole("button", { name: "Copy" })).toHaveClass("min-h-11");
  });

  it("a failed draft is shown as an error message right under the button, in the error colours", async () => {
    draftBackend({ [DRAFT]: () => json(502, {}) });
    render(<DraftScreen />);
    await pick("Q1");
    const write = screen.getByRole("button", { name: "Write a draft" });
    fireEvent.click(write);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveClass("border-primary", "text-primary");
    expect(alert).toHaveTextContent("The draft could not be written");
    // the same card as the button, and after it, so the message is not far below the fold on a phone
    expect(alert.closest("form")).toBe(write.closest("form"));
    expect(write.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the draft box is the shared text area, tied to its label", async () => {
    draftBackend({ [DRAFT]: () => json(200, { draft: "Salam!", model: "m" }) });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));

    const box = await screen.findByLabelText(/draft \(edit it/i);
    expect(box).toHaveClass("font-sans");
    expect(box).toHaveAttribute("rows", "10");
  });

  it("still has no way to send anything", async () => {
    draftBackend({ [DRAFT]: () => json(200, { draft: "Salam!", model: "m" }) });
    render(<DraftScreen />);
    await pick("Q1");
    fireEvent.click(screen.getByRole("button", { name: "Write a draft" }));
    await screen.findByLabelText(/draft \(edit it/i);

    expect(screen.queryByRole("button", { name: /send|email|share|post/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /send|email|share|post|mailto/i })).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(screen.getByText(/nothing has been sent/i)).toBeInTheDocument();
  });

  it("once ten are ticked, the other rows look unavailable, not only their checkbox", async () => {
    backend({
      [LIST]: () => json(200, Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => question(i + 1))),
    });
    render(<DraftScreen />);
    await pick(...Array.from({ length: MAX_QUESTIONS }, (_, i) => `Q${i + 1}`));

    const row = screen.getByRole("checkbox", { name: /^Q11\b/ }).closest("label")!;
    expect(row).toHaveClass("has-[:disabled]:cursor-not-allowed", "has-[:disabled]:opacity-60");
    expect(screen.getByRole("checkbox", { name: /^Q1\b/ }).closest("label")).toHaveClass("cursor-pointer");
  });

  it("a long question without spaces can shrink inside its row", async () => {
    backend({ [LIST]: () => json(200, [question(1, { text: "https://example.invalid/" + "a".repeat(80) })]) });
    render(<DraftScreen />);

    const text = (await screen.findByText(/^https:\/\/example\.invalid/)).closest("span")!;
    expect(text).toHaveClass("min-w-0");
  });
});
