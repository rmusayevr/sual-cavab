import { describe, expect, it } from "vitest";

import { TRANSITIONS, fieldErrors, transitionLabel } from "./questions";

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

// The server refuses an answer date after today in Asia/Baku (UTC+4, settings.TIME_ZONE) (#48). The
// default is the EARLIER of the browser's date and Baku's: never refused, never in the browser's own
// future. The instants are in UTC and the browser's date is passed in, so the answer is the same on
// any machine.
