import { describe, expect, it } from "vitest";

import { TRANSITIONS, fieldErrors, today, transitionLabel } from "./questions";

describe("fieldErrors", () => {
  it("maps each field to its message", () => {
    expect(fieldErrors({ text: ["This field may not be blank."], blocks: ["Too long."] })).toEqual({
      text: "This field may not be blank.",
      blocks: "Too long.",
    });
  });

  it("flattens the nested answer errors to the answer's own fields", () => {
    expect(fieldErrors({ answer: { answered_on: ["The answer cannot be dated in the future."] } })).toEqual({
      answered_on: "The answer cannot be dated in the future.",
    });
  });

  it("puts a message that is not about a field under form, and ignores the allowed list", () => {
    expect(fieldErrors({ detail: "Not found." })).toEqual({ form: "Not found." });
    expect(fieldErrors({ to: ["A answered question cannot become dropped."], allowed: ["open"] })).toEqual({
      to: "A answered question cannot become dropped.",
    });
  });

  it("returns nothing for a body it cannot read", () => {
    expect(fieldErrors(null)).toEqual({});
    expect(fieldErrors("oops")).toEqual({});
  });
});

describe("transitions", () => {
  it("offers exactly the moves the backend allows", () => {
    expect(TRANSITIONS.open).toEqual(["asked", "answered", "dropped"]);
    expect(TRANSITIONS.asked).toEqual(["open", "answered", "dropped"]);
    expect(TRANSITIONS.answered).toEqual(["open"]);
    expect(TRANSITIONS.dropped).toEqual(["open"]);
  });

  it("names the move to open by where the question was", () => {
    expect(transitionLabel("asked", "open")).toBe("Un-ask");
    expect(transitionLabel("answered", "open")).toBe("Re-open");
    expect(transitionLabel("dropped", "open")).toBe("Restore");
  });
});

describe("today", () => {
  it("uses the local calendar date, zero-padded", () => {
    expect(today(new Date(2026, 2, 5, 23, 30))).toBe("2026-03-05");
  });
});
