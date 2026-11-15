import type { NextConfig } from "next";

// Where Next.js forwards /api/*. Server-side only and read when the config
// loads (build and start), so set it for both. An empty value counts as not
// set: an empty one would make the rewrite point at itself (a blank field in a
// platform dashboard, #10).
const BACKEND_URL = (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Django's URLs end in "/". Without this, Next.js 308-redirects /api/x/ to
  // /api/x before the rewrite, and a POST would lose its body.
  skipTrailingSlashRedirect: true,
  // The proxy gives up on a backend request after 30 s by default and answers a
  // plain 500. The first request after a free Render API has slept took 82 to 93 s
  // while it woke (measured 2026-11-09, scripts/smoke_test.py), so keep this above that.
  // (It was first sized for a drafting call, 135 s; drafting is gone, #115, the
  // wake-up is what still needs it.)
  experimental: { proxyTimeout: 150_000 },
  // The project page is the workspace (#70, #83). The older pages (questions, overview) are
  // gone: an old link or bookmark lands there. Temporary, not permanent: a browser keeps a permanent
  // redirect for good, and the workspace may still change. Both spellings are listed because
  // skipTrailingSlashRedirect (above) stops Next.js from treating them as one.
  async redirects() {
    return ["questions", "overview"].flatMap((page) =>
      ["", "/"].map((slash) => ({ source: `/projects/:id/${page}${slash}`, destination: "/projects/:id", permanent: false })),
    );
  },
  // The page a client opens with a private link (/answer#<token>, #114). The token is in the fragment, which a browser
  // never sends, so it cannot reach a Referer or a log; these headers keep the page itself out of search results and
  // stop it handing any address to a site it links to (it links to none). Both spellings, as for the redirects.
  async headers() {
    return ["/answer", "/answer/"].map((source) => ({
      source,
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    }));
  },
  async rewrites() {
    // Same origin for the browser: session and CSRF cookies stay first-party
    // and no CORS setup is needed (#4). `:path*` drops the trailing slash, and
    // every Django URL has one (a POST to /api/x would 500 on APPEND_SLASH),
    // so the destination puts it back. Found running #4 end to end.
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*/` }];
  },
};

export default nextConfig;
