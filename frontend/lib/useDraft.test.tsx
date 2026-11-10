import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLanguage } from "./i18n";
import { MAX_QUESTIONS, explain, useDraft } from "./useDraft";

// The drafting code the workspace (and, until #83, the draft page) uses. These tests came from the
// draft page's: what is sent, what is said when drafting fails, what is kept after a failure, copying.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  act(() => setLanguage("en"));
  vi.unstubAllGlobals();
});

describe("explain: what the person is told when drafting fails", () => {
  it.each([
    [503, "draft.err.noSetup"],
    [429, "draft.err.rateLimited"],
    [502, "draft.err.badGateway"],
    [404, "draft.err.notAvailable"],
    [403, "draft.err.signedOut"], // not "the project is gone": a signed-out session or a failed CSRF check answers 403 too
  ])("a %i is our own message %s", async (status, key) => {
    expect(await explain(json(status, {}))).toEqual({ key });
  });

  it("shows the server's own reason when it refuses the selection (400)", async () => {
    expect(await explain(json(400, { questions: ["Not open or asked in this project: Q9."] }))).toEqual({
      text: "Not open or asked in this project: Q9.",
    });
  });

  it("falls back to a plain message for a reply it cannot read", async () => {
    expect(await explain(new Response("<html>oops</html>", { status: 500 }))).toEqual({ key: "draft.err.failed" });
    expect(await explain(json(500, {}))).toEqual({ key: "draft.err.failed" });
  });
});

const url = "/api/projects/5/draft/";

/** A backend that answers each draft request with the next response and records what was sent. */
function backend(...answers: Array<Response | (() => Promise<Response>)>) {
  const sent: unknown[] = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: string, init?: RequestInit) => {
      if (u === "/api/auth/csrf/") return new Response(null, { status: 204 });
      if (u !== url) throw new Error(`unexpected request: ${u}`);
      sent.push(JSON.parse(String(init?.body)));
      const next = answers[Math.min(n++, answers.length - 1)];
      return typeof next === "function" ? next() : next.clone();
    }),
  );
  return sent;
}

describe("useDraft: writing", () => {
  it("allows at most ten questions, the same limit the server enforces", () => {
    expect(MAX_QUESTIONS).toBe(10);
  });

  it("sends the picked numbers in order and nothing else", async () => {
    const sent = backend(json(200, { draft: "Salam." }));
    const { result } = renderHook(() => useDraft("5", [3, 1, 2]));

    await act(() => result.current.write());

    expect(sent).toEqual([{ questions: [1, 2, 3] }]);
    expect(result.current.draft).toBe("Salam.");
  });

  it("sends nothing when no question is picked", async () => {
    const sent = backend(json(200, { draft: "x" }));
    const { result } = renderHook(() => useDraft("5", []));

    await act(() => result.current.write());

    expect(sent).toHaveLength(0);
    expect(result.current.draft).toBeNull();
  });

  it("does not send twice while the first request is running", async () => {
    let release: (r: Response) => void = () => {};
    const sent = backend(() => new Promise<Response>((resolve) => (release = resolve)));
    const { result } = renderHook(() => useDraft("5", [1]));

    act(() => void result.current.write());
    await waitFor(() => expect(sent).toHaveLength(1));
    await act(() => result.current.write()); // a second click, or Enter in a field, while it runs
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent).toHaveLength(1);

    await act(async () => release(json(200, { draft: "Done." })));
    await waitFor(() => expect(result.current.draft).toBe("Done."));
    expect(result.current.writing).toBe(false);
  });
});

describe("useDraft: when drafting does not work", () => {
  it("says so in the language, and shows no draft", async () => {
    backend(json(503, {}));
    const { result } = renderHook(() => useDraft("5", [1]));

    await act(() => result.current.write());

    expect(result.current.error).toBe("Drafting is not set up on this server.");
    expect(result.current.draft).toBeNull();
  });

  it("says the server cannot be reached when the request fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    const { result } = renderHook(() => useDraft("5", [1]));

    await act(() => result.current.write());

    expect(result.current.error).toBe("Could not reach the server.");
  });

  it("keeps an earlier draft when a second attempt fails, and clears the error on the next success", async () => {
    backend(json(200, { draft: "First draft." }), json(502, {}), json(200, { draft: "Third draft." }));
    const { result } = renderHook(() => useDraft("5", [1]));
    await act(() => result.current.write());
    expect(result.current.draft).toBe("First draft.");

    await act(() => result.current.write());
    expect(result.current.error).toBe("The draft could not be written. Try again in a minute.");
    expect(result.current.draft).toBe("First draft.");

    await act(() => result.current.write());
    expect(result.current.error).toBeNull();
    expect(result.current.draft).toBe("Third draft.");
  });

  it("changes its own message when the language changes, but shows the server's text as written", async () => {
    backend(json(429, {}));
    const { result } = renderHook(() => useDraft("5", [1]));
    await act(() => result.current.write());
    expect(result.current.error).toBe("You have asked for a lot of drafts. Try again later.");

    act(() => setLanguage("az"));

    expect(result.current.error).toBe("Çox sayda qaralama istədiniz. Bir az sonra yenidən cəhd edin.");
  });
});

describe("useDraft: a draft already on screen", () => {
  it("is stale once the picked questions no longer match the ones it was written for", async () => {
    backend(json(200, { draft: "Draft." }));
    const { result, rerender } = renderHook(({ picked }) => useDraft("5", picked), { initialProps: { picked: [1] } });
    await act(() => result.current.write());
    expect(result.current.draftIsStale).toBe(false);

    rerender({ picked: [1, 2] });
    expect(result.current.draftIsStale).toBe(true);

    rerender({ picked: [1] });
    expect(result.current.draftIsStale).toBe(false);
  });
});

describe("useDraft: copying", () => {
  const withClipboard = (writeText: (text: string) => Promise<void>) =>
    vi.stubGlobal("navigator", { clipboard: { writeText } });

  it("copies what is in the box now, including edits, and says it was copied", async () => {
    backend(json(200, { draft: "Original." }));
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    const { result } = renderHook(() => useDraft("5", [1]));
    await act(() => result.current.write());
    act(() => result.current.setDraft("Edited by hand."));

    await act(() => result.current.copy());

    expect(writeText).toHaveBeenCalledWith("Edited by hand.");
    expect(result.current.copied).toBe("yes");
  });

  it("tells the person to copy by hand when the browser refuses", async () => {
    backend(json(200, { draft: "Draft." }));
    withClipboard(async () => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useDraft("5", [1]));
    await act(() => result.current.write());

    await act(() => result.current.copy());

    expect(result.current.copied).toBe("failed");
  });

  it("forgets 'copied' when a new draft is requested", async () => {
    backend(json(200, { draft: "One." }), json(200, { draft: "Two." }));
    withClipboard(async () => {});
    const { result } = renderHook(() => useDraft("5", [1]));
    await act(() => result.current.write());
    await act(() => result.current.copy());
    expect(result.current.copied).toBe("yes");

    await act(() => result.current.write());

    expect(result.current.copied).toBeNull();
  });
});
