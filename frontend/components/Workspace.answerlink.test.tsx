import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Workspace from "./Workspace";

// The workspace together with its two answer-link cards (#114). Nothing is stubbed except the network.
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "5" }),
  usePathname: () => "/projects/5",
  useRouter: () => ({ push }),
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const project = { id: 5, name: "Ticketing", client_name: "Invented Client", description: "", my_role: "owner", open_question_count: 2, created_at: "", updated_at: "" };
const projectsReply = (url: string) => (/^\/api\/projects\/\d+\/$/.test(url) ? json(200, project) : json(200, { count: 1, page: 1, page_size: 25, results: [project] }));

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
const members = [{ user_id: 1, email: "owner@example.invalid", name: "Olga Owner", role: "owner", added_at: "2026-01-01T00:00:00Z" }];

function api() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/answer-link/")) return json(200, { exists: false });
      if (url.includes("/submissions/")) return json(200, []);
      if (url.includes("/questions/")) return json(200, questions);
      if (url.endsWith("/members/")) return json(200, members);
      return projectsReply(url);
    }),
  );
}

describe("Workspace: answers sent through the answer link (#114)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const waiting = {
    id: 9,
    question_number: 1,
    question_label: "Q1",
    question_text: "Which payment providers are allowed?",
    text: "Stripe and PayPal",
    submitter_name: "Leyla",
    submitted_at: "2026-11-15T09:30:00Z",
    state: "pending",
    decided_by: null,
    decided_at: null,
  };

  it("shows the answers panel and the link panel beside the add form", async () => {
    api();
    render(<Workspace />);

    expect(await screen.findByRole("heading", { name: "Answers from the link" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Answer link" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add a question" })).toBeInTheDocument();
  });

  it("accepting an answer reloads that question, which then shows as answered through the answer link", async () => {
    let accepted = false;
    const answeredQ1 = {
      ...q(1, "answered", "Which payment providers are allowed?"),
      current_answer: {
        id: 1,
        text: "Stripe and PayPal",
        answered_by: "Leyla",
        answered_on: "2026-11-15",
        channel: "link",
        channel_note: "",
        recorded_by: "owner@example.invalid",
        recorded_at: "2026-11-15T10:00:00Z",
        superseded_at: null,
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (url.includes("/submissions/9/accept/") && init?.method === "POST") {
          accepted = true;
          return json(200, { ...waiting, state: "accepted" });
        }
        if (url.includes("/submissions/")) return json(200, accepted ? [] : [waiting]);
        if (url.includes("/answer-link/")) return json(200, { exists: false });
        if (url.endsWith("/questions/1/")) return json(200, answeredQ1);
        if (url.includes("/questions/")) return json(200, questions);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    render(<Workspace />);
    expect(within(await screen.findByTestId("stat-answered")).getByText("1")).toBeInTheDocument();

    // The waiting answer is inside its question: open the question (from the summary card, or by pressing its row).
    fireEvent.click(await screen.findByRole("button", { name: "Open Q1 (1 waiting)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Accept Q1 · Leyla" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as the answer" }));

    await waitFor(() => expect(within(screen.getByTestId("stat-answered")).getByText("2")).toBeInTheDocument());
    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(within(detail).getByText("Stripe and PayPal")).toBeInTheDocument();
    expect(
      within(detail).getByText("Sent through the answer link by Leyla (name not verified) · accepted by owner@example.invalid · 2026-11-15"),
    ).toBeInTheDocument();
  });
});

describe("Workspace: answers sent through the link are inside their question (#121)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const waiting = (number: number, text: string) => ({
    id: number * 10,
    question_number: number,
    question_label: `Q${number}`,
    question_text: "x",
    text,
    submitter_name: "Leyla",
    submitted_at: "2026-11-15T09:30:00Z",
    state: "pending",
    decided_by: null,
    decided_at: null,
  });

  function apiWith(pending: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/submissions/")) return json(200, url.includes("state=pending") ? pending : []);
        if (url.includes("/answer-link/")) return json(200, { exists: false });
        if (url.includes("/questions/")) return json(200, questions);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
  }

  it("marks a question that has answers waiting, and shows them only when that question is open", async () => {
    apiWith([waiting(1, "Stripe and PayPal"), waiting(1, "Or cash"), waiting(2, "Ali approves")]);
    render(<Workspace />);
    const row1 = await screen.findByRole("button", { name: /Q1.*Which payment providers/ });

    expect(await within(row1).findByText("2 waiting")).toBeInTheDocument();
    expect(await within(screen.getByRole("button", { name: /Q2.*Who approves refunds/ })).findByText("1 waiting")).toBeInTheDocument();
    expect(screen.queryByText("Stripe and PayPal")).not.toBeInTheDocument(); // not in the right-hand column, not before the question is open

    fireEvent.click(row1);

    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(within(detail).getByText("Stripe and PayPal")).toBeInTheDocument();
    expect(within(detail).getByText("Or cash")).toBeInTheDocument();
    expect(within(detail).queryByText("Ali approves")).not.toBeInTheDocument(); // Q2's own, inside Q2
  });

  it("opens the question from the summary card, even when a filter was hiding it, and puts the keyboard there", async () => {
    apiWith([waiting(1, "Stripe and PayPal")]);
    render(<Workspace />);
    fireEvent.click(await screen.findByRole("button", { name: "Answered" })); // Q1 is open, so it is hidden now
    expect(screen.queryByRole("button", { name: /Q1.*Which payment providers/ })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open Q1 (1 waiting)" }));

    const detail = await screen.findByRole("region", { name: "Selected question" });
    expect(within(detail).getByText("Stripe and PayPal")).toBeInTheDocument();
    await waitFor(() => expect(detail).toHaveFocus());
  });

  it("keeps working when the questions have no answers waiting: no badge, nothing extra inside", async () => {
    apiWith([]);
    render(<Workspace />);
    const row = await screen.findByRole("button", { name: /Q1.*Which payment providers/ });
    fireEvent.click(row);

    expect(within(row).queryByText(/waiting/)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Waiting for you: answers sent through the answer link" })).not.toBeInTheDocument();
    expect(await screen.findByText("Nothing is waiting. Answers sent through the link appear here.")).toBeInTheDocument();
  });
});

describe("Workspace: the summary card opens a question the page has not loaded yet (#121)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the question, then opens it with its waiting answer", async () => {
    const added = q(9, "open", "A question another member added meanwhile");
    const waitingForNine = {
      id: 90,
      question_number: 9,
      question_label: "Q9",
      question_text: "x",
      text: "Answer for the new one",
      submitter_name: "Leyla",
      submitted_at: "2026-11-15T09:30:00Z",
      state: "pending",
      decided_by: null,
      decided_at: null,
    };
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("/submissions/")) return json(200, url.includes("state=pending") ? [waitingForNine] : []);
        if (url.includes("/answer-link/")) return json(200, { exists: false });
        if (url.endsWith("/questions/9/")) return json(200, added);
        if (url.includes("/questions/")) return json(200, questions);
        if (url.endsWith("/members/")) return json(200, members);
        return projectsReply(url);
      }),
    );
    render(<Workspace />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Q9 (1 waiting)" }));

    const detail = await screen.findByRole("region", { name: "Selected question" });
    expect(within(detail).getByText("Answer for the new one")).toBeInTheDocument();
    expect(screen.getByText("A question another member added meanwhile")).toBeInTheDocument();
    expect(calls).toContain("/api/projects/5/questions/9/");
  });
});
