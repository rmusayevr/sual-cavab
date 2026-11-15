import { describe, expect, it } from "vitest";

import { LINK_VISIBLE_MS, answerUrl, isLinkInfo, isSubmissionList, plainName } from "./answerLink";

describe("plainName (#114)", () => {
  it("removes the direction controls an anonymous name could use to reverse the words around it", () => {
    const sneaky = "Mal\u202Elory\u2066\u2069\u200E\u200F\u061C\u202A\u202B\u202C\u202D";

    expect(plainName(sneaky)).toBe("Mallory");
  });

  it("leaves ordinary names alone, including Azerbaijani letters and spaces", () => {
    expect(plainName("Əli Məmmədov")).toBe("Əli Məmmədov");
    expect(plainName("Leyla")).toBe("Leyla");
  });
});

describe("answerUrl", () => {
  it("puts the token after '#', where a browser never sends it to a server", () => {
    expect(answerUrl("https://app.example.invalid", "abc")).toBe("https://app.example.invalid/answer#abc");
  });
});

describe("how long the link stays on screen", () => {
  it("is minutes, not hours", () => {
    expect(LINK_VISIBLE_MS).toBeGreaterThanOrEqual(60_000);
    expect(LINK_VISIBLE_MS).toBeLessThanOrEqual(10 * 60_000);
  });
});

describe("the shape guards", () => {
  it("accept what the API sends and refuse anything else", () => {
    expect(isLinkInfo({ exists: false })).toBe(true);
    expect(isLinkInfo({ exists: true, state: "active" })).toBe(true);
    expect(isLinkInfo({ exists: true })).toBe(false);
    expect(isLinkInfo([])).toBe(false);
    expect(isLinkInfo(null)).toBe(false);
    expect(isSubmissionList([{ id: 1 }])).toBe(true);
    expect(isSubmissionList([{ name: "x" }])).toBe(false);
    expect(isSubmissionList({ detail: "x" })).toBe(false);
  });
});
