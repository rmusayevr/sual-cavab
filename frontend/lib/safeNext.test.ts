import { describe, expect, it } from "vitest";

import { loginHref, safeNext } from "./safeNext";

describe("safeNext (#96): only a place inside this app", () => {
  it("accepts a path of the app, with its query", () => {
    expect(safeNext("/projects/5")).toBe("/projects/5");
    expect(safeNext("/projects")).toBe("/projects");
    expect(safeNext("/projects/5?x=1")).toBe("/projects/5?x=1");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of [
      "https://example.invalid",
      "https://example.invalid/projects",
      "//example.invalid",
      "//example.invalid/projects",
      "/\\example.invalid",
      "\\\\example.invalid",
      "/\t/example.invalid",
      "/\n/example.invalid",
      "/.//example.invalid",
      "/..//example.invalid",
      "/%2e//example.invalid",
      "/%2E%2E//example.invalid",
      "/.///example.invalid",
      "/login/",
      "/login/x",
      "javascript:alert(1)",
      "projects/5",
      "example.invalid",
      "",
      " /projects",
    ]) {
      expect(safeNext(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("gives back the path the browser will read, with dot segments resolved", () => {
    expect(safeNext("/./projects/5")).toBe("/projects/5");
    expect(safeNext("/projects/../projects/5")).toBe("/projects/5");
    expect(safeNext("/projects/5#top")).toBe("/projects/5#top");
  });

  it("refuses nothing, and the sign-in page itself (it would send the person round in a circle)", () => {
    expect(safeNext(null)).toBeNull();
    expect(safeNext("/login")).toBeNull();
    expect(safeNext("/login?next=/projects/5")).toBeNull();
  });
});

describe("loginHref", () => {
  it("carries the page the person was on", () => {
    expect(loginHref("/projects/5")).toBe("/login?next=%2Fprojects%2F5");
  });

  it("carries nothing from a page that is not a safe destination", () => {
    expect(loginHref(null)).toBe("/login");
    expect(loginHref("/login")).toBe("/login");
    expect(loginHref("//example.invalid")).toBe("/login");
  });
});
