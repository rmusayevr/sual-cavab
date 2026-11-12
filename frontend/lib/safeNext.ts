/**
 * Where to go after signing in (#96). The destination travels in the address (`/login?next=/projects/5`), so
 * anyone can write anything there: it is used only if it is a path inside this app. A value that could leave
 * the site (`https://...`, `//host`, a backslash, which browsers read as a slash, a tab or newline, which they
 * drop) is ignored and the person goes to the home page, as before. The sign-in page itself is never a
 * destination: it would send the person round in a circle.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const base = "http://app.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return null;
    // The router resolves dot segments, so "/.//host" is "//host" by the time it navigates (review of #107):
    // check, and return, the path as the browser will read it, not the string as it was written.
    if (url.pathname.startsWith("//")) return null;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** The sign-in address that brings the person back to `from` (a page of the app), or plain `/login`. */
export function loginHref(from: string | null | undefined): string {
  const next = safeNext(from);
  return next ? `/login?next=${encodeURIComponent(next)}` : "/login";
}
