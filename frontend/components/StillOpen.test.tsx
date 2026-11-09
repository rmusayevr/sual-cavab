import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import StillOpen from "./StillOpen";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const NOW = new Date("2026-03-10T12:00:00Z");
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

describe("StillOpen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks the backend for open and asked questions of this project only", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => json(200, []));
    vi.stubGlobal("fetch", fetchMock);
    render(<StillOpen projectId="5" now={NOW} />);
    await screen.findByText(/nothing is open/i);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/5/questions/?status=open,asked");
  });

  it("lists each question with its number, status, what it blocks and how long it has been open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(200, [
          question(1, { blocks: "Refund screen", created_at: "2026-03-05T12:00:00Z" }),
          question(2, { status: "asked", created_at: "2026-03-09T12:00:00Z" }),
          question(3, { created_at: "2026-03-10T08:00:00Z" }),
        ]),
      ),
    );
    render(<StillOpen projectId="5" now={NOW} />);

    expect(await screen.findByText("Q1")).toBeInTheDocument();
    expect(screen.getByText("Invented question 1")).toBeInTheDocument();
    expect(screen.getByText(/Blocks: Refund screen/)).toBeInTheDocument();
    expect(screen.getByText(/open for 5 days/)).toBeInTheDocument();
    // The status is a chip with the word in it (it used to be the text prefix "asked · "); the age stays its own
    // line. Each is tied to ITS question, which the old single regex did for Q2 only.
    const item = (label: string) => within(screen.getByText(label).closest("li")!);
    expect(item("Q1").getByText("Open")).toBeInTheDocument();
    expect(item("Q1").getByText(/^open for 5 days/)).toBeInTheDocument();
    expect(item("Q2").getByText("Asked")).toBeInTheDocument();
    expect(item("Q2").getByText(/^open for 1 day\b/)).toBeInTheDocument();
    expect(item("Q3").getByText("Open")).toBeInTheDocument();
    expect(item("Q3").getByText(/^open for less than a day/)).toBeInTheDocument();
    expect(screen.getByText(/open for less than a day/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /still open \(3\)/i })).toBeInTheDocument();
  });

  it("shows no Blocks line for a question that blocks nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [question(1)])));
    render(<StillOpen projectId="5" now={NOW} />);
    await screen.findByText("Q1");
    expect(screen.queryByText(/Blocks:/)).not.toBeInTheDocument();
  });

  it("shows a loading state first", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<StillOpen projectId="5" now={NOW} />);
    expect(screen.getByText(/loading questions/i)).toBeInTheDocument();
  });

  it("shows an error, not an empty list, when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500, {})));
    render(<StillOpen projectId="5" now={NOW} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the questions/i);
    expect(screen.queryByText(/nothing is open/i)).not.toBeInTheDocument();
  });

  it("shows an error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    render(<StillOpen projectId="5" now={NOW} />);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a question's own status, whatever it is (the list is filtered by the server, not by this component)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, [question(1, { status: "answered" })])));
    render(<StillOpen projectId="5" now={NOW} />);

    expect(await screen.findByText("Answered")).toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
  });
});
