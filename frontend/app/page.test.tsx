import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the product name as the main heading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1, name: "Sual-Cavab" })).toBeInTheDocument();
  });
});
