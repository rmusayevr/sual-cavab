# Design

> Written down from what the project already does (frontend/app/globals.css, frontend/components/ui/,
> the owner's design example). **Awaiting the owner's confirmation.** Every UI issue follows it.
> Changing the direction takes an issue. Tests that enforce it: `frontend/app/design-tokens.test.ts`.

## Direction

**An Azerbaijani ledger.** Deep navy, pomegranate red as the one action colour, saffron as the accent,
carpet-diamond strips as seams, a serif for headings and monospace for the numbered ledger. For
people who track the open questions of client projects and write short messages to the client.
(Source: the owner's design example, 2026-11-09; its folder `sual-cavab-design/` is not kept in the repo.)

**Why this one.** The job is a ledger of numbered questions (Q1, Q2 …), so numbers and statuses lead.
The owner chose it and brought it; nothing here was offered as a new direction. Accepted risk: no
dark theme, and the status dot for "asked" (amber) is only 2.6:1, so the word always sits beside it.

## Tokens

All colours are defined once in `frontend/app/globals.css` and reach components as Tailwind names
(`bg-card`, `text-muted-foreground`, `bg-navy`, `text-saffron` …). Never write a literal colour.

```css
:root {
  color-scheme: light;
  --radius: 0.375rem;
  --background: oklch(0.955 0.014 80);       /* warm paper */
  --foreground: oklch(0.2 0.04 255);
  --card: oklch(0.985 0.008 80);
  --muted: oklch(0.92 0.018 80);
  --muted-foreground: oklch(0.46 0.03 255);  /* 6.2:1 on the paper */
  --border: oklch(0.86 0.025 75);            /* hairlines */
  --control-border: oklch(0.58 0.03 255);    /* inputs, outline buttons: 3:1 needed (added, see below) */
  --primary: oklch(0.5 0.19 27);             /* pomegranate: the action colour */
  --primary-foreground: oklch(0.98 0.01 80);
  --primary-on-navy: oklch(0.64 0.19 27);    /* the same red, lighter, 4.93:1 on navy (added) */
  --destructive: oklch(0.55 0.21 27);        /* dropping a question only */
  --accent: oklch(0.77 0.15 80);             /* saffron: eyebrows on navy, counts */
  --navy: oklch(0.2 0.045 255);
  --navy-foreground: oklch(0.95 0.015 80);
  --ring: oklch(0.5 0.19 27);                /* focus; saffron on navy */
  /* the four statuses, fixed: dot + word, never colour alone */
  --status-open: oklch(0.5 0.19 27);         /* Open     / Açıq */
  --status-asked: oklch(0.7 0.15 75);        /* Asked    / Soruşulub */
  --status-answered: oklch(0.55 0.1 160);    /* Answered / Cavablanıb */
  --status-dropped: oklch(0.6 0.02 255);     /* Dropped  / Ləğv */
  --shadow-card: 0 1px 0 oklch(0.86 0.025 75), 0 12px 30px -18px oklch(0.2 0.045 255 / 35%);
}
/* No dark theme: the example has none. */
```

Two tokens are not in the example, added because the measured contrast was too low (the file says so):
`--control-border` and `--primary-on-navy`. Saffron is text only on navy (2:1 on paper).

**Type.** Fraunces for `h1`–`h3` (set by a base rule, `letter-spacing: -0.02em`), Manrope for text and
UI, JetBrains Mono for ids, counts, eyebrows and status words (`font-mono text-xs`; eyebrows
`uppercase tracking-[0.25em]`). Loaded with `next/font/google`, with `Georgia`, `system-ui` and
`ui-monospace` as fallbacks. Manrope has no capital Ə: it falls back to another font there (README).

**Space and shape.** Radius 0.375 rem (`rounded-md`/`lg`); no pills except the status dot. One shadow
(`shadow-card`). Hairlines are `border`. Carpet strips are the seam where navy meets paper.

## Layout

Pages are `max-w-6xl` (the workspace `90rem`) with `px-4` on a phone and `px-6` above. The workspace is
three panes at `lg` (`15rem` navy project rail, questions, `24rem` selected question and draft) and
stacks on a phone: rail, list, detail, add, draft. **One carpet strip per screen**; `pattern-lattice`
is the only full-surface pattern, and only on navy. At 360 px nothing scrolls sideways (long words wrap
with `overflow-wrap:anywhere`).

## Components and their states

Shared ones live in `frontend/components/ui/`: Button, Field/Input/Textarea/Select, StatusChip, Card,
Alert, PageShell, AppHeader, Wordmark, WakingNote, and Ledger (CarpetStrip, Eyebrow, LedgerLoading,
EmptyState).
- **Buttons:** `btn-primary` (red), `btn-ghost` (outline, takes the colour around it, reads on navy and
  paper), `btn-danger`. Hover only where a pointer can hover and the button is enabled; disabled is
  dimmed; 44 px minimum height.
- **Focus:** a visible red ring; saffron on navy.
- **Status:** `StatusChip` shows the dot and the word from one table (`lib/status.ts` colours, the
  dictionaries the words).
- **Loading:** ledger rows that pulse (off for reduced motion), plus a note after five seconds that the
  site may be waking up. **Empty:** a card under a carpet strip that says what to do next. **Error:**
  `Alert`, red, with the reason in words.

## Voice

English by default, Azerbaijani second (`EN | AZ`, `frontend/lib/i18n`); technical terms stay in
English (`refund`, `admin`, `support`, `checkout`, `endpoint`, `auth`). Question text is the ledger
entry and is never translated. Errors say what happened and what to do ("Could not reach the server."),
empty states say what to do next ("No questions yet. Add the first one."). The app never sends a
message: the draft is text to review, edit and copy.

## Don't

No hardcoded colours or default Tailwind palette utilities; no new fonts; no gradients except the
carpet's own flat diamonds; no pills, glass, blur or second shadow; no emoji or icon-in-circle rows;
no status colour outside the four; no carpet behind text; no saffron text on paper; no more than one
carpet strip per screen.
