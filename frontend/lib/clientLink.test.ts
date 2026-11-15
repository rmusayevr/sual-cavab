import { afterEach, describe, expect, it, vi } from "vitest";

import { isClientView, loadQuestions, localStamp, sendAnswer, tokenFromHash } from "./clientLink";

const TOKEN = "k".repeat(43);
const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });
const view = { project_name: "Ticketing", expires_at: "2026-11-29T09:00:00Z", questions: [{ number: 1, label: "Q1", text: "Which?", why_it_matters: "", blocks: "" }] };

function stub(reply: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return reply(url, init);
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("tokenFromHash (#114)", () => {
  it("takes the token out of the fragment", () => {
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(TOKEN)).toBe(TOKEN);
  });

  it("refuses anything that cannot be a token, without asking the server", () => {
    for (const hash of ["", "#", "#short", `#${TOKEN}x`, `#${"k".repeat(42)}`, `#${TOKEN}&a=b`, "#" + "é".repeat(43), `# ${TOKEN}`]) {
      expect(tokenFromHash(hash), hash).toBeNull();
    }
  });
});

describe("loadQuestions", () => {
  it("asks the one route, with the token in one header and nothing in the address", async () => {
    const calls = stub(() => json(200, view));

    const result = await loadQuestions(TOKEN);

    expect(result).toEqual({ kind: "ok", view });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/answer-link/questions/");
    expect(calls[0].url).not.toContain(TOKEN);
    expect((calls[0].init.headers as Record<string, string>)["X-Answer-Token"]).toBe(TOKEN);
  });

  it("sends no cookies, does not cache, and sends no Referer", async () => {
    const calls = stub(() => json(200, view));

    await loadQuestions(TOKEN);

    expect(calls[0].init).toMatchObject({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", method: "GET" });  // literal-password-ok: a fetch option, not a secret
  });

  it("tells the answers apart: gone, throttled, failed, and a reply that is not a list of questions", async () => {
    stub(() => json(404, { detail: "This link is not available." }));
    expect(await loadQuestions(TOKEN)).toEqual({ kind: "unavailable" });
    stub(() => json(429, {}));
    expect(await loadQuestions(TOKEN)).toEqual({ kind: "throttled" });
    stub(() => json(500, {}));
    expect(await loadQuestions(TOKEN)).toEqual({ kind: "error" });
    stub(() => json(200, [{ id: 1 }]));
    expect(await loadQuestions(TOKEN)).toEqual({ kind: "error" });
    stub(() => {
      throw new Error("offline");
    });
    expect(await loadQuestions(TOKEN)).toEqual({ kind: "error" });
  });
});

describe("sendAnswer", () => {
  it("posts the text and the name to the question's own route, as JSON, with no cookies", async () => {
    const calls = stub(() => json(201));

    const result = await sendAnswer(TOKEN, 3, { text: "Use Stripe.", name: "Leyla" });

    expect(result).toEqual({ kind: "sent" });
    expect(calls[0].url).toBe("/api/answer-link/questions/3/answers/");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ text: "Use Stripe.", name: "Leyla" });
    expect(calls[0].init).toMatchObject({ method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });  // literal-password-ok: a fetch option, not a secret
    expect((calls[0].init.headers as Record<string, string>)["X-Answer-Token"]).toBe(TOKEN);
    expect(Object.keys(calls[0].init.headers as object).some((h) => h.toLowerCase() === "x-csrftoken")).toBe(false);
  });

  it("tells the answers apart: closed, too many, the server's reasons, and failures", async () => {
    stub(() => json(404, {}));
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({ kind: "closed" });
    stub(() => json(429, {}));
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({ kind: "tooMany" });
    stub(() => json(400, { text: ["Ensure this field has no more than 4000 characters."] }));
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({
      kind: "invalid",
      errors: { text: "Ensure this field has no more than 4000 characters." },
    });
    stub(() => json(400, "not an object"));
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({ kind: "error" });
    stub(() => new Response("<html>bad gateway</html>", { status: 400 }));
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({ kind: "error" });
    stub(() => json(500, {}));
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({ kind: "error" });
    stub(() => {
      throw new Error("offline");
    });
    expect(await sendAnswer(TOKEN, 1, { text: "x", name: "n" })).toEqual({ kind: "error" });
  });
});

describe("isClientView", () => {
  it("accepts the server's reply and refuses anything else", () => {
    expect(isClientView(view)).toBe(true);
    expect(isClientView({ ...view, questions: [] })).toBe(true);
    expect(isClientView({ ...view, questions: [{ number: "1" }] })).toBe(false);
    expect(isClientView({ project_name: "x" })).toBe(false);
    expect(isClientView(null)).toBe(false);
    expect(isClientView([])).toBe(false);
  });
});

describe("localStamp", () => {
  it("shows a moment in the reader's own time zone, so the date is not a day off", () => {
    expect(localStamp("2026-11-29T09:00:00Z", "Asia/Baku")).toBe("2026-11-29 13:00");
    expect(localStamp("2026-11-29T09:00:00Z", "America/Los_Angeles")).toBe("2026-11-29 01:00");
    expect(localStamp("2026-11-29T01:00:00Z", "America/Los_Angeles")).toBe("2026-11-28 17:00"); // the UTC date would say the 29th
  });

  it("writes midnight as 00:00, never 24:00", () => {
    expect(localStamp("2026-11-29T00:00:00Z", "UTC")).toBe("2026-11-29 00:00");
  });
});
