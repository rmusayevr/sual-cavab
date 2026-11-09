import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LedgerLoading } from "./Ledger";
import { WAKING_TEXT, WakingNote } from "./WakingNote";

// #38: after 15 idle minutes Render's free services sleep. Measured on staging (3 clean samples after
// 20 idle minutes): the API took 82.6, 92.3 and 92.5 s to answer the first request, the web service
// about 33 s, and a warm request 0.1 s. A person who waits that long is told why.
describe("WakingNote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing at first, and says why the wait is long after five seconds", () => {
    render(<WakingNote active />);

    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText(WAKING_TEXT)).toBeInTheDocument();
  });

  it("is a polite status message", () => {
    render(<WakingNote active />);
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByRole("status")).toHaveTextContent(WAKING_TEXT);
  });

  it("says nothing when nothing is being waited for", () => {
    render(<WakingNote active={false} />);
    act(() => vi.advanceTimersByTime(60_000));

    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
  });

  it("names the wait in words a visitor understands: idle, waking up, up to two minutes", () => {
    expect(WAKING_TEXT).toMatch(/idle/i);
    expect(WAKING_TEXT).toMatch(/waking up/i);
    expect(WAKING_TEXT).toMatch(/two minutes/i);
  });

  it("a loading state shows it only after the wait has gone on for a while", () => {
    render(<LedgerLoading label="Loading projects…" />);

    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
    expect(screen.queryByText(WAKING_TEXT)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByText(WAKING_TEXT)).toBeInTheDocument();
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
  });
});
