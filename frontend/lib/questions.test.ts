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

// The server refuses an answer date after today in Asia/Baku (UTC+4, settings.TIME_ZONE), so the
// default must be Baku's today whatever the browser's own time zone is (#48). These instants are
// in UTC, so the tests give the same answer on any machine.
describe("today", () => {
  it("is the Baku date, zero-padded", () => {
    expect(today(new Date("2026-03-05T10:00:00Z"))).toBe("2026-03-05");
  });

  it("is still the day before up to 23:59 in Baku (19:59 UTC)", () => {
    expect(today(new Date("2026-03-05T19:59:59Z"))).toBe("2026-03-05");
  });

  it("is already the next day at Baku midnight (20:00 UTC), where a browser behind UTC+4 would say yesterday", () => {
    expect(today(new Date("2026-03-05T20:00:00Z"))).toBe("2026-03-06");
    expect(today(new Date("2026-03-05T20:30:00Z"))).toBe("2026-03-06");
  });

  it("crosses a month and a year the way Baku's calendar does", () => {
    expect(today(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(today(new Date("2026-02-28T20:00:00Z"))).toBe("2026-03-01");
  });
});
