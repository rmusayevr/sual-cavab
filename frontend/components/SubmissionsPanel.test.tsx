import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLanguage, translate, type Key } from "@/lib/i18n";
import { useSubmissions } from "@/lib/useSubmissions";

import SubmissionsPanel from "./SubmissionsPanel";
import WaitingAnswers from "./WaitingAnswers";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const submission = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  question_number: id,
  question_label: `Q${id}`,
  question_text: `Invented question ${id}?`,
  text: `Invented answer ${id}`,
  submitter_name: `Client ${id}`,
  source: "link",
  submitted_at: "2026-11-15T09:30:00Z",
  state: "pending",
  decided_by: null,
  decided_at: null,
  ...over,
});

type Call = { method: string; url: string; body?: unknown };
type Lists = { pending: unknown; dismissed: unknown };

/** Stub the API: GET ?state=pending|dismissed answer from `lists` (which a reply may change); writes can be answered by `reply`. */
function api(lists: Lists, reply: (call: Call, lists: Lists) => Response | undefined | void = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const call = { method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(call);
      if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
      const custom = reply(call, lists);
      if (custom) return custom;
      if (method === "GET") return json(200, url.includes("state=dismissed") ? lists.dismissed : lists.pending);
      return json(200, {});
    }),
  );
  return calls;
}

const t = (key: Key, values?: Record<string, string | number>) => translate("en", key, values);
/** The summary card and the answers inside their questions, over ONE shared state, as the workspace uses them (#121). */
function Harness({
  onAccepted,
  onSettled,
  onOpen,
}: {
  onAccepted: (n: number) => void;
  onSettled?: () => void;
  onOpen?: (n: number) => void;
}) {
  const submissions = useSubmissions(5, { enabled: true, onAccepted });
  const questions = [...new Set(submissions.pending.map((s) => s.question_number))].sort((a, b) => a - b);
  return (
    <>
      <SubmissionsPanel submissions={submissions} onOpen={onOpen ?? (() => {})} />
      {questions.map((n) => (
        <WaitingAnswers
          key={n}
          items={submissions.pending.filter((s) => s.question_number === n)}
          submissions={submissions}
          onSettled={onSettled}
        />
      ))}
    </>
  );
}

const open = (onAccepted = vi.fn(), more: { onSettled?: () => void; onOpen?: (n: number) => void } = {}) => {
  render(<Harness onAccepted={onAccepted} {...more} />);
  return onAccepted;
};

describe("SubmissionsPanel (#114)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => setLanguage("en"));
  });

  it("shows loading, then an empty state that says what will appear there", async () => {
    api({ pending: [], dismissed: [] });
    open();

    expect(screen.getByText(t("submissions.loading"))).toBeInTheDocument();
    expect(await screen.findByText(t("submissions.none"))).toBeInTheDocument();
    expect(screen.queryByText(/waiting$/)).not.toBeInTheDocument();
  });

  it("shows what the client wrote, who (marked unverified) and when, inside the question it is for", async () => {
    api({ pending: [submission(1), submission(2, { submitter_name: "Murad" })], dismissed: [] });
    open();

    const first = (await screen.findByText("Invented answer 1")).closest("li")!;
    expect(within(first).getByText("From Client 1 (name typed by the client, not verified) · 2026-11-15")).toBeInTheDocument();
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
    expect(screen.getByText(/From Murad/)).toBeInTheDocument();
    // each question's answers are in a section of their own, and the card does not list them again
    expect(screen.getAllByRole("region", { name: t("submissions.waitingHere") })).toHaveLength(2);
    expect(screen.getAllByText("Invented answer 1")).toHaveLength(1);
  });

  it("says an answer came from a client account (the name is the account's), not from a link", async () => {
    api({ pending: [submission(1, { source: "account", submitter_name: "Ada Client" }), submission(2)], dismissed: [] });
    open();

    const first = (await screen.findByText("Invented answer 1")).closest("li")!;
    expect(within(first).getByText("From Ada Client (client account) · 2026-11-15")).toBeInTheDocument();
    expect(within(first).queryByText(/not verified/)).not.toBeInTheDocument();
    const second = screen.getByText("Invented answer 2").closest("li")!;
    expect(within(second).getByText(/not verified/)).toBeInTheDocument();
  });

  it("marks a dismissed answer from a client account as one too", async () => {
    api({ pending: [], dismissed: [{ ...submission(3, { source: "account", submitter_name: "Ada Client" }), state: "dismissed" }] });
    open();

    fireEvent.click(await screen.findByRole("button", { name: t("submissions.showDismissed") }));

    expect(await screen.findByText("From Ada Client (client account) · 2026-11-15")).toBeInTheDocument();
  });

  it("shows what the client typed as plain text, never as markup", async () => {
    const script = "<script>window.__pwned = 1</script><b>bold</b>";
    api({ pending: [submission(1, { text: script, submitter_name: "<i>Leyla</i>" })], dismissed: [] });
    const { container } = render(<Harness onAccepted={vi.fn()} />);

    expect(await screen.findByText(script)).toBeInTheDocument();
    expect(container.querySelector("script, b, i")).toBeNull();
    expect(screen.getByText(/<i>Leyla<\/i>/)).toBeInTheDocument();
  });

  it("says so when the answers cannot be loaded, and treats a reply that is not a list as a failure", async () => {
    api({ pending: { detail: "nonsense" }, dismissed: [] });
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("submissions.loadError"));
  });

  describe("accepting", () => {
    it("opens the client's text for editing, saves the edited text, and tells the page which question was answered", async () => {
      const lists: Lists = { pending: [submission(3)], dismissed: [] };
      const calls = api(lists, (call, l) => {
        if (call.method === "POST") {
          l.pending = [];
          return json(200, submission(3, { state: "accepted" }));
        }
      });
      const onAccepted = open();

      fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));
      const box = screen.getByLabelText(t("submissions.acceptLabel", { label: "Q3" })) as HTMLTextAreaElement;
      expect(box.value).toBe("Invented answer 3");
      fireEvent.change(box, { target: { value: "Invented answer 3, edited." } });
      fireEvent.click(screen.getByRole("button", { name: t("submissions.acceptSave") }));

      expect(await screen.findByText(t("submissions.none"))).toBeInTheDocument();
      expect(calls.find((c) => c.method === "POST")).toMatchObject({
        url: "/api/projects/5/submissions/3/accept/",
        body: { text: "Invented answer 3, edited." },
      });
      expect(onAccepted).toHaveBeenCalledWith(3);
    });

    it("shows the server's reason and keeps the text when it refuses (for example the question is already answered)", async () => {
      api({ pending: [submission(3)], dismissed: [] }, (call) =>
        call.method === "POST" ? json(400, { detail: ["Q3 is answered: re-open it before accepting an answer."] }) : undefined,
      );
      const onAccepted = open();

      fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));
      fireEvent.change(screen.getByLabelText(t("submissions.acceptLabel", { label: "Q3" })), { target: { value: "My edit" } });
      fireEvent.click(screen.getByRole("button", { name: t("submissions.acceptSave") }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Q3 is answered: re-open it before accepting an answer.");
      expect(screen.getByLabelText(t("submissions.acceptLabel", { label: "Q3" }))).toHaveValue("My edit");
      expect(onAccepted).not.toHaveBeenCalled();
    });

    it("Cancel closes the editor and sends nothing", async () => {
      const calls = api({ pending: [submission(3)], dismissed: [] });
      open();

      fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));
      fireEvent.click(screen.getByRole("button", { name: t("question.cancel") }));

      expect(screen.queryByLabelText(t("submissions.acceptLabel", { label: "Q3" }))).not.toBeInTheDocument();
      expect(calls.some((c) => c.method === "POST")).toBe(false);
    });

    it("says so when the server cannot be reached", async () => {
      api({ pending: [submission(3)], dismissed: [] }, (call) => {
        if (call.method === "POST") throw new Error("offline");
      });
      const onAccepted = open();

      fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));
      fireEvent.click(screen.getByRole("button", { name: t("submissions.acceptSave") }));

      expect(await screen.findByText(t("error.server"))).toBeInTheDocument();
      expect(onAccepted).not.toHaveBeenCalled();
    });
  });

  describe("dismissing", () => {
    it("dismisses one answer and reads the list again", async () => {
      const lists: Lists = { pending: [submission(1), submission(2)], dismissed: [] };
      const calls = api(lists, (call, l) => {
        if (call.method === "POST") {
          l.pending = [submission(2)];
          return json(200, {});
        }
      });
      open();

      fireEvent.click(await screen.findByRole("button", { name: "Dismiss Q1 · Client 1" }));

      expect(await screen.findByText("1 waiting")).toBeInTheDocument();
      expect(screen.queryByText("Invented answer 1")).not.toBeInTheDocument();
      expect(calls.find((c) => c.method === "POST")?.url).toBe("/api/projects/5/submissions/1/dismiss/");
    });

    it("offers 'dismiss all' only when more than one is waiting, asks first, and says how many", async () => {
      const lists: Lists = { pending: [submission(1), submission(2)], dismissed: [] };
      const calls = api(lists, (call, l) => {
        if (call.method === "POST") {
          l.pending = [];
          return json(200, { dismissed: 2 });
        }
      });
      open();

      fireEvent.click(await screen.findByRole("button", { name: t("submissions.dismissAll") }));
      expect(screen.getByText(t("submissions.dismissAllAsk", { n: 2 }))).toBeInTheDocument();
      expect(calls.some((c) => c.method === "POST")).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: t("submissions.dismissAllYes") }));

      expect(await screen.findByText(t("submissions.none"))).toBeInTheDocument();
      expect(calls.find((c) => c.method === "POST")?.url).toBe("/api/projects/5/submissions/dismiss-pending/");
    });

    it("does not offer 'dismiss all' for a single answer", async () => {
      api({ pending: [submission(1)], dismissed: [] });
      open();
      await screen.findByText("Invented answer 1");

      expect(screen.queryByRole("button", { name: t("submissions.dismissAll") })).not.toBeInTheDocument();
    });

    it("shows the server's reason when a dismissal fails", async () => {
      api({ pending: [submission(1)], dismissed: [] }, (call) =>
        call.method === "POST" ? json(400, { detail: ["This answer has already been decided."] }) : undefined,
      );
      open();

      fireEvent.click(await screen.findByRole("button", { name: "Dismiss Q1 · Client 1" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("This answer has already been decided.");
    });
  });

  describe("dismissed answers", () => {
    it("are hidden until asked for, then listed, and can be restored", async () => {
      const lists: Lists = { pending: [], dismissed: [submission(4, { state: "dismissed" })] };
      const calls = api(lists, (call, l) => {
        if (call.method === "POST") {
          l.dismissed = [];
          l.pending = [submission(4)];
          return json(200, submission(4));
        }
      });
      open();
      await screen.findByText(t("submissions.none"));
      expect(screen.queryByText("Invented answer 4")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));
      expect(await screen.findByText("Invented answer 4")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Restore Q4 · Client 4" }));

      expect(await screen.findByRole("button", { name: "Accept Q4 · Client 4" })).toBeInTheDocument();
      expect(calls.find((c) => c.method === "POST")?.url).toBe("/api/projects/5/submissions/4/restore/");
      expect(screen.getByText(t("submissions.dismissedNone"))).toBeInTheDocument();
    });

    it("say so when there are none", async () => {
      api({ pending: [], dismissed: [] });
      open();
      await screen.findByText(t("submissions.none"));

      fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));

      expect(await screen.findByText(t("submissions.dismissedNone"))).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: t("submissions.hideDismissed") }));
      expect(screen.queryByText(t("submissions.dismissedNone"))).not.toBeInTheDocument();
    });
  });

  it("reads the list again on Refresh, so answers that arrived meanwhile appear", async () => {
    const lists: Lists = { pending: [], dismissed: [] };
    api(lists);
    open();
    await screen.findByText(t("submissions.none"));

    lists.pending = [submission(7)];
    fireEvent.click(screen.getByRole("button", { name: t("submissions.refresh") }));

    expect(await screen.findByText("Invented answer 7")).toBeInTheDocument();
  });

  it("is written in Azerbaijani when that is chosen, with words from the dictionary", async () => {
    act(() => setLanguage("az"));
    api({ pending: [submission(1)], dismissed: [] });
    open();

    const az = (key: Key, values?: Record<string, string | number>) => translate("az", key, values);
    expect(await screen.findByRole("heading", { name: az("submissions.title") })).toBeInTheDocument();
    expect(screen.getByText(az("submissions.from", { who: "Client 1", when: "2026-11-15" }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${az("submissions.accept")} Q1 · Client 1` })).toBeInTheDocument();
    // what the client typed is never translated
    expect(screen.getByText("Invented answer 1")).toBeInTheDocument();
  });

  it("has no bullet markers on its lists", async () => {
    api({ pending: [submission(1)], dismissed: [] });
    open();
    await screen.findByText("Invented answer 1");

    for (const list of screen.getAllByRole("list")) expect(list).toHaveClass("list-none");
  });
});

describe("SubmissionsPanel: out-of-date lists and double clicks (#114)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the list again when a decision is refused, so the item someone else already decided disappears", async () => {
    const lists: Lists = { pending: [submission(3), submission(4)], dismissed: [] };
    api(lists, (call, l) => {
      if (call.method === "POST") {
        l.pending = [submission(4)];
        return json(400, { detail: ["This answer has already been decided."] });
      }
    });
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));
    fireEvent.click(screen.getByRole("button", { name: t("submissions.acceptSave") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This answer has already been decided.");
    await waitFor(() => expect(screen.queryByText("Invented answer 3")).not.toBeInTheDocument());
    expect(screen.getByText("Invented answer 4")).toBeInTheDocument();
  });

  it("lets only the newest read decide what is shown (a slow Refresh must not bring back a dismissed answer)", async () => {
    let releaseSlow: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => (releaseSlow = resolve));
    let reads = 0;
    let dismissedOne = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (init?.method === "POST") {
          dismissedOne = true;
          return json(200, {});
        }
        reads += 1;
        if (reads === 2) return slow; // the Refresh: slow, and it will be answered with the OLD list
        return json(200, dismissedOne ? [submission(2)] : [submission(1), submission(2)]);
      }),
    );
    open();
    await screen.findByText("Invented answer 1");

    fireEvent.click(screen.getByRole("button", { name: t("submissions.refresh") })); // read 2: slow
    await waitFor(() => expect(reads).toBe(2));
    // Refresh disables nothing, so a person can dismiss while it is still on its way:
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Q1 · Client 1" }));
    await waitFor(() => expect(screen.queryByText("Invented answer 1")).not.toBeInTheDocument());
    await act(async () => {
      releaseSlow(json(200, [submission(1), submission(2)])); // the old list arrives late
    });

    expect(screen.queryByText("Invented answer 1")).not.toBeInTheDocument();
  });

  it("does not bring the 'dismiss all' question back by itself after the list shrank and grew again", async () => {
    const lists: Lists = { pending: [submission(1), submission(2)], dismissed: [] };
    api(lists);
    open();
    fireEvent.click(await screen.findByRole("button", { name: t("submissions.dismissAll") }));
    expect(screen.getByText(t("submissions.dismissAllAsk"))).toBeInTheDocument();

    lists.pending = [submission(1)];
    fireEvent.click(screen.getByRole("button", { name: t("submissions.refresh") }));
    await waitFor(() => expect(screen.queryByText(t("submissions.dismissAllAsk"))).not.toBeInTheDocument());
    lists.pending = [submission(1), submission(2)];
    fireEvent.click(screen.getByRole("button", { name: t("submissions.refresh") }));

    expect(await screen.findByRole("button", { name: t("submissions.dismissAll") })).toBeInTheDocument();
    expect(screen.queryByText(t("submissions.dismissAllAsk"))).not.toBeInTheDocument();
  });

  it("asks about 'dismiss all' without a count, because the server dismisses everything waiting by then", async () => {
    api({ pending: [submission(1), submission(2)], dismissed: [] });
    open();

    fireEvent.click(await screen.findByRole("button", { name: t("submissions.dismissAll") }));

    expect(screen.getByText(t("submissions.dismissAllAsk")).textContent).not.toMatch(/\d/);
  });

  it("shows a loading state, not the list from last time, when the dismissed answers are opened again", async () => {
    let dismissedReads = 0;
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("state=dismissed")) {
          dismissedReads += 1;
          if (dismissedReads === 2) return new Promise<Response>((resolve) => (release = resolve));
          return json(200, [submission(4, { state: "dismissed" })]);
        }
        return json(200, []);
      }),
    );
    open();
    await screen.findByText(t("submissions.none"));
    fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));
    await screen.findByText("Invented answer 4");
    fireEvent.click(screen.getByRole("button", { name: t("submissions.hideDismissed") }));

    fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));

    expect(screen.queryByText("Invented answer 4")).not.toBeInTheDocument();
    expect(screen.getByText(t("submissions.loading"))).toBeInTheDocument();
    await act(async () => {
      release(json(200, []));
    });
    expect(await screen.findByText(t("submissions.dismissedNone"))).toBeInTheDocument();
  });

  it("sends one accept even if the form is submitted twice before the first answer comes back", async () => {
    let release: (r: Response) => void = () => {};
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/auth/csrf/") return new Response(null, { status: 204 });
        if (init?.method === "POST") {
          calls.push(url);
          return new Promise<Response>((resolve) => (release = resolve));
        }
        return json(200, [submission(3)]);
      }),
    );
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));

    const form = screen.getByRole("form", { name: "Q3 · Client 3" });
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(calls).toEqual(["/api/projects/5/submissions/3/accept/"]));
    await act(async () => {
      release(json(200, {}));
    });
    expect(calls).toHaveLength(1); // the second submit never became a request
  });
});

describe("SubmissionsPanel: keyboard (#114)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts the keyboard in the answer being edited, and back on Accept after Cancel", async () => {
    api({ pending: [submission(3)], dismissed: [] });
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Accept Q3 · Client 3" }));
    expect(screen.getByLabelText(t("submissions.acceptLabel", { label: "Q3" }))).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: t("question.cancel") }));

    expect(screen.getByRole("button", { name: "Accept Q3 · Client 3" })).toHaveFocus();
  });

  it("tells the page when a decision went through, because the button that was pressed is gone", async () => {
    const lists: Lists = { pending: [submission(1)], dismissed: [] };
    api(lists, (call, l) => {
      if (call.method === "POST") {
        l.pending = [];
        return json(200, {});
      }
    });
    const onSettled = vi.fn();
    open(vi.fn(), { onSettled });

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss Q1 · Client 1" }));

    await screen.findByText(t("submissions.none"));
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  });

  it("does not tell the page when a decision was refused", async () => {
    api({ pending: [submission(1)], dismissed: [] }, (call) =>
      call.method === "POST" ? json(400, { detail: ["This answer has already been decided."] }) : undefined,
    );
    const onSettled = vi.fn();
    open(vi.fn(), { onSettled });

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss Q1 · Client 1" }));

    await screen.findByText("This answer has already been decided.");
    expect(onSettled).not.toHaveBeenCalled();
  });
});

describe("SubmissionsPanel: a typed name cannot reorder the words around it (#114)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes direction controls from the name in the text and in the button names", async () => {
    api({ pending: [submission(1, { submitter_name: "Mal\u202Elory" })], dismissed: [{ ...submission(2, { submitter_name: "Eve\u2067" }), state: "dismissed" }] });
    const { container } = render(<Harness onAccepted={vi.fn()} />);

    expect(await screen.findByRole("button", { name: "Accept Q1 · Mallory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss Q1 · Mallory" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));
    expect(await screen.findByRole("button", { name: "Restore Q2 · Eve" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
    expect(screen.getByText(/From Mallory/)).toBeInTheDocument();
  });
});

describe("SubmissionsPanel: the summary card (#121)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("says which questions have answers waiting, and opens the one that is pressed", async () => {
    api({ pending: [submission(4), submission(2), submission(4, { id: 40, text: "A second one" })], dismissed: [] });
    const onOpen = vi.fn();
    open(vi.fn(), { onOpen });

    const q4 = await screen.findByRole("button", { name: t("submissions.openQuestion", { label: "Q4", n: 2 }) });
    expect(screen.getByRole("button", { name: t("submissions.openQuestion", { label: "Q2", n: 1 }) })).toBeInTheDocument();
    const names = screen.getAllByRole("button", { name: /^Open Q\d/ }).map((b) => b.textContent);
    expect(names).toEqual(["Open Q2 (1 waiting)", "Open Q4 (2 waiting)"]); // in question order
    fireEvent.click(q4);

    expect(onOpen).toHaveBeenCalledWith(4);
  });

  it("offers nothing to open when nothing is waiting", async () => {
    api({ pending: [], dismissed: [] });
    open();

    await screen.findByText(t("submissions.none"));
    expect(screen.queryByText(t("submissions.openHint"))).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Open Q/ })).not.toBeInTheDocument();
  });

  it("shows a refusal where it belongs: an accept inside its question, a 'dismiss all' in the card", async () => {
    api({ pending: [submission(1), submission(2)], dismissed: [] }, (call) => {
      if (call.method !== "POST") return undefined;
      return call.url.includes("dismiss-pending") ? json(400, { detail: ["Nothing to dismiss."] }) : json(400, { detail: ["Q1 is answered."] });
    });
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss Q1 · Client 1" }));
    const section = (await screen.findByText("Q1 is answered.")).closest("section")!;
    expect(within(section).getByText("Invented answer 1")).toBeInTheDocument(); // inside Q1's own area
    expect(screen.getAllByText("Q1 is answered.")).toHaveLength(1);

    fireEvent.click(await screen.findByRole("button", { name: t("submissions.dismissAll") }));
    fireEvent.click(screen.getByRole("button", { name: t("submissions.dismissAllYes") }));
    const card = (await screen.findByText("Nothing to dismiss.")).closest(".shadow-card, [aria-labelledby]")!;
    expect(within(card as HTMLElement).getByRole("heading", { name: t("submissions.title") })).toBeInTheDocument();
  });

  it("waits for the project to be there before asking for anything", () => {
    const calls = api({ pending: [], dismissed: [] });
    function Waiting() {
      useSubmissions(5, { enabled: false, onAccepted: vi.fn() });
      return null;
    }

    render(<Waiting />);

    expect(calls).toHaveLength(0);
  });
});

describe("SubmissionsPanel: where a refusal and the keyboard go (#121)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows a refused Restore in the card even though the answer is waiting again by then", async () => {
    const lists: Lists = { pending: [], dismissed: [submission(4, { state: "dismissed" })] };
    api(lists, (call, l) => {
      if (call.method !== "POST") return undefined;
      l.pending = [submission(4)]; // another member restored it first
      l.dismissed = [];
      return json(400, { detail: ["Only a dismissed answer can be restored."] });
    });
    open();
    await screen.findByText(t("submissions.none"));
    fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));

    fireEvent.click(await screen.findByRole("button", { name: "Restore Q4 · Client 4" }));

    const message = await screen.findByText("Only a dismissed answer can be restored.");
    expect(screen.getAllByText("Only a dismissed answer can be restored.")).toHaveLength(1); // not repeated inside Q4
    expect(within(message.closest("[aria-labelledby]") as HTMLElement).getByRole("heading", { name: t("submissions.title") })).toBeInTheDocument();
  });

  it("keeps the keyboard on the card after 'Dismiss all' and after Restore removed the button that was pressed", async () => {
    const lists: Lists = { pending: [submission(1), submission(2)], dismissed: [] };
    api(lists, (call, l) => {
      if (call.method !== "POST") return undefined;
      if (call.url.includes("dismiss-pending")) {
        l.dismissed = (l.pending as object[]).map((p) => ({ ...p, state: "dismissed" }));
        l.pending = [];
      } else {
        l.pending = [submission(1)];
        l.dismissed = [];
      }
      return json(200, {});
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: t("submissions.dismissAll") }));
    fireEvent.click(screen.getByRole("button", { name: t("submissions.dismissAllYes") }));
    await screen.findByText(t("submissions.none"));
    await waitFor(() => expect(screen.getByRole("heading", { name: t("submissions.title") })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: t("submissions.showDismissed") }));
    (screen.getByRole("heading", { name: t("submissions.title") }) as HTMLElement).blur();
    fireEvent.click(await screen.findByRole("button", { name: "Restore Q1 · Client 1" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: t("submissions.title") })).toHaveFocus());
  });

  it("does not add a heading level inside a question: the waiting answers have a labelled area, not an h3", async () => {
    api({ pending: [submission(1)], dismissed: [] });
    open();

    await screen.findByText("Invented answer 1");

    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("submissions.waitingHere") })).toBeInTheDocument();
  });
});
