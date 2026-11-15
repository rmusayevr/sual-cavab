import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ClientWorkspace from "./ClientWorkspace";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "7" }), usePathname: () => "/answering/7", useSearchParams: () => new URLSearchParams() }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const QUESTIONS = "GET /api/client/projects/7/questions/";
const SEND_1 = "POST /api/client/projects/7/questions/1/answers/";

const view = (over: Record<string, unknown> = {}) => ({
  project_name: "Invented booking site",
  questions: [
    { number: 1, label: "Q1", text: "Which payment provider?", why_it_matters: "Checkout", blocks: "", mine: [] },
    {
      number: 2,
      label: "Q2",
      text: "Which languages?",
      why_it_matters: "",
      blocks: "Launch",
      mine: [{ text: "English and Azerbaijani", state: "pending", submitted_at: "2026-11-15T09:00:00Z" }],
    },
  ],
  earlier: [],
  ...over,
});

type Call = { url: string; method: string; body: unknown };

function backend(routes: Record<string, (body: unknown) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      if (url === "/api/auth/me/") return json(200, { id: 9, email: "ada@example.invalid", name: "Ada Client" });
      const route = routes[`${method} ${url}`];
      if (!route) throw new Error(`unexpected request: ${method} ${url}`);
      return route(body);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("ClientWorkspace (#121)", () => {
  it("shows the project's open questions, and what this person already sent", async () => {
    backend({ [QUESTIONS]: () => json(200, view()) });
    render(<ClientWorkspace />);

    expect(await screen.findByRole("heading", { name: "Invented booking site" })).toBeInTheDocument();
    expect(screen.getByText("Which payment provider?")).toBeInTheDocument();
    expect(screen.getByText("Which languages?")).toBeInTheDocument();
    expect(screen.getByText("English and Azerbaijani")).toBeInTheDocument();
    expect(screen.getByText("Waiting for the team")).toBeInTheDocument();
    // a signed-in client is never asked for a name: the team sees the account's
    expect(screen.queryByLabelText(/your name/i)).not.toBeInTheDocument();
  });

  it("sends the text only, shows it under the question as waiting, and clears the box", async () => {
    const calls = backend({
      [QUESTIONS]: () => json(200, view()),
      [SEND_1]: () => json(201, { text: "Stripe", state: "pending", submitted_at: "2026-11-15T10:00:00Z" }),
    });
    render(<ClientWorkspace />);

    fireEvent.change(await screen.findByLabelText("Your answer to Q1"), { target: { value: "Stripe" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Send answer" })[0]);

    expect(await screen.findByText("Thank you. Your answer was sent to the team.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your answer to Q1")).toHaveValue("");
    const q1 = screen.getByText("Which payment provider?").closest("li")!;
    expect(within(q1).getByText("Stripe")).toBeInTheDocument();
    const sent = calls.find((c) => c.method === "POST" && c.url.endsWith("/answers/"))!;
    expect(sent.body).toEqual({ text: "Stripe" });
  });

  it("asks for an answer before sending anything", async () => {
    const calls = backend({ [QUESTIONS]: () => json(200, view()) });
    render(<ClientWorkspace />);

    fireEvent.click((await screen.findAllByRole("button", { name: "Send answer" }))[0]);

    expect(await screen.findByText("Please write your answer.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("says when the question no longer takes answers, and checking again reads the list", async () => {
    let reads = 0;
    backend({
      [QUESTIONS]: () => (++reads === 1 ? json(200, view()) : json(200, view({ questions: [] }))),
      [SEND_1]: () => json(404, { detail: "Not found." }),
    });
    render(<ClientWorkspace />);

    fireEvent.change(await screen.findByLabelText("Your answer to Q1"), { target: { value: "Stripe" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Send answer" })[0]);

    expect(await screen.findByText(/can no longer take answers/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.queryByText("Which payment provider?")).not.toBeInTheDocument());
    expect(await screen.findByText("There is nothing to answer right now. Thank you.")).toBeInTheDocument();
  });

  it("says so when too many answers are waiting", async () => {
    backend({ [QUESTIONS]: () => json(200, view()), [SEND_1]: () => json(429, { detail: "slow down" }) });
    render(<ClientWorkspace />);

    fireEvent.change(await screen.findByLabelText("Your answer to Q1"), { target: { value: "Stripe" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Send answer" })[0]);

    expect(await screen.findByText(/too many requests or answers are waiting/)).toBeInTheDocument();
  });

  it("lists this person's own earlier answers on questions that have closed, with the state, as plain text", async () => {
    backend({
      [QUESTIONS]: () =>
        json(200, view({ earlier: [{ label: "Q3", question_text: "Which <b>logo</b>?", text: "<i>The blue one</i>", state: "accepted" }] })),
    });
    const { container } = render(<ClientWorkspace />);

    expect(await screen.findByText("<i>The blue one</i>")).toBeInTheDocument();
    expect(screen.getByText("Which <b>logo</b>?")).toBeInTheDocument();
    expect(screen.getByText("The team accepted this answer")).toBeInTheDocument();
    expect(container.querySelector("i, b")).toBeNull();
  });

  it("shows the signed-out page on 403, and not found on 404 (a stranger and a missing project look the same)", async () => {
    backend({ [QUESTIONS]: () => json(403, { detail: "no" }) });
    const first = render(<ClientWorkspace />);
    expect(await screen.findByText(/to see this project/)).toBeInTheDocument();
    first.unmount();

    backend({ [QUESTIONS]: () => json(404, { detail: "Not found." }) });
    render(<ClientWorkspace />);
    expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  });

  it("offers a way to try again when the list cannot be loaded", async () => {
    backend({ [QUESTIONS]: () => json(500, {}) });
    render(<ClientWorkspace />);

    expect(await screen.findByText("Could not load the questions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
