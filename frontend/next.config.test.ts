import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

// Every Django URL ends in "/", and `:path*` drops it: without the slash in the
// destination, POSTs through the proxy hit Django's APPEND_SLASH and fail with
// a 500. Found running #4 end to end; unit tests of the components can't see it.
describe("the /api proxy", () => {
  it("waits longer than a drafting call can take: 30 s timeout, one retry, plus the wait between", () => {
    expect(nextConfig.experimental?.proxyTimeout).toBeGreaterThanOrEqual(30_000 * 2 + 15_000);
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
