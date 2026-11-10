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

// The server refuses an answer date after today in Asia/Baku (UTC+4, settings.TIME_ZONE) (#48). The
// default is the EARLIER of the browser's date and Baku's: never refused, never in the browser's own
// future. The instants are in UTC and the browser's date is passed in, so the answer is the same on
// any machine.
describe("today", () => {
  it("is just today where the browser and Baku agree, zero-padded", () => {
    expect(today(new Date("2026-03-05T10:00:00Z"), "2026-03-05")).toBe("2026-03-05");
    expect(today(new Date("2026-03-05T20:30:00Z"), "2026-03-06")).toBe("2026-03-06"); // a browser in Baku
  });

  it("is Baku's date for a browser AHEAD of Baku just after its own midnight: the reported bug", () => {
    // 19:59:59 UTC is 23:59:59 in Baku, but already the next day at UTC+6 or UTC+9
    expect(today(new Date("2026-03-05T19:59:59Z"), "2026-03-06")).toBe("2026-03-05");
    expect(today(new Date("2026-03-05T16:00:00Z"), "2026-03-06")).toBe("2026-03-05"); // a Tokyo browser at 01:00
  });

  it("is the browser's own date for a browser BEHIND Baku, never a date in its own future", () => {
    // 20:30 UTC is 00:30 the next day in Baku, but still the 5th at UTC or in the Americas
    expect(today(new Date("2026-03-05T20:30:00Z"), "2026-03-05")).toBe("2026-03-05");
    expect(today(new Date("2026-03-05T21:00:00Z"), "2026-03-05")).toBe("2026-03-05"); // Los Angeles at 13:00
  });

  it("crosses a month and a year the way each calendar does", () => {
    expect(today(new Date("2026-12-31T20:00:00Z"), "2027-01-01")).toBe("2027-01-01");
    expect(today(new Date("2026-12-31T20:00:00Z"), "2026-12-31")).toBe("2026-12-31");
    expect(today(new Date("2026-02-28T19:00:00Z"), "2026-03-01")).toBe("2026-02-28");
  });

  it("uses the browser's own calendar by default, when no date is given, and is never later than it", () => {
    const now = new Date();
    const own = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(today(now) <= own).toBe(true);
  });
});
