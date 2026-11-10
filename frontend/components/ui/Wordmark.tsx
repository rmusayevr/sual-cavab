"use client";

import Link from "next/link";

import { useT } from "@/lib/i18n";

/** The product name as a link home, named in the chosen language. One place, so every page agrees. */
export function Wordmark({ className }: { className?: string }) {
  const t = useT();
  return (
    <Link href="/" aria-label={t("nav.home")} className={className}>
      Sual<span className="text-saffron">·</span>Cavab
    </Link>
  );
}
