/**
 * Calls to the backend go to the same origin: next.config.ts rewrites /api/*
 * to Django, so the session and CSRF cookies are first-party.
 */

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/** The CSRF token, fetching the cookie first if the browser has none yet. */
async function csrfToken(): Promise<string> {
  let token = readCookie("csrftoken");
  if (!token) {
    await fetch("/api/auth/csrf/", { credentials: "same-origin" });
    token = readCookie("csrftoken");
  }
  return token ?? "";
}

/** fetch() for the backend: JSON in, same-origin cookies, CSRF header on writes. */
export async function apiFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (UNSAFE.has(method)) headers["X-CSRFToken"] = await csrfToken();
  return fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export type CurrentUser = { id: number; email: string; name: string };
