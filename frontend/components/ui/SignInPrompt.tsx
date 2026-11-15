"use client";

import Link from "next/link";

import { useT, type Key } from "@/lib/i18n";
import { useLoginHref } from "@/lib/useLoginHref";

import { buttonClasses } from "./Button";

/**
 * "Sign in to see ...": one sentence per language with a `{link}` marker, so the button sits where
 * that language puts it. Used where a request answered 401 or 403 (the session ended), so the
 * projects page and the workspace say the same thing (#91). The spaces around the button are kept
 * so a screen reader does not read "Sign into see".
 */
export function SignInPrompt({ line }: { line: Key }) {
  const t = useT();
  const href = useLoginHref();
  return (
    <p className="flex flex-wrap items-center gap-2">
      {t(line)
        .split("{link}")
        .flatMap((part, i, parts) => [
          part.trim() ? <span key={`t${i}`}>{part}</span> : null,
          i < parts.length - 1 ? (
            <Link key={`l${i}`} href={href} className={buttonClasses("primary")}>
              {t("session.signIn")}
            </Link>
          ) : null,
        ])}
    </p>
  );
}
