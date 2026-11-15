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

    fireEvent.click(await screen.findByRole("button", { name: "Accept Q1 · Leyla" }));
    fireEvent.click(screen.getByRole("button", { name: "Save as the answer" }));

    await waitFor(() => expect(within(screen.getByTestId("stat-answered")).getByText("2")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Q1.*Which payment providers/ }));
    const detail = screen.getByRole("region", { name: "Selected question" });
    expect(within(detail).getByText("Stripe and PayPal")).toBeInTheDocument();
    expect(
      within(detail).getByText("Sent through the answer link by Leyla (name not verified) · accepted by owner@example.invalid · 2026-11-15"),
    ).toBeInTheDocument();
  });
});
