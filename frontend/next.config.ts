import type { NextConfig } from "next";

// Where Next.js forwards /api/*. Server-side only and read when the config
// loads (build and start), so set it for both.
const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Django's URLs end in "/". Without this, Next.js 308-redirects /api/x/ to
  // /api/x before the rewrite, and a POST would lose its body.
  skipTrailingSlashRedirect: true,
  // The proxy gives up on a backend request after 30 s by default and answers a
  // plain 500. A draft can take 30 s per attempt plus one retry (#9), so without
  // this the browser saw a 500 while Django finished a paid call nobody read.
  experimental: { proxyTimeout: 90_000 },
  async rewrites() {
    // Same origin for the browser: session and CSRF cookies stay first-party
    // and no CORS setup is needed (#4). `:path*` drops the trailing slash, and
    // every Django URL has one (a POST to /api/x would 500 on APPEND_SLASH),
    // so the destination puts it back. Found running #4 end to end.
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*/` }];
  },
};

export default nextConfig;
