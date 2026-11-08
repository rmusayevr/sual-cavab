/**
 * Base URL of the Sual-Cavab backend, from NEXT_PUBLIC_API_URL (no trailing slash).
 * Next.js inlines NEXT_PUBLIC_* values at build time.
 */
export const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
