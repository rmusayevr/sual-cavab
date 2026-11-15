import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLanguage, translate, type Key } from "@/lib/i18n";

import ClientAnswers from "./ClientAnswers";

const TOKEN = "k".repeat(43);
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

const question = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  label: `Q${n}`,
  text: `Invented question ${n}?`,
  why_it_matters: "",
  blocks: "",
  ...over,
});
const view = (questions: unknown[] = [question(1), question(2)]) => ({
  project_name: "Ticketing",
  expires_at: "2026-11-29T09:00:00Z",
  questions,
});

type Call = { url: string; init: RequestInit };

/** Stub the network: `reply` answers each call (GET list by default); every call is recorded. */
function api(reply: (call: Call) => Response | Promise<Response> | undefined | void = () => undefined, list: unknown = view()) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      return reply(call) ?? json(200, list);
    }),
  );
  return calls;
}

const t = (key: Key, values?: Record<string, string | number>) => translate("en", key, values);
const open = () => render(<ClientAnswers />);
const setHash = (hash: string) => window.history.replaceState(null, "", `/answer${hash}`);
const nameBox = () => screen.getByLabelText(t("client.name")) as HTMLInputElement;
const answerBox = (label: string) => screen.getByLabelText(t("client.answerLabel", { label })) as HTMLTextAreaElement;
const sendFor = (label: string) => within(answerBox(label).closest("form")!).getByRole("button", { name: t("client.send") });

beforeEach(() => setHash(`#${TOKEN}`));
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => setLanguage("en"));
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
});

describe("ClientAnswers: opening the link (#114)", () => {
  it("shows loading, then the project, what the team wants, and when the link ends", async () => {
    api();
    open();

    expect(screen.getByText(t("client.loading"))).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
    expect(screen.getByText(t("client.lead"))).toBeInTheDocument();
    expect(screen.getByText(t("client.expires", { date: "2026-11-29" }))).toBeInTheDocument();
    expect(screen.getByText(t("client.privacy"))).toBeInTheDocument();
    expect(screen.getByText("Invented question 1?")).toBeInTheDocument();
    expect(screen.getByText("Q2")).toHaveClass("font-mono");
  });

  it("shows why a question matters and what it blocks only when the team wrote them", async () => {
    api(() => undefined, view([question(1, { why_it_matters: "Needed for launch", blocks: "Checkout" }), question(2)]));
    open();

    await screen.findByText("Invented question 1?");
    expect(screen.getByText("Needed for launch")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getAllByText(`${t("client.why")}:`)).toHaveLength(1);
    expect(screen.getAllByText(`${t("client.blocks")}:`)).toHaveLength(1);
  });

  it("shows everything the team wrote as plain text, never as markup", async () => {
    const script = "<script>window.__pwned = 1</script><b>bold</b>";
    api(() => undefined, view([question(1, { text: script, why_it_matters: "<img src=x onerror=alert(1)>", blocks: "<i>x</i>" })]));
    const { container } = open();

    expect(await screen.findByText(script)).toBeInTheDocument();
    expect(container.querySelector("script, b, i, img")).toBeNull();
  });

  it("says there is nothing to answer when no question is open", async () => {
    api(() => undefined, view([]));
    open();

    expect(await screen.findByText(t("client.empty"))).toBeInTheDocument();
  });

  it("asks the server for the list once, with the token from the address", async () => {
    const calls = api();
    open();
    await screen.findByText("Invented question 1?");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/answer-link/questions/");
    expect((calls[0].init.headers as Record<string, string>)["X-Answer-Token"]).toBe(TOKEN);
  });
});

describe("ClientAnswers: a link that does not work (#114)", () => {
  it("says the link is not available, without asking the server, when the address has no token", async () => {
    setHash("");
    const calls = api();
    open();

    expect(await screen.findByRole("heading", { name: t("client.unavailableTitle") })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("does the same for something that cannot be a token", async () => {
    setHash("#not-a-token");
    const calls = api();
    open();

    expect(await screen.findByRole("heading", { name: t("client.unavailableTitle") })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("says the same thing for a link the server refuses, however it is dead", async () => {
    api(() => json(404, { detail: "This link is not available." }));
    open();

    expect(await screen.findByRole("heading", { name: t("client.unavailableTitle") })).toBeInTheDocument();
    expect(screen.getByText(t("client.unavailableText"))).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Ticketing" })).not.toBeInTheDocument();
  });

  it("does not call a throttled link dead or working: it says to wait, and offers to try again", async () => {
    let throttled = true;
    api(() => (throttled ? json(429, {}) : undefined));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("client.throttled"));
    expect(screen.queryByText(t("client.unavailableTitle"))).not.toBeInTheDocument();
    throttled = false;
    fireEvent.click(screen.getByRole("button", { name: t("client.retry") }));

    expect(await screen.findByRole("heading", { level: 1, name: "Ticketing" })).toBeInTheDocument();
  });

  it("says the questions could not be loaded, with a way to try again, when the server fails", async () => {
    let fail = true;
    api(() => (fail ? json(500, {}) : undefined));
    open();

    expect(await screen.findByRole("alert")).toHaveTextContent(t("client.loadError"));
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("client.retry") }));

    expect(await screen.findByText("Invented question 1?")).toBeInTheDocument();
  });
});

describe("ClientAnswers: a client has no account (#114)", () => {
  it("shows no way into the rest of the app: no links, no sign-in, no session", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/sign in|signed in|sign out|projects/i)).not.toBeInTheDocument();
    expect(document.querySelector("a[href]")).toBeNull();
  });

  it("shows the same on a page that has no working link", async () => {
    setHash("");
    api();
    open();
    await screen.findByRole("heading", { name: t("client.unavailableTitle") });

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("has one carpet strip, as every screen does", async () => {
    api();
    const { container } = open();
    await screen.findByText("Invented question 1?");

    expect(container.querySelectorAll(".pattern-carpet")).toHaveLength(1);
  });

  it("sends every request without cookies, without a Referer, and only to the two link routes", async () => {
    const calls = api(({ init }) => (init.method === "POST" ? json(201) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));
    await screen.findByText(t("client.sent"));

    expect(calls.map((c) => c.url)).toEqual(["/api/answer-link/questions/", "/api/answer-link/questions/1/answers/"]);
    for (const call of calls) {
      expect(call.init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store" });  // literal-password-ok: a fetch option, not a secret
      expect((call.init.headers as Record<string, string>)["X-Answer-Token"]).toBe(TOKEN);
      expect(call.url).not.toContain(TOKEN);
    }
  });

  it("keeps the token and the name out of storage, cookies and the history", async () => {
    api(({ init }) => (init.method === "POST" ? json(201) : undefined));
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla Quinn" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));
    await screen.findByText(t("client.sent"));

    for (const place of [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie]) {
      expect(place).not.toContain(TOKEN);
      expect(place).not.toContain("Leyla Quinn");
      expect(place).not.toContain("Use Stripe.");
    }
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("ClientAnswers: sending an answer (#114)", () => {
  it("needs a name and an answer, and says which is missing without sending anything", async () => {
    const calls = api();
    open();
    await screen.findByText("Invented question 1?");

    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));
    expect(await screen.findByText(t("client.nameRequired"))).toBeInTheDocument();

    fireEvent.change(nameBox(), { target: { value: "   " } });
    fireEvent.click(sendFor("Q1"));
    expect(screen.getByText(t("client.nameRequired"))).toBeInTheDocument();

    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "  " } });
    fireEvent.click(sendFor("Q1"));
    expect(await screen.findByText(t("client.textRequired"))).toBeInTheDocument();
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(0);
  });

  it("sends the name and the answer to that question, says thank you, and empties the box", async () => {
    const calls = api(({ init }) => (init.method === "POST" ? json(201) : undefined));
    open();
    await screen.findByText("Invented question 1?");

    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q2"), { target: { value: "Ali approves." } });
    fireEvent.click(sendFor("Q2"));

    expect(await screen.findByText(t("client.sent"))).toBeInTheDocument();
    const post = calls.find((c) => c.init.method === "POST")!;
    expect(post.url).toBe("/api/answer-link/questions/2/answers/");
    expect(JSON.parse(String(post.init.body))).toEqual({ text: "Ali approves.", name: "Leyla" });
    expect(answerBox("Q2").value).toBe("");
    expect(answerBox("Q1").value).toBe(""); // the other question is untouched
    expect(nameBox().value).toBe("Leyla"); // the name stays for the next answer
  });

  it("lets the client send a second answer to the same question, and the name stays", async () => {
    const calls = api(({ init }) => (init.method === "POST" ? json(201) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });

    for (const text of ["First.", "Second."]) {
      fireEvent.change(answerBox("Q1"), { target: { value: text } });
      fireEvent.click(sendFor("Q1"));
      await waitFor(() => expect(answerBox("Q1").value).toBe(""));
    }

    expect(calls.filter((c) => c.init.method === "POST").map((c) => JSON.parse(String(c.init.body)).text)).toEqual(["First.", "Second."]);
  });

  it("sends once if the form is submitted twice before the first reply", async () => {
    let release: (r: Response) => void = () => {};
    const calls = api(({ init }) => (init.method === "POST" ? new Promise<Response>((resolve) => (release = resolve)) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    const form = answerBox("Q1").closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1));
    await act(async () => release(json(201)));
    expect(calls.filter((c) => c.init.method === "POST")).toHaveLength(1);
  });

  it("shows the server's reason next to the answer and keeps what was typed", async () => {
    api(({ init }) => (init.method === "POST" ? json(400, { text: ["Ensure this field has no more than 4000 characters."] }) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "A long one" } });

    fireEvent.click(sendFor("Q1"));

    expect(await screen.findByText("Ensure this field has no more than 4000 characters.")).toBeInTheDocument();
    expect(answerBox("Q1").value).toBe("A long one");
    expect(screen.queryByText(t("client.sent"))).not.toBeInTheDocument();
  });

  it("says plainly when too many answers are waiting, and keeps what was typed", async () => {
    api(({ init }) => (init.method === "POST" ? json(429, {}) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });

    fireEvent.click(sendFor("Q1"));

    expect(await screen.findByText(t("client.tooMany"))).toBeInTheDocument();
    expect(answerBox("Q1").value).toBe("Use Stripe.");
  });

  it("says so when the answer could not be sent at all, and keeps what was typed", async () => {
    api(({ init }) => {
      if (init.method === "POST") throw new Error("offline");
    });
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });

    fireEvent.click(sendFor("Q1"));

    expect(await screen.findByText(t("client.failed"))).toBeInTheDocument();
    expect(answerBox("Q1").value).toBe("Use Stripe.");
  });

  it("when a question can no longer take answers, says so and offers to check again", async () => {
    let answered = false;
    api(({ init }) => {
      if (init.method === "POST") {
        answered = true;
        return json(404, { detail: "This link is not available." });
      }
      return answered ? json(200, view([question(2)])) : undefined;
    });
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });

    fireEvent.click(sendFor("Q1"));
    expect(await screen.findByText(t("client.closed"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("client.checkAgain") }));

    await waitFor(() => expect(screen.queryByText("Invented question 1?")).not.toBeInTheDocument());
    expect(screen.getByText("Invented question 2?")).toBeInTheDocument();
  });

  it("does not let a direction-control character in the name reorder the form's name", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");

    fireEvent.change(nameBox(), { target: { value: "Mal‮lory" } });

    expect(answerBox("Q1").closest("form")!.getAttribute("aria-label")).toBe("Q1 · Mallory");
  });
});

describe("ClientAnswers: both languages (#114)", () => {
  it("is written in Azerbaijani when that is chosen, with words from the dictionary; the team's words are not translated", async () => {
    act(() => setLanguage("az"));
    api(() => undefined, view([question(1, { why_it_matters: "Needed for launch" })]));
    open();

    const az = (key: Key, values?: Record<string, string | number>) => translate("az", key, values);
    expect(await screen.findByText(az("client.lead"))).toBeInTheDocument();
    expect(screen.getByText(az("client.expires", { date: "2026-11-29" }))).toBeInTheDocument();
    expect(screen.getByLabelText(az("client.name"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: az("client.send") })).toBeInTheDocument();
    expect(screen.getByText(`${az("client.why")}:`)).toBeInTheDocument();
    expect(screen.getByText("Needed for launch")).toBeInTheDocument();
    expect(screen.getByText("Invented question 1?")).toBeInTheDocument();
  });

  it("switches language in place and keeps what was typed", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(answerBox("Q1"), { target: { value: "Half written" } });

    fireEvent.click(screen.getByRole("button", { name: "AZ" }));

    expect(await screen.findByText(translate("az", "client.lead"))).toBeInTheDocument();
    expect((screen.getByLabelText(translate("az", "client.answerLabel", { label: "Q1" })) as HTMLTextAreaElement).value).toBe("Half written");
  });

  it("has no bullet markers on its list", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");

    for (const list of screen.getAllByRole("list")) expect(list).toHaveClass("list-none");
  });
});
