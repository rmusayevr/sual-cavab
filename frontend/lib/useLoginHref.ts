"use client";

import { usePathname } from "next/navigation";

import { loginHref } from "./safeNext";

/** The sign-in link for the page the person is on now, so signing in brings them back to it (#96). */
export function useLoginHref(): string {
  return loginHref(usePathname());
}
