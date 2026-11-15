import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStamp } from "@/lib/clientLink";
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
    expect(screen.getByText(t("client.expires", { when: localStamp("2026-11-29T09:00:00Z") }))).toBeInTheDocument();
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

  it("keeps the token and the name out of storage and cookies, and never touches the History API", async () => {
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
});

describe("ClientAnswers: both languages (#114)", () => {
  it("is written in Azerbaijani when that is chosen, with words from the dictionary; the team's words are not translated", async () => {
    act(() => setLanguage("az"));
    api(() => undefined, view([question(1, { why_it_matters: "Needed for launch" })]));
    open();

    const az = (key: Key, values?: Record<string, string | number>) => translate("az", key, values);
    expect(await screen.findByText(az("client.lead"))).toBeInTheDocument();
    expect(screen.getByText(az("client.expires", { when: localStamp("2026-11-29T09:00:00Z") }))).toBeInTheDocument();
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

describe("ClientAnswers: re-reading the list keeps what was typed (#114)", () => {
  it("'Check again' on one question does not erase the other answers being written, or the name", async () => {
    let closedOne = false;
    api(({ init }) => {
      if (init.method === "POST") {
        closedOne = true;
        return json(404, {});
      }
      return closedOne ? json(200, view([question(2), question(3)])) : undefined;
    }, view([question(1), question(2), question(3)]));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q2"), { target: { value: "half written Q2" } });
    fireEvent.change(answerBox("Q3"), { target: { value: "half written Q3" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));

    fireEvent.click(await screen.findByRole("button", { name: t("client.checkAgain") }));

    await waitFor(() => expect(screen.queryByText("Invented question 1?")).not.toBeInTheDocument());
    expect(answerBox("Q2").value).toBe("half written Q2");
    expect(answerBox("Q3").value).toBe("half written Q3");
    expect(nameBox().value).toBe("Leyla");
  });

  it("brings the form back when the question is still open after all", async () => {
    let first = true;
    api(({ init }) => {
      if (init.method === "POST") {
        const reply = first ? json(404, {}) : json(201);
        first = false;
        return reply;
      }
    });
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));

    fireEvent.click(await screen.findByRole("button", { name: t("client.checkAgain") }));

    expect(await screen.findByLabelText(t("client.answerLabel", { label: "Q1" }))).toBeInTheDocument();
    expect(screen.queryByText(t("client.closed"))).not.toBeInTheDocument();
  });

  it("when checking again fails, keeps everything and says so", async () => {
    let closed = false;
    api(({ init }) => {
      if (init.method === "POST") {
        closed = true;
        return json(404, {});
      }
      return closed ? json(500, {}) : undefined;
    });
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q2"), { target: { value: "half written" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));

    fireEvent.click(await screen.findByRole("button", { name: t("client.checkAgain") }));

    expect(await screen.findByText(t("client.loadError"))).toBeInTheDocument();
    expect(answerBox("Q2").value).toBe("half written");
    expect(screen.getByText(t("client.closed"))).toBeInTheDocument();
  });

  it("when checking again finds the link dead, says so", async () => {
    let closed = false;
    api(({ init }) => {
      if (init.method === "POST") {
        closed = true;
        return json(404, {});
      }
      return closed ? json(404, {}) : undefined;
    });
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));

    fireEvent.click(await screen.findByRole("button", { name: t("client.checkAgain") }));

    expect(await screen.findByRole("heading", { name: t("client.unavailableTitle") })).toBeInTheDocument();
  });
});

describe("ClientAnswers: a link pasted into the same tab (#114)", () => {
  const NEW = "n".repeat(43);
  const change = (hash: string) => {
    setHash(hash);
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
  };

  it("is picked up when the page was showing 'not available'", async () => {
    setHash("");
    const calls = api();
    open();
    await screen.findByRole("heading", { name: t("client.unavailableTitle") });

    change(`#${NEW}`);

    expect(await screen.findByText("Invented question 1?")).toBeInTheDocument();
    expect((calls[0].init.headers as Record<string, string>)["X-Answer-Token"]).toBe(NEW);
  });

  it("is used for the answers sent afterwards", async () => {
    const calls = api(({ init }) => (init.method === "POST" ? json(201) : undefined));
    open();
    await screen.findByText("Invented question 1?");

    change(`#${NEW}`);
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });
    fireEvent.click(sendFor("Q1"));

    await screen.findByText(t("client.sent"));
    const post = calls.find((c) => c.init.method === "POST")!;
    expect((post.init.headers as Record<string, string>)["X-Answer-Token"]).toBe(NEW);
  });

  it("shows 'not available' if the new address is not a link", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");

    change("#oops");

    expect(await screen.findByRole("heading", { name: t("client.unavailableTitle") })).toBeInTheDocument();
  });
});

describe("ClientAnswers: keyboard and screen reader (#114)", () => {
  it("moves the keyboard to the name when it is missing (the error alone would be off screen on a phone), and to the box when the answer is", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");

    fireEvent.change(answerBox("Q2"), { target: { value: "An answer" } });
    fireEvent.click(sendFor("Q2"));
    expect(nameBox()).toHaveFocus();

    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q2"), { target: { value: " " } });
    fireEvent.click(sendFor("Q2"));
    expect(answerBox("Q2")).toHaveFocus();
  });

  it("does not take the keyboard away while sending: the button is only marked unavailable and the box is read-only", async () => {
    let release: (r: Response) => void = () => {};
    api(({ init }) => (init.method === "POST" ? new Promise<Response>((resolve) => (release = resolve)) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "Use Stripe." } });

    fireEvent.click(sendFor("Q1"));

    await waitFor(() => expect(screen.getByRole("button", { name: t("client.sending") })).toHaveAttribute("aria-disabled", "true"));
    expect(screen.getByRole("button", { name: t("client.sending") })).not.toBeDisabled();
    expect(answerBox("Q1")).toHaveAttribute("readonly");
    expect(answerBox("Q1")).not.toBeDisabled();
    await act(async () => release(json(201)));
    expect(answerBox("Q1")).not.toHaveAttribute("readonly");
  });

  it("announces 'sent' every time: the message area is always there, empties when sending starts and fills when it is done", async () => {
    let release: (r: Response) => void = () => {};
    let first = true;
    api(({ init }) => {
      if (init.method !== "POST") return undefined;
      if (first) {
        first = false;
        return json(201);
      }
      return new Promise<Response>((resolve) => (release = resolve));
    });
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    const area = () => answerBox("Q1").closest("form")!.querySelector('[role="status"]')!;
    expect(area()).toBeInTheDocument();
    expect(area().textContent).toBe("");

    fireEvent.change(answerBox("Q1"), { target: { value: "First." } });
    fireEvent.click(sendFor("Q1"));
    await waitFor(() => expect(area().textContent).toContain(t("client.sent")));
    fireEvent.change(answerBox("Q1"), { target: { value: "Second." } });
    fireEvent.click(sendFor("Q1"));

    await waitFor(() => expect(area().textContent).toBe("")); // cleared while the second is on its way
    await act(async () => release(json(201)));
    await waitFor(() => expect(area().textContent).toContain(t("client.sent")));
  });

  it("never shows 'Thank you' beside a new error", async () => {
    api(({ init }) => (init.method === "POST" ? json(201) : undefined));
    open();
    await screen.findByText("Invented question 1?");
    fireEvent.change(nameBox(), { target: { value: "Leyla" } });
    fireEvent.change(answerBox("Q1"), { target: { value: "First." } });
    fireEvent.click(sendFor("Q1"));
    await screen.findByText(t("client.sent"));

    fireEvent.click(sendFor("Q1")); // the box is empty now

    expect(screen.getByText(t("client.textRequired"))).toBeInTheDocument();
    expect(screen.queryByText(t("client.sent"))).not.toBeInTheDocument();
  });

  it("limits what can be typed to what the server accepts, so a long answer is stopped before it is sent", async () => {
    api();
    open();
    await screen.findByText("Invented question 1?");

    expect(nameBox()).toHaveAttribute("maxlength", "100");
    expect(answerBox("Q1")).toHaveAttribute("maxlength", "4000");
  });

  it("gives the 'wait' and 'could not load' pages a heading too", async () => {
    api(() => json(429, {}));
    open();

    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  });
});

describe("ClientAnswers: what the client is told when a limit is hit (#114)", () => {
  it("never describes the link as working or as dead, because a limit says nothing about that", () => {
    for (const key of ["client.tooMany", "client.throttled"] as const) {
      for (const language of ["en", "az"] as const) {
        const text = translate(language, key);
        expect(text, `${language} ${key}`).not.toMatch(/this question|no longer|not available|expired|works|əlçatan deyil|işləyir/i);
      }
    }
  });
});

describe("ClientAnswers: an old answer arriving late (#114)", () => {
  it("does not replace the page of a link pasted afterwards (the first link's slow answer comes last)", async () => {
    const NEW = "n".repeat(43);
    let releaseFirst: (r: Response) => void = () => {};
    api(({ init }) => {
      const sent = (init.headers as Record<string, string>)["X-Answer-Token"];
      if (sent === TOKEN) return new Promise<Response>((resolve) => (releaseFirst = resolve));
      return json(200, { ...view(), project_name: "Booking" });
    });
    open(); // starts reading with TOKEN, and that read is slow
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    setHash(`#${NEW}`);
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Booking" })).toBeInTheDocument();
    await act(async () => releaseFirst(json(200, { ...view(), project_name: "Ticketing" }))); // the old answer, late

    expect(screen.getByRole("heading", { level: 1, name: "Booking" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Ticketing" })).not.toBeInTheDocument();
  });
});
