import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import QuestionsScreen from "./QuestionsScreen";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "5" }) }));

describe("QuestionsScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the questions of the project in the URL and links back to it", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<QuestionsScreen />);

    expect(await screen.findByText(/no questions yet/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/5/questions/", expect.anything());
    expect(screen.getByRole("link", { name: "Back to the project" })).toHaveAttribute("href", "/projects/5");
  });
});
