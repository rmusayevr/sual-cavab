# Sual-Cavab

**Track the questions your project is waiting on.**

Every client project collects open questions: who can refund, what happens to
sold tickets when a date moves, which card types are allowed. They live in chat
threads and meeting notes until someone asks "how many are still open?" and
nobody knows.

Sual-Cavab ("question-answer" in Azerbaijani) keeps them in one place:

- **Questions per project**, numbered Q1, Q2…, each with why it matters and
  which task it blocks.
- **A clear status:** open, asked, answered or dropped. Every answer records
  who gave it, when, and where.
- **What's still open**, at a glance.
- **A drafted message** for the client or a teammate: pick the open questions
  and get a short message in Azerbaijani, with technical terms kept in English.
  You review it and send it yourself.

> Status: early. The first version is being built in the open, issue by issue.

## Stack

Django + Django REST Framework (backend), Next.js (frontend), PostgreSQL.

## Local setup

The backend needs a PostgreSQL. The repo ships a `docker-compose.yml` with one
(PostgreSQL 17), so you do not have to install anything but Docker.

```bash
cp backend/.env.example backend/.env     # then set POSTGRES_PORT, see below
docker compose --env-file backend/.env up -d --wait db
```

Then run the backend and the frontend as described below, and the checks:

```bash
cd backend && python manage.py check && python manage.py makemigrations --check --dry-run && python manage.py test
cd ../frontend && npm run lint && npm run typecheck && npm test && npm run build
```

Things to know:

- **Every compose command needs `--env-file backend/.env`** (also `ps`, `logs`,
  `down`), or `export COMPOSE_ENV_FILES=backend/.env` once in your shell.
- **The port comes from `backend/.env`** (`POSTGRES_PORT`), and the backend
  reads the same file. The example uses 5433. It must not clash with a
  PostgreSQL already on your machine: a native install usually holds 5432, and
  talking to the wrong server shows up as password errors rather than "wrong
  port". Pick another, for example 5433. A `POSTGRES_PORT` exported in your
  shell wins over the file, for compose and for the backend alike.
- **Compose and the backend read `backend/.env` a little differently**: compose
  expands a `$` and drops a trailing `# comment`, the backend does neither. A
  password such as `pa$word1`, or `POSTGRES_PORT=5433  # mine`, gives compose
  one value and Django another, and the sign-in fails. Keep `$` and inline
  comments out of the `POSTGRES_*` lines (or use single quotes).
- **The database listens on this machine only** (127.0.0.1 and ::1), and is for
  local work. Staging and production are a separate matter. Both addresses are
  bound on purpose: with only IPv4, `POSTGRES_HOST=localhost` made every
  connection wait 10 seconds on Windows with Docker Desktop (it tries `::1`
  first). If your Docker has no IPv6 and `up` fails on the `[::1]` line, create
  a `docker-compose.override.yml` (git ignores it) next to `docker-compose.yml`
  instead of editing the tracked file, and set `POSTGRES_HOST=127.0.0.1` in
  `backend/.env`:

  ```yaml
  services:
    db:
      ports: !override
        - "127.0.0.1:${POSTGRES_PORT}:5432"
  ```
- **The data lives in a named volume.** It survives `docker compose down` and a
  reboot. `docker compose --env-file backend/.env down -v` deletes it: that is
  the reset (then `up` again and `migrate`).
- **Database name, user and password are applied only when the volume is first
  created.** Changing them in `backend/.env` later does not change an existing
  database; reset it as above.
- If a value is missing from `backend/.env`, compose stops and says which one.
- The compose project is named `sual-cavab`, so two clones of the repository on
  one machine share one container and one volume.
- Prefer your own PostgreSQL? Skip the compose step and point the `POSTGRES_*`
  values in `backend/.env` at it.

## Run the backend

Needs Python 3.12+ and a PostgreSQL you can create databases on (see
[Local setup](#local-setup)).

```bash
cd backend
python -m venv .venv
source .venv/bin/activate     # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env          # then set the POSTGRES_* values for your database
python manage.py migrate
python manage.py createcachetable  # sign-in attempt counters live in PostgreSQL
python manage.py createsuperuser   # accounts are created by an admin; there is no sign-up
python manage.py runserver
```

`GET http://localhost:8000/api/health/` returns `{"status": "ok"}`. Add more
users at `http://localhost:8000/admin/`. People sign in with their email.

After pulling changes, run `python manage.py migrate` **before** starting the
new code: it selects columns that migrations add (for example
`next_question_number`), so new code on an un-migrated database fails with 500s.

If you ran `migrate` before accounts existed (#4), that database still has
Django's default user table and `migrate` now stops with
`InconsistentMigrationHistory`. It holds no project data yet: drop and recreate
the database, then migrate again.

Run the tests with `python manage.py test`. Environment variables already set
in your shell win over `backend/.env`.

Each test run creates its own database, named `test_<POSTGRES_DB>_<process id>`
(a long `POSTGRES_DB` is cut so the name fits PostgreSQL's 63 bytes), so two
runs at the same time do not delete each other's data. With `--keepdb` (it has
no short form; `-k` selects tests by name) the one shared name
`test_<POSTGRES_DB>` is used, so the database can be found again; do not run two
`--keepdb` runs at once (that shared name is not cut, so a very long
`POSTGRES_DB` is refused by Django under `--keepdb`). A run that is killed leaves its database behind. List
them with
`psql -h 127.0.0.1 -p <POSTGRES_PORT> -U <POSTGRES_USER> -d postgres -c "\l test_*"`
and drop the old ones with `DROP DATABASE <name>;`.

## Run the frontend

Needs Node.js 22.22.2 or newer on the 22 line, or 24.15+ (the minimum jsdom
declares; it runs the frontend tests).

```bash
cd frontend
npm ci
cp .env.example .env.local    # BACKEND_URL: where /api/* is forwarded
npm run dev
```

Open `http://localhost:3000` and sign in at `/login`. The browser only talks to
the frontend: Next.js forwards `/api/*` to the backend, so the session cookie
stays on one origin. Checks: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`.

### Design system

The look is the owner's design example (an Azerbaijani ledger: deep navy,
pomegranate red as the one action colour, saffron as the accent, carpet-diamond
strips as seams; the folder `sual-cavab-design/` has the full spec in
`DESIGN.md`). Styling is Tailwind CSS 4 (build-time CSS, no runtime code). The
colours are tokens in `frontend/app/globals.css`, in oklch and with the
example's names (`bg-card`, `text-muted-foreground`, `bg-navy`, `text-saffron`,
`bg-status-open`, ...); a component never writes a colour. The three fonts are
Fraunces (headings), Manrope (text) and JetBrains Mono (ids, counts), through
`next/font`, self-hosted at build time (the build needs network access once to
fetch them). Shared pieces are in `frontend/components/ui/`: `Button` (the
example's `btn-primary`, `btn-ghost`, and `btn-danger` for dropping a question),
`Field` with `Input`, `Textarea` and `Select`, `StatusChip` (a dot and the word),
`Card`, `Alert` and `PageShell`. The four statuses have ONE table of words and
dot colours, `frontend/lib/status.ts`. A new screen uses these instead of inline
`style={{ }}`.

- Text colours are at 4.5:1 contrast or more, borders of controls and focus
  rings at 3:1 or more; `app/design-tokens.test.ts` converts the oklch values and
  checks that again from `globals.css`, and refuses a hardcoded colour or an
  inline style in a component.
- Where this differs from the example, on purpose: an extra token,
  `control-border`, because the hairline `border` is 1.47:1 against a card and too
  faint for an input; the focus ring is saffron on the navy surfaces (red is 2.7:1
  there); errors use the pomegranate red as emphasis and `--destructive` is kept
  for dropping a question; the amber "asked" dot is 2.6:1 on a card, so the word
  always sits beside it; status words are plain small text as in the screenshots
  (the example's rule file says monospace, its screenshots do not).
- **There is no dark theme**: the example has none, so the app no longer follows
  the system's dark setting (`color-scheme` is light).
- **Manrope has no capital Ə (U+018F)**, checked in the built font files; Fraunces
  and JetBrains Mono have every Azerbaijani letter tested. A capital Ə in body
  text falls back to the next font in the stack.
- Tailwind's reset ("preflight") is deliberately not imported: it changes every
  element that has no class (headings, lists, form controls), and no one has yet
  looked at every screen in a browser. The components set their own font, border
  and `list-none` instead. Add the reset only after a click-through (#32).
- Keep your own base CSS inside `@layer base`; unlayered CSS beats every
  utility class.

#### What was invented where the example shows nothing (#72)

The example has a landing page and a workspace. For the rest I designed in the
same language, inside its rules; each item is a choice the owner can reject:

- **Sign-in** (`/login`): a navy lattice page with the wordmark, and the form on a
  cream card topped by a carpet strip, with the eyebrow "Access".
- **Header band** (`components/ui/AppHeader.tsx`): the landing header made
  reusable (wordmark, session actions, eyebrow, title, a sentence, carpet seam);
  the projects page uses it.
- **Projects** (`/projects`): numbered ledger lines (`01`, `02`, in red monospace),
  the name in the serif, the client and "N still open" under it, and a saffron
  count chip for a project that is still waiting (the example's rail does the
  same). The new-project form is a card under a carpet strip.
- **Empty and missing things** (no projects, no questions, nothing open, project
  not found, signed out): a card under a carpet strip with one sentence that says
  what to do next (`EmptyState`).
- **Loading**: the words that say what is loading, and three ledger rows that
  pulse (`motion-safe:`: still when the person asks for less motion), instead of
  a spinner (`LedgerLoading`).
- **404**: "This page is not in the ledger." and the missing page as question
  `Q404`.

## Who can see or change a project

Decided by the owner (#5). Access is checked in the query itself, so a project
you are not on is a 404, the same as one that does not exist.

| Action                              | Owner | Member | Not a member |
|-------------------------------------|-------|--------|--------------|
| See the project and its questions   | yes   | yes    | no (404)     |
| Edit name, client, description      | yes   | yes    | no (404)     |
| Add or remove members               | yes   | no     | no (404)     |
| Add, edit and answer questions (#6) | yes   | yes    | no (404)     |
| Delete the project                  | nobody in v1 (there is no delete endpoint) |

- Any signed-in user can create a project and becomes its first owner.
- The last active owner of a project cannot be removed (a deactivated owner
  does not count, because they cannot manage the project).
- Superusers have no special access through the API; they use `/admin/`.
- Owners can only add people who already have an account (an admin creates
  accounts). Because anyone can create a project and so become an owner, a
  signed-in user can tell whether an email has an account by trying to add it.
  Accepted for v1 (small, admin-created user base); attempts are limited to
  about 30 an hour per user, failures included (a burst of parallel requests
  can slightly exceed it).

## Questions, statuses and answers

Questions belong to a project and are numbered Q1, Q2... per project. A number
is never reused, even if the question is dropped. Any member of the project
(owner or member) can add, edit, change the status of and answer questions;
everyone else gets a 404. API: `/api/projects/<id>/questions/`
(`?status=open,asked` filters), `…/<number>/` to read or edit the text fields,
and `POST …/<number>/transition/` with `{"to": "<status>"}` to change status.

Decided by the owner (#6). Anything not listed is refused with a 400 that names
what is allowed:

| From       | Can become                                   |
|------------|----------------------------------------------|
| `open`     | `asked`, `answered` (with an answer), `dropped` |
| `asked`    | `open` (un-ask), `answered` (with an answer), `dropped` |
| `answered` | `open` (re-open)                              |
| `dropped`  | `open` (restore)                              |

- Marking a question `answered` needs an answer: the text, who answered (free
  text, since the client contact may not be a user), the date, and where
  (chat, meeting, email or other, with an optional note). The user who recorded
  it is saved too.
- Answers are never edited or deleted. Re-opening a question keeps its answer
  as history (`previous_answers`); answering again adds a new one. To correct
  an answer, re-open and answer again.
- Nothing is deleted by the app: there is no delete endpoint ("dropped" is a
  status). In the admin, questions can't be added or deleted, only their three
  text fields can be edited (status moves only through the rules above), and a
  project or user with questions or answers depending on it can't be deleted.
- Edits write only the fields that were sent, so an edit racing an answer or a
  re-open can't write back an old status.
- Editing a question's text overwrites the previous text (there is no edit
  history in v1).

### Still open

The project page lists what the project is waiting on: questions in status
**open** or **asked**, each with its number, text, what it blocks and how long
it has been open. The age counts from when the question was created; re-opening
a question does not reset it. The project list shows the same count
(`open_question_count`, computed in the database from the same two statuses).

### Question screens

`/projects/<id>/questions` lists every question (any status) and is where people
add a question, edit its three text fields, change its status and record an
answer (text, who answered, date, chat/meeting/email/other, optional note).
Only the status buttons the transition table allows are offered; the server
still decides, and its message is shown if it refuses. Validation errors from
the API appear next to the field. Re-opening an answered question keeps the old
answer, shown as "Earlier answer".

## Drafting a message (Claude)

`/projects/<id>/draft`: pick open or asked questions (up to 10) and get a
**draft** message, in Azerbaijani with technical terms kept in English, as text
in a box you can edit and copy. **The app never sends anything**: there is no
email or chat integration, and a test fails if a module of the drafting package
imports anything that can send (mail, sockets, HTTP clients; the Claude SDK is
allowed in one file only).
Nothing is stored: close the page and the draft is gone.

**What goes to the Claude API** (owner's decision on #9): for each selected
question its number, the question text, "why it matters" and "what it blocks",
each cut at 1,500 characters. Never the project or client name, anyone's name or
email, answers, statuses, dates or ids. Question text can still contain names if
someone typed them there, so keep client details out of it, or ask Anthropic for
zero data retention for your organization. The screen says what is sent.

Who may use it: any member of the project (same rule as questions). Limits: 20
drafts per user per hour (`DJANGO_DRAFT_RATE`), 30-second timeout, one retry (only for a timeout, a dropped
connection, a 408/409/429 or a 5xx, and only if the server asks for a wait of 5 s or less).

Set up (see `backend/.env.example`):

- `ANTHROPIC_API_KEY`: from the environment of the server only, never in code,
  logs or the browser. **Without it the draft button answers "not set up"
  (503) and nothing else changes.**
- `DRAFTING_MODEL`: defaults to `claude-sonnet-5-5`. **The server refuses to
  start** if it names a Claude Fable or Claude Mythos model: Anthropic keeps
  prompts and outputs of those for at least 30 days and offers no zero data
  retention, and the owner decided drafting must not use them.
- If Claude fails (timeout, rate limit, refusal, empty or cut-off answer) the
  person sees "The draft could not be written. Try again in a minute." Nothing
  the API sent back is shown or logged; the `drafting` log lines hold counts and
  error class names, and `ANTHROPIC_LOG=debug` (which would log request bodies)
  makes the server refuse to start. The API address is fixed in code, so an
  `ANTHROPIC_BASE_URL` in the environment is ignored.

Not checked by any test: a real call to the API (tests use a fake client). The
first real draft has to be made by hand once the key is set.

## Staging on Render

A staging site for looking at the app with **invented demo data**. It is
described by `render.yaml` (the API, the frontend and a PostgreSQL 17 database,
all on Render's free plan, in Frankfurt) and deploys from the `staging` branch.

**Never put real client questions, names or messages on it.** The free database
has no backups and is deleted 30 days after it is created.

### First deploy (once; needs a Render account, so the owner does it)

1. In Render: **New > Blueprint**, connect this GitHub repository, choose the
   `staging` branch. Render reads `render.yaml` and asks for three values:
   - `DEMO_PASSWORD`: the shared password of the demo accounts. Choose one with
     12 or more characters. It is stored only in Render.
   - `DJANGO_CSRF_TRUSTED_ORIGINS`: the frontend's address, normally
     `https://sual-cavab-web.onrender.com`.
   - `BACKEND_URL`: the API's address, normally
     `https://sual-cavab-api.onrender.com`.
2. If Render shows different addresses for the two services (a name was taken),
   correct those two values in each service's **Environment** tab and deploy
   **both** again. `BACKEND_URL` is read when the frontend is built.
3. The first request to a sleeping free service takes about a minute.
4. Check it from your machine (needs only Python):

   ```bash
   SMOKE_PASSWORD=<the DEMO_PASSWORD> python scripts/smoke_test.py https://sual-cavab-web.onrender.com
   ```

   It looks for the demo projects by their original names ("Demo: Ticketing
   platform", "Demo: Booking portal"): if a visitor renamed one, that check
   fails and says so. It signs in with the demo accounts and checks the health endpoint, sign-in,
   the still-open view and counts, and that someone who is on no project sees
   none. It creates no questions or projects, but a run does leave traces: two
   sessions, updated "last login" times, and sign-in attempts counted against
   the demo owner (one is a deliberate wrong password), so run it a few times
   at most within a minute or its own sign-ins hit the limit. It exits non-zero
   if anything fails. Set the password without leaving it in your shell
   history: `read -rs SMOKE_PASSWORD && export SMOKE_PASSWORD`.

### What is on it

- Sign in with `demo.owner@example.invalid` or `demo.member@example.invalid`
  (the shared `DEMO_PASSWORD`); `demo.outsider@example.invalid` is on no project.
- Two demo projects with questions in every status, and one answer that was
  corrected after a re-open. Restarting the API runs `load_demo_data` again;
  once the demo owner has a project it changes nothing, so renaming or adding
  projects on staging is safe. It refuses a database that holds a project not
  created by a demo account, and a refusal does not stop the API from starting
  (the start command carries on without demo data). `DEMO_PASSWORD` must be
  12+ characters and pass Django's password checks (not all digits, not a
  common password).
- Drafting is **off** until you add `ANTHROPIC_API_KEY` in the API service's
  Environment tab; without it the draft button says "not set up". A real draft
  there sends the demo question text to the Claude API, as anywhere else.

### Things to know (Render's free plan, from its documentation)

- **Services sleep** after 15 minutes without traffic and restart at will.
  Everything the API needs is done in its start command (`migrate`,
  `createcachetable`, `load_demo_data`), because free instances have no shell.
- **The database expires 30 days after creation**, with 14 days to upgrade, then
  it and its data are deleted. To renew: delete the database resource, then sync
  the Blueprint (Render recreates it); the API restarts, migrates and reloads
  the demo data. Not tested.
- **A drafting reply can take up to about 135 seconds.** Render's documentation
  states no limit on request duration, so whether a free instance allows it is
  untested.
- The API's own address is public (free services cannot receive private
  traffic); it answers only what the app's rules allow. Django's admin is
  **switched off** on it (`DJANGO_ADMIN_ENABLED=0`), because the admin's
  sign-in page has no rate limit; the app's own sign-in is limited per account.
  The demo account names are public, so anyone can keep one of them locked out
  by failing to sign in to it about ten times a minute (the limit counts every
  attempt); that is the accepted per-account design from #4, and it would make
  the smoke test fail.
- Anyone with the demo password can create projects and, once a Claude key is
  set, make paid drafting calls (20 an hour per demo account). Choose a
  password you do not use anywhere else and change it in Render if it leaks.
- Not known: which Host header Render's health check sends. If the first
  deploy fails its health check with a 400, add that host to
  `DJANGO_ALLOWED_HOSTS`. The health endpoint does not touch the database.
- Python is Render's default (3.14.x); Node is pinned to 22.22.2, as in CI.

## Built with claude-harness

This project is built with [claude-harness](https://github.com/rmusayevr/claude-harness):
work goes through GitHub issues, every PR is reviewed by a second Claude with
fresh eyes, and safety guards stop risky commands. It is also the harness's
first real end-to-end test.

## License

MIT. See [LICENSE](./LICENSE).
