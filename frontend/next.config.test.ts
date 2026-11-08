import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "./next.config";

// Every Django URL ends in "/", and `:path*` drops it: without the slash in the
// destination, POSTs through the proxy hit Django's APPEND_SLASH and fail with
// a 500. Found running #4 end to end; unit tests of the components can't see it.
describe("the /api proxy", () => {
  it("waits longer than a drafting call can take (135 s: WORST_CASE_SECONDS in backend/drafting/client.py)", () => {
    expect(nextConfig.experimental?.proxyTimeout).toBeGreaterThan(135_000);
  });

  it("forwards to the backend with the trailing slash Django requires", async () => {
    const rewrites = await nextConfig.rewrites!();
    const list = Array.isArray(rewrites)
      ? rewrites
      : [...(rewrites.beforeFiles ?? []), ...(rewrites.afterFiles ?? []), ...(rewrites.fallback ?? [])];
    const api = list.find((r) => r.source === "/api/:path*");

    expect(api?.destination).toMatch(/\/api\/:path\*\/$/);
  });
});

// The address the rewrite forwards to, for a given environment. The config reads
// it when it loads, so each case loads it afresh.
async function destinationWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  const { default: config } = await import("./next.config");
  const rewrites = await config.rewrites!();
  const list = Array.isArray(rewrites) ? rewrites : (rewrites.afterFiles ?? []);
  return list.find((r) => r.source === "/api/:path*")?.destination;
}

describe("where /api is forwarded", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("goes to localhost:8000 when nothing is set", async () => {
    expect(await destinationWith({ BACKEND_URL: "" })).toBe("http://localhost:8000/api/:path*/");
  });

  it("goes to BACKEND_URL, without a trailing slash doubling up", async () => {
    expect(await destinationWith({ BACKEND_URL: "https://api.example.invalid/" })).toBe(
      "https://api.example.invalid/api/:path*/",
    );
  });

});
