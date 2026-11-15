import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AnswerPage, { metadata } from "./page";

// The page a client opens with a private link (#114).
describe("AnswerPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("keeps itself out of search results and hands no address to anyone", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    expect(String(metadata.title)).toMatch(/Sual-Cavab/);
  });

  it("is the client's page: loading first, with no sign-in and no way into the rest of the app", () => {
    window.history.replaceState(null, "", `/answer#${"k".repeat(43)}`);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<AnswerPage />);

    expect(screen.getByText("Loading the questions…")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
