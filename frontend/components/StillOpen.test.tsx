import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/asked · open for 1 day\b/)).toBeInTheDocument();
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
});
