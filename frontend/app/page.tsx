import type { Metadata } from "next";
import Link from "next/link";

import SessionStatus from "@/components/SessionStatus";
import { LanguageSwitch } from "@/lib/i18n";
import { buttonClasses } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import type { QuestionStatus } from "@/lib/status";

// The landing page, from the owner's design example (#69). Everything on it is invented text: the
// project, the questions and the drafted message are not from any client.

const SAMPLE_QUESTIONS: Array<{ id: number; text: string; status: QuestionStatus }> = [
  { id: 1, text: "Who can issue a refund — only admins, or support too?", status: "open" },
  { id: 2, text: "What happens to sold tickets when an event date moves?", status: "asked" },
  { id: 3, text: "Which card types are allowed at checkout?", status: "answered" },
  { id: 4, text: "Is there a max number of tickets per order?", status: "open" },
  { id: 5, text: "Should guest checkout be supported?", status: "open" },
];

const FEATURES: Array<[string, string, string]> = [
  ["01", "Questions per project", "Q1, Q2… each with why it matters and which task it blocks."],
  ["02", "A clear status", "Open, asked, answered or dropped — with who, when and where."],
  ["03", "Open at a glance", "One number per project. No more digging through chats."],
  ["04", "Drafted messages", "Short Azerbaijani text, technical terms kept in English."],
];

export const metadata: Metadata = {
  title: "Sual-Cavab — track the questions your project is waiting on",
  description: "Keep every open client question in one place and draft short Azerbaijani messages with English tech terms.",
  openGraph: {
    title: "Sual-Cavab — track open project questions",
    description: "Numbered questions, clear statuses, and drafted client messages in Azerbaijani.",
  },
};

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="bg-navy pattern-lattice text-navy-foreground">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-x-6 gap-y-3 px-6 py-5">
          <Link href="/" aria-label="Sual-Cavab, home" className="font-display text-xl font-semibold">
            Sual<span className="text-saffron">·</span>Cavab
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <LanguageSwitch />
            <SessionStatus layout="nav" />
          </div>
        </nav>
        <div className="mx-auto grid max-w-6xl gap-12 px-6 pb-24 pt-12 md:grid-cols-[1.1fr_1fr] md:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-saffron">
              sual · cavab — question · answer
            </p>
            <h1 className="mt-5 text-5xl font-extrabold leading-[1.02] md:text-7xl">
              How many questions are <em className="text-primary-on-navy">still open?</em>
            </h1>
            <p className="mt-6 max-w-md text-lg opacity-80">
              Every client question in one ledger — numbered, tracked, and ready to send in Azerbaijani.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/projects" className={buttonClasses("primary")}>
                Start tracking
              </Link>
              <a href="https://github.com/rmusayevr/sual-cavab" className={buttonClasses("secondary")}>
                GitHub
              </a>
            </div>
          </div>
          <div className="min-w-0 rounded-lg bg-card p-2 text-card-foreground shadow-card">
            <div aria-hidden="true" className="h-2 rounded-t pattern-carpet" />
            <ul role="list" aria-label="Sample questions" className="list-none divide-y">
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
              <h2 className="mt-2 text-2xl font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-10 rounded-lg bg-navy p-10 text-navy-foreground md:grid-cols-2 md:items-center">
            <div>
              <h2 className="text-4xl font-semibold">You review it. You send it.</h2>
              <p className="mt-4 opacity-80">
                Pick the open questions — Sual-Cavab writes the message. Nothing leaves without you.
              </p>
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
