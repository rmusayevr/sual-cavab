"use client";

import Link from "next/link";

import { LanguageSwitch, useT, type Key } from "@/lib/i18n";
import type { QuestionStatus } from "@/lib/status";

import SessionStatus from "./SessionStatus";
import { buttonClasses } from "./ui/Button";
import { StatusChip } from "./ui/StatusChip";
import { Wordmark } from "./ui/Wordmark";

// The landing page, from the owner's design example (#69). Everything on it is invented text: the
// project, the questions and the drafted message are not from any client. The sample message is
// already Azerbaijani with English technical terms, as the drafting feature writes it, so it is
// shown the same in both languages.

// Question text is the ledger entry: it is written in English and is not translated (DESIGN.md
// section 7), like the questions a person types in the app. Only the status words follow the language.
const SAMPLE_QUESTIONS: Array<{ id: number; text: string; status: QuestionStatus }> = [
  { id: 1, text: "Who can issue a refund — only admins, or support too?", status: "open" },
  { id: 2, text: "What happens to sold tickets when an event date moves?", status: "asked" },
  { id: 3, text: "Which card types are allowed at checkout?", status: "answered" },
  { id: 4, text: "Is there a max number of tickets per order?", status: "open" },
  { id: 5, text: "Should guest checkout be supported?", status: "open" },
];

const FEATURES: Array<[string, Key, Key]> = [
  ["01", "landing.f1.title", "landing.f1.text"],
  ["02", "landing.f2.title", "landing.f2.text"],
  ["03", "landing.f3.title", "landing.f3.text"],
  ["04", "landing.f4.title", "landing.f4.text"],
];

export default function Landing() {
  const t = useT();
  return (
    <div className="min-h-screen">
      <header className="bg-navy pattern-lattice text-navy-foreground">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 py-5">
          <Wordmark className="font-display text-xl font-semibold" />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <LanguageSwitch />
            <SessionStatus layout="nav" />
          </div>
        </nav>
        <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-12 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-saffron">
              {t("landing.eyebrow")}
            </p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[1.02] md:text-7xl">
              {t("landing.h1a")}
              <em className="text-primary-on-navy">{t("landing.h1b")}</em>
            </h1>
            <p className="mt-6 max-w-md text-lg opacity-80">
              {t("landing.lead")}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/projects" className={buttonClasses("primary")}>
                {t("landing.start")}
              </Link>
              <a href="https://github.com/rmusayevr/sual-cavab" className={buttonClasses("secondary")}>
                GitHub
              </a>
            </div>
          </div>
          <div className="min-w-0 rounded-lg bg-card p-2 text-card-foreground shadow-card">
            <div aria-hidden="true" className="h-2 rounded-t pattern-carpet" />
            <ul role="list" aria-label={t("landing.sample")} className="list-none divide-y">
              {SAMPLE_QUESTIONS.map((q) => (
                <li key={q.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="font-mono text-xs text-muted-foreground">Q{q.id}</span>
                  <span className="min-w-0 flex-1 text-sm">{q.text}</span>
                  <StatusChip status={q.status} className="shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div aria-hidden="true" className="h-3 pattern-carpet" />
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl gap-x-0 gap-y-10 px-6 py-24 md:grid-cols-4 md:gap-y-0">
          {FEATURES.map(([n, title, description]) => (
            <div key={n} className="border-t-2 border-primary pt-5 md:pr-6">
              <span className="font-mono text-xs text-primary">{n}</span>
              <h2 className="mt-2 text-2xl font-semibold">{t(title)}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{t(description)}</p>
            </div>
          ))}
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-10 rounded-lg bg-navy p-10 text-navy-foreground md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-4xl font-semibold">{t("landing.review.title")}</h2>
              <p className="mt-4 opacity-80">{t("landing.review.text")}</p>
            </div>
            <blockquote className="rounded-md border-l-4 border-saffron bg-card p-6 text-sm leading-relaxed text-card-foreground">
              Salam, Leyla xanım! Bir neçə sualımız var:
              <br />
              1. Kim <b>refund</b> edə bilər — yalnız <b>admin</b>, yoxsa <b>support</b> da?
              <br />
              2. Bir sifarişdə maksimum neçə bilet ola bilər?
              <br />
              Təşəkkürlər!
            </blockquote>
          </div>
        </section>
      </main>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">Sual-Cavab · MIT</footer>
    </div>
  );
}
