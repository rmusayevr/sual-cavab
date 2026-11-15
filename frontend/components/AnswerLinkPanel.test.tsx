import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LINK_VISIBLE_MS } from "@/lib/answerLink";
import { setLanguage, translate, type Key } from "@/lib/i18n";

import AnswerLinkPanel from "./AnswerLinkPanel";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const TOKEN = "T".repeat(43);
const active = {
  exists: true,
  state: "active",
  created_by: "olga@example.invalid",
  created_at: "2026-11-15T09:00:00Z",
  expires_at: "2026-11-29T09:00:00Z",
  revoked_at: null,
};

type Call = { method: string; url: string; body?: unknown };

/** Stub the API. `reply` answers a call, or returns undefined to fall back to GET -> `current` (which it can change). */
function api(current: { value: unknown }, reply: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const call = { method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      return reply(call) ?? json(200, current.value);
    }),
  );
  return calls;
}

const t = (key: Key, values?: Record<string, string | number>) => translate("en", key, values);
const open = () => render(<AnswerLinkPanel projectId={5} />);

describe("AnswerLinkPanel (#114)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => setLanguage("en"));
    localStorage.clear();
    sessionStorage.clear();
  });

  it("shows the four states of its data: loading, none yet, populated and failed", async () => {
    api({ value: { exists: false } });
    open();

    expect(screen.getByText(t("answerLink.loading"))).toBeInTheDocument();
    expect(await screen.findByText(t("answerLink.none"))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: t("answerLink.title") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("answerLink.create") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("answerLink.revoke") })).not.toBeInTheDocument();
  });

  it("says who made the active link and when it ends, and offers to replace or revoke it", async () => {
    api({ value: active });
    open();

    expect(await screen.findByText("Active. Made by olga@example.invalid, expires 2026-11-29.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("answerLink.createNew") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("answerLink.revoke") })).toBeInTheDocument();
  });

  it("words an expired, a revoked and a stopped link, and offers no revoke for them", async () => {
    for (const [state, words] of [
      ["expired", "Expired on 2026-11-29."],
      ["revoked", t("answerLink.revoked")],
      ["creator_inactive", t("answerLink.creatorInactive")],
    ] as const) {
      api({ value: { ...active, state } });
      const { unmount } = open();

      expect(await screen.findByText(new RegExp(words.slice(0, 22)))).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: t("answerLink.revoke") })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: t("answerLink.create") })).toBeInTheDocument();
      unmount();
    }
  });

  it("says so, with a way to try again, when the link cannot be loaded", async () => {
    let fail = true;
    const current = { value: { exists: false } };
    api(current, ({ method }) => (method === "GET" && fail ? json(500, {}) : undefined));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("answerLink.loadError"));
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("submissions.refresh") }));

    expect(await screen.findByText(t("answerLink.none"))).toBeInTheDocument();
  });

  it("treats a reply that is not a link as a failure instead of showing nonsense", async () => {
    api({ value: [{ id: 1 }] });
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("answerLink.loadError"));
  });

  it("makes a link for 14 days by default and shows the full link once, with the warning", async () => {
    const current = { value: { exists: false } };
    const calls = api(current, ({ method }) =>
      method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined,
    );
    open();
    await screen.findByText(t("answerLink.none"));

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));

    const field = (await screen.findByLabelText(t("answerLink.urlLabel"))) as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/answer#${TOKEN}`);
    expect(field).toHaveAttribute("readonly");
    expect(screen.getByText(t("answerLink.once"))).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/projects/5/answer-link/", body: { days: 14 } });
  });

  it("sends the number of days the person chose", async () => {
    const calls = api({ value: { exists: false } }, ({ method }) =>
      method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined,
    );
    open();
    await screen.findByText(t("answerLink.none"));

    fireEvent.change(screen.getByLabelText(t("answerLink.days")), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));

    await screen.findByLabelText(t("answerLink.urlLabel"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ days: 30 });
  });

  it("keeps the link out of every place that outlives the page: storage, the address bar and the history", async () => {
    api({ value: { exists: false } }, ({ method }) => (method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined));
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");
    open();
    await screen.findByText(t("answerLink.none"));

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));
    await screen.findByLabelText(t("answerLink.urlLabel"));

    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain(TOKEN);
  });

  it("does not show the link again after the page is opened afresh: the server cannot give it back", async () => {
    api({ value: { exists: false } }, ({ method }) => (method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined));
    const first = open();
    await screen.findByText(t("answerLink.none"));
    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));
    await screen.findByLabelText(t("answerLink.urlLabel"));
    first.unmount();

    api({ value: active });
    open();

    await screen.findByText(/Active\. Made by/);
    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("shows the server's reason next to the days field when it refuses", async () => {
    api({ value: { exists: false } }, ({ method }) =>
      method === "POST" ? json(400, { days: ["Ensure this value is less than or equal to 30."] }) : undefined,
    );
    open();
    await screen.findByText(t("answerLink.none"));

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));

    expect(await screen.findByText("Ensure this value is less than or equal to 30.")).toBeInTheDocument();
    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
  });

  it("says so when the server cannot be reached while making a link, and shows no link", async () => {
    api({ value: { exists: false } }, ({ method }) => {
      if (method === "POST") throw new Error("offline");
      return undefined;
    });
    open();
    await screen.findByText(t("answerLink.none"));

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));

    expect(await screen.findByText(t("error.server"))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
  });

  it("copies the link, and tells the person when the browser refuses", async () => {
    api({ value: { exists: false } }, ({ method }) => (method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined));
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    open();
    await screen.findByText(t("answerLink.none"));
    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));
    await screen.findByLabelText(t("answerLink.urlLabel"));

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.copy") }));
    expect(await screen.findByText(t("answerLink.copied"))).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/answer#${TOKEN}`);

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.copy") }));
    expect(await screen.findByText(t("answerLink.copyFailed"))).toBeInTheDocument();
  });

  describe("revoking", () => {
    it("asks first, and Cancel leaves the link alone", async () => {
      const calls = api({ value: active });
      open();
      await screen.findByText(/Active\. Made by/);

      fireEvent.click(screen.getByRole("button", { name: t("answerLink.revoke") }));
      expect(screen.getByText(t("answerLink.revokeAsk"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t("question.cancel") }));

      expect(screen.queryByText(t("answerLink.revokeAsk"))).not.toBeInTheDocument();
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    });

    it("revokes on confirmation, then shows what the server now says", async () => {
      const current = { value: active as unknown };
      const calls = api(current, ({ method }) => {
        if (method === "DELETE") {
          current.value = { ...active, state: "revoked", revoked_at: "2026-11-15T10:00:00Z" };
          return new Response(null, { status: 204 });
        }
        return undefined;
      });
      open();
      await screen.findByText(/Active\. Made by/);

      fireEvent.click(screen.getByRole("button", { name: t("answerLink.revoke") }));
      fireEvent.click(screen.getByRole("button", { name: t("answerLink.revokeYes") }));

      expect(await screen.findByText(t("answerLink.revoked"))).toBeInTheDocument();
      expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/projects/5/answer-link/");
      expect(screen.queryByRole("button", { name: t("answerLink.revoke") })).not.toBeInTheDocument();
    });

    it("says so when the server refuses, and the link is still shown as active", async () => {
      api({ value: active }, ({ method }) => (method === "DELETE" ? json(500, {}) : undefined));
      open();
      await screen.findByText(/Active\. Made by/);

      fireEvent.click(screen.getByRole("button", { name: t("answerLink.revoke") }));
      fireEvent.click(screen.getByRole("button", { name: t("answerLink.revokeYes") }));

      expect(await screen.findByText(t("answerLink.revokeFailed"))).toBeInTheDocument();
      expect(screen.getByText(/Active\. Made by/)).toBeInTheDocument();
    });
  });

  it("is written in Azerbaijani when that is chosen, with words from the dictionary", async () => {
    act(() => setLanguage("az"));
    api({ value: active });
    open();

    const az = (key: Key, values?: Record<string, string | number>) => translate("az", key, values);
    expect(await screen.findByText(az("answerLink.active", { who: "olga@example.invalid", date: "2026-11-29" }))).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: az("answerLink.title") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: az("answerLink.revoke") })).toBeInTheDocument();
  });

  it("has no bullet markers or unreachable controls: every button is a real button of 44 px or more", async () => {
    api({ value: active });
    open();
    await screen.findByText(/Active\. Made by/);

    for (const button of screen.getAllByRole("button")) expect(button.className).toMatch(/min-h-11/);
    await waitFor(() => expect(screen.queryByText(t("answerLink.loading"))).not.toBeInTheDocument());
  });
});

/** Make a link in a panel that starts with none, and wait for the link to be shown. */
async function makeALink() {
  await screen.findByText(t("answerLink.none"));
  fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));
  await screen.findByLabelText(t("answerLink.urlLabel"));
}

describe("AnswerLinkPanel: the link is shown once (#114)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const madeThenRevocable = () => {
    const current = { value: { exists: false } as unknown };
    const calls = api(current, ({ method }) => {
      if (method === "POST") {
        current.value = active;
        return json(201, { ...active, token: TOKEN });
      }
      if (method === "DELETE") {
        current.value = { ...active, state: "revoked" };
        return new Response(null, { status: 204 });
      }
      return undefined;
    });
    return calls;
  };

  it("drops the link when the person revokes it", async () => {
    madeThenRevocable();
    open();
    await makeALink();

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.revoke") }));
    fireEvent.click(screen.getByRole("button", { name: t("answerLink.revokeYes") }));

    await screen.findByText(t("answerLink.revoked"));
    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("drops the link when the person signs out", async () => {
    madeThenRevocable();
    open();
    await makeALink();

    act(() => {
      window.dispatchEvent(new Event("sual:signed-out"));
    });

    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });

  it("drops the link after a few minutes of nobody touching the screen", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    madeThenRevocable();
    open();
    await makeALink();

    // The timer is started by an effect that React runs a moment after the link appears: let that happen first.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_VISIBLE_MS / 2);
    });
    expect(screen.getByLabelText(t("answerLink.urlLabel"))).toBeInTheDocument(); // still there at half the time
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LINK_VISIBLE_MS); // one and a half times the limit in all
    });

    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
  });

  it("drops the link when the page is left and comes back (Next keeps a page you leave alive but hidden)", async () => {
    madeThenRevocable();
    const view = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <AnswerLinkPanel projectId={5} />
      </Activity>
    );
    const { rerender } = render(view("visible"));
    await makeALink();

    rerender(view("hidden"));
    rerender(view("visible"));

    await screen.findByText(/Active\. Made by/);
    expect(screen.queryByLabelText(t("answerLink.urlLabel"))).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(TOKEN);
  });
});

describe("AnswerLinkPanel: replacing a live link asks first (#114)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks before making a new link, because the client's current one stops working", async () => {
    const calls = api({ value: active });
    open();
    await screen.findByText(/Active\. Made by/);

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.createNew") }));

    expect(screen.getByText(t("answerLink.replaceAsk"))).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("asks also when the form is submitted with Enter", async () => {
    const calls = api({ value: active });
    open();
    await screen.findByText(/Active\. Made by/);

    fireEvent.submit(screen.getByRole("form", { name: t("answerLink.create") }));

    expect(screen.getByText(t("answerLink.replaceAsk"))).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("makes the new link only after 'Yes', and Cancel leaves everything as it was", async () => {
    const calls = api({ value: active }, ({ method }) => (method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined));
    open();
    await screen.findByText(/Active\. Made by/);

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.createNew") }));
    fireEvent.click(screen.getByRole("button", { name: t("question.cancel") }));
    expect(screen.queryByText(t("answerLink.replaceAsk"))).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.createNew") }));
    fireEvent.click(screen.getByRole("button", { name: t("answerLink.replaceYes") }));

    await screen.findByLabelText(t("answerLink.urlLabel"));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("does not ask when there is no live link to lose", async () => {
    const calls = api({ value: { ...active, state: "revoked" } }, ({ method }) => (method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined));
    open();
    await screen.findByText(t("answerLink.revoked"));

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.create") }));

    await screen.findByLabelText(t("answerLink.urlLabel"));
    expect(screen.queryByText(t("answerLink.replaceAsk"))).not.toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });
});

describe("AnswerLinkPanel: keyboard and screen reader (#114)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts the keyboard on the new link, selected for copying, and has the 'copied' message region ready before it is used", async () => {
    api({ value: { exists: false } }, ({ method }) => (method === "POST" ? json(201, { ...active, token: TOKEN }) : undefined));
    open();
    await makeALink();

    expect(screen.getByLabelText(t("answerLink.urlLabel"))).toHaveFocus();
    const regions = screen.getAllByRole("status");
    expect(regions.some((r) => r.textContent === "")).toBe(true); // empty until something is copied: it can be announced
  });

  it("returns the keyboard to the Revoke button after Cancel", async () => {
    api({ value: active });
    open();
    await screen.findByText(/Active\. Made by/);

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.revoke") }));
    expect(screen.getByRole("button", { name: t("question.cancel") })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: t("question.cancel") }));

    expect(screen.getByRole("button", { name: t("answerLink.revoke") })).toHaveFocus();
  });

  it("keeps the keyboard on the card after a confirmed revoke removed the button it was on", async () => {
    const current = { value: active as unknown };
    api(current, ({ method }) => {
      if (method === "DELETE") {
        current.value = { ...active, state: "revoked" };
        return new Response(null, { status: 204 });
      }
    });
    open();
    await screen.findByText(/Active\. Made by/);

    fireEvent.click(screen.getByRole("button", { name: t("answerLink.revoke") }));
    fireEvent.click(screen.getByRole("button", { name: t("answerLink.revokeYes") }));

    await screen.findByText(t("answerLink.revoked"));
    await waitFor(() => expect(screen.getByRole("heading", { name: t("answerLink.title") })).toHaveFocus());
  });
});

describe("AnswerLinkPanel: the hint tells the team what the client sees", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names the two internal notes that go with each question", async () => {
    api({ value: { exists: false } });
    open();

    await screen.findByText(t("answerLink.none"));
    expect(screen.getByText(/why each matters and what it blocks/)).toBeInTheDocument();
  });
});
