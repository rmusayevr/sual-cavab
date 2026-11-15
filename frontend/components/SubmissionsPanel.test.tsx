import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLanguage, translate, type Key } from "@/lib/i18n";

import SubmissionsPanel from "./SubmissionsPanel";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const submission = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  question_number: id,
  question_label: `Q${id}`,
  question_text: `Invented question ${id}?`,
  text: `Invented answer ${id}`,
  submitter_name: `Client ${id}`,
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
const open = (onAccepted = vi.fn()) => {
  render(<SubmissionsPanel projectId={5} onAccepted={onAccepted} />);
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

  it("lists what is waiting with the question, what the client wrote, who (marked unverified) and when", async () => {
    api({ pending: [submission(1), submission(2, { submitter_name: "Murad" })], dismissed: [] });
    open();

    const first = (await screen.findByText("Invented answer 1")).closest("li")!;
    expect(within(first).getByText("Q1")).toBeInTheDocument();
    expect(within(first).getByText(/Invented question 1\?/)).toBeInTheDocument();
    expect(within(first).getByText("From Client 1 (name typed by the client, not verified) · 2026-11-15")).toBeInTheDocument();
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
    expect(screen.getByText(/From Murad/)).toBeInTheDocument();
  });

  it("shows what the client typed as plain text, never as markup", async () => {
    const script = "<script>window.__pwned = 1</script><b>bold</b>";
    api({ pending: [submission(1, { text: script, submitter_name: "<i>Leyla</i>" })], dismissed: [] });
    const { container } = render(<SubmissionsPanel projectId={5} onAccepted={vi.fn()} />);

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
