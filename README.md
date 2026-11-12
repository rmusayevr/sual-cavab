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

### What was tested, and what was not

This says only what has been run (#43). "Not run" is not "does not work": it is "nobody has looked".

| | Run | Not run |
| --- | --- | --- |
| **Python** | 3.14 (CI, and the author's machine) | 3.12 and 3.13. Django 6.1 itself supports 3.12 and newer, so the code is written for that, but nothing here has run on it. The Python Render uses was never read from the service (`render.yaml` sets none; Render's default was assumed to be 3.14.x). |
| **Node.js** | A current Node 22 chosen by the CI runner (`node-version: "22"`, no exact pin); 22.20.0 on the author's machine (lint, typecheck, the tests and the build: PRs #14, #62, #74, #76, #82); 22.22.2 on Render, where `npm ci`, `next build` and `next start` ran and the site served the sign-in page and proxied the API (the smoke test of #10) | Lint, typecheck and the tests on 22.22.2 itself, and Node 24 and 26. |
| **PostgreSQL** | 17: the Compose file, CI, and Render's managed database (`postgresMajorVersion: "17"`), which the smoke test of #10 ran against | Any other major version. |
| **Operating system** | Ubuntu (CI: the backend and frontend checks, with PostgreSQL as a service container, not Compose; and Render's Linux) and Windows (the author's machine: everything, including Compose on Docker Desktop) | macOS, and Linux on a desktop. |
| **Docker Compose file** | Windows with Docker Desktop | Linux, macOS, and a Docker without IPv6 (the file binds `[::1]` as well as `127.0.0.1`; see the note under [Local setup](#local-setup)). |
| **Browsers** | Some screens, in English only, in a headless Edge against the production build with a mock API and invented data: the landing, sign-in, projects and 404 pages and the workspace as first built (#74, #76, #79) | Everything added after that (the forms in the workspace, members, how long a question has been open, the kept answer), every screen in Azerbaijani, and the real staging site: nobody has clicked through the screens (#10, #32). |

The version numbers below are what the tools and packages declare or what CI uses, not a promise that every version in the range has been tried.

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

Written for Python 3.12 or newer (Django 6.1's own minimum) and a PostgreSQL you can
create databases on (see [Local setup](#local-setup)). **Only Python 3.14 has been run**
(see [What was tested](#what-was-tested-and-what-was-not)).

```bash
cd backend
python -m venv .venv
source .venv/bin/activate     # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env          # then set the POSTGRES_* values for your database
python manage.py migrate
python manage.py createcachetable  # sign-in attempt counters live in PostgreSQL (`python manage.py check --database default` warns if the table is missing)
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

jsdom, which runs the frontend tests, declares Node `^22.22.2 || ^24.15.0 || >=26`. CI uses a
current Node 22 (chosen by the runner) and Render is pinned to 22.22.2; the author's machine has 22.20.0, below that
declared minimum: npm warns, and lint, typecheck, the tests and the build passed there (PRs #14, #62, #74, #76, #82). So the
declared minimum is not a hard floor in practice, but only these have been run (see
[What was tested](#what-was-tested-and-what-was-not)).

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
strips as seams; the repo's `DESIGN.md` has the full spec). Styling is Tailwind CSS 4 (build-time CSS, no runtime code). The
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
  The "Sign in" button on the projects and project screens opens `/login?next=<that page>`, and after a
  successful sign-in the person goes back to it (#96). `next` is used only if it is a path inside the app
  (`frontend/lib/safeNext.ts`: no `https://...`, `//host`, backslash or control character, and never `/login`
  itself); anything else, or no `next`, goes to `/` as before. The landing page's own Sign in button is unchanged.
  Tested with the component tests; not tried in a browser against the real backend.
- **Header band** (`components/ui/AppHeader.tsx`): the landing header made
  reusable (wordmark, session actions, eyebrow, title, a sentence, carpet seam);
  the projects page uses it.
- **Projects** (`/projects`): numbered ledger lines (`01`, `02`, in red monospace),
  the name in the serif, the client and "N still open" under it, and a saffron
  count chip for a project that is still waiting (the example's rail does the
  same). The names are level-2 headings. The new-project form is a card with a
  saffron rule on top (the page already has its one carpet strip, the header's).
- **Empty and missing things** (no projects, no questions, nothing open, project
  not found, signed out): a card under a carpet strip with one sentence that says
  what to do next (`EmptyState`). The example allows one carpet strip per screen,
  so a page that has a header seam (the projects page) leaves the strip out.
- **Loading**: the words that say what is loading, and three ledger rows that
  pulse (`motion-safe:`: still when the person asks for less motion), instead of
  a spinner (`LedgerLoading`).
- **404**: "This page is not in the ledger." and the missing page as question
  `Q404`.

### Cleaning the sign-in counters (`purge_expired_cache`)

The sign-in, member-add and drafting counters live in a database table (`throttle_cache`). Django only
removes expired rows once that table passes a million, so until then they pile up and every write counts
the table (#40). `python manage.py purge_expired_cache` removes the expired ones:

```bash
python manage.py purge_expired_cache --dry-run   # count them; delete nothing
python manage.py purge_expired_cache             # delete them, in batches of 1000, at most 100 batches
```

It prints, for each database cache, how many rows it removed, in how many batches and how long it took (a
run that removed 0 is normal), and says when it stopped at `--max-batches` with rows left: run it again.

**How it runs (the owner's choice on #40):** Render's free tier has no cron, so the start command in
`render.yaml` runs it at every start, after `createcachetable` and before the server: a free service
restarts when it wakes (Render's documentation says an idle free service spins down and starts again on the
next request; that was not tested here), so that is each deploy and, if so, each wake-up. It is wrapped in `( ... || echo ...)`, like
the demo loader: a failed purge never keeps the site down.
- **Overlap:** two starts at once are harmless: it deletes only rows that are expired, picked by key, and a
  counter renewed while it runs is kept (it looks at the row again once the lock is free; tested with a real lock).
- **Missed runs:** nothing is lost; it looks for what is expired now, so any gap is caught up on the next run.
- **Not running at all:** nothing alerts on that (no scheduler or monitor on the free tier). The consequence
  is the table growing slowly, as it did before this command; `--dry-run` shows how many rows are waiting.
- A service that never sleeps (a paid plan) restarts rarely, so it would need a real schedule: a Render cron
  job running this command daily.

### A known `npm audit` finding (accepted, 2026-11-10: #50)

`npm audit` in `frontend/` reports **7 moderate** findings: one advisory,
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) (a denial of service in
`minimatch` `>=7.0.0 <11.0.1`, from a glob pattern an attacker controls), reported for `minimatch` itself (10.2.6
here) and for the six packages that depend on it: `typescript-eslint` and its `typescript-estree`, `parser`,
`utils`, `type-utils` and `eslint-plugin`. `eslint-config-next` 16.4.3 pulls them in (it is the root and is not
itself reported). **It is accepted, not fixed**, for these reasons (checked on 2026-11-10, by hand and by an
independent review that also read the code and tried the alternatives):

- **Development tooling only.** `npm audit --omit=dev` reports 0 and `minimatch` is not in npm's production
  dependency tree. (Next.js bundles its own copies of some libraries inside `next/dist/compiled`, including a
  `minimatch` in `@vercel/nft`, which `npm audit` cannot see; it traces files during `next build` from our own
  code and config, and it was not found in the built output.)
- **The vulnerable code cannot be reached here, for three independent reasons.** (1) `typescript-estree` calls
  `minimatch` in one place, to match `allowDefaultProject` patterns, and neither `frontend/eslint.config.mjs` nor
  the `eslint-config-next` presets set `allowDefaultProject` or `projectService`. (2) The advisory is in
  `firstPhasePreProcess()` "when `optimizationLevel >= 2`"; `minimatch` defaults to 1 and `typescript-estree`
  passes only `{ dot: true }`. (3) The amplification needs a `**/../` pattern, and `typescript-eslint` refuses an
  `allowDefaultProject` glob that contains `**`.
- **The fix exists upstream; only its age is in the way.** `typescript-eslint` 8.72.3-alpha.1 to alpha.7 (canary,
  published 2026-11-10) depend on `minimatch ^11.0.1`. The newest stable, 8.72.2 (2026-11-09), still depends on
  `^10.2.2`, and nothing is two weeks old yet.
- **`npm audit fix` does not help**, although `npm audit` prints "fix available": a dry run still reported 7.
- **An npm `overrides` entry would work** (scoped: `"@typescript-eslint/typescript-estree": { "minimatch":
  "11.0.1" }`; the review's trial cleared the audit and ESLint ran, with the code path forced both to match and not
  to match), and it is the lever for a clean `npm audit` before the stable release. It was not done: for a
  finding that cannot be triggered here it adds an entry that must be removed later, and the stable fix is
  expected within days to weeks. The owner can ask for it. (`minimatch` 11.0.1 was published 2026-10-27, so it
  passes the two-week rule from the evening of 2026-11-10.)

**Revisit when** `npm view @typescript-eslint/typescript-estree dependencies.minimatch` prints `^11.0.1` or
newer for the `latest` release: then, once that release is at least two weeks old (check it with the
`review-a-dependency` skill), run `npm update typescript-eslint` in `frontend/` (it is not a direct dependency:
the lockfile re-resolves it under `eslint-config-next`, which allows `typescript-eslint ^8.56.0` and needs no
update), and delete this section. Anything `npm audit --omit=dev` reports would be a different matter: it would be
in the built app.

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
- **Adding and removing members from the screen (#33).** On the project page an owner sees a **Manage members**
  section: the members with a Remove button (asks "Remove ... from this project?" first), and a form with an
  email and a role (member or owner). An owner who wants to hand a project over adds the new owner here before
  leaving. A member does not see the section, and the API still refuses them (403). Messages from the server
  (unknown email, already a member, "a project needs at least one active owner", the 30-an-hour limit) show next
  to the field or above the form in the server's words, which stay English. After a change the list is read again
  from the server; an owner who removes themselves is asked a different question ("Remove yourself... an owner will have to add you again") and is then taken to the projects list. Changing a member's role in
  place, and showing who is deactivated, are not built (the API has neither). Tested with the API mocked
  (`MembersPanel.test.tsx`) and against the server's real rules in the backend tests; not tried in a browser.
- **The project list comes in pages of 25** (#49), by name then id. `GET /api/projects/?page=2` answers
  `{count, page, page_size, results}`; the page size cannot be chosen, and a page number that does not exist is a 404 (DRF also accepts `?page=last`).
  The projects screen shows "Showing 25 of 30" and a **Show more** button. The project screen asks for its own
  project (`/api/projects/<id>/`, a 404 means not found; `/projects/05` is project 5) and its side rail shows the first page, plus the open
  project if it is further down, with an "All projects" link. "Show more" uses page numbers, so if projects are removed or renamed while the list is open, one can be missed until the page is reloaded. Who sees what is unchanged. Tested with 30
  projects in the backend and with the screens' mocks; not tried with hundreds of real projects or in a browser.
- The last active owner of a project cannot be removed (a deactivated owner
  does not count, because they cannot manage the project).
- Superusers have no special access through the API; they use `/admin/`.
- Owners can only add people who already have an account (an admin creates
  accounts). Because anyone can create a project and so become an owner, a
  signed-in user can tell whether an email has an account by trying to add it.
  Accepted for v1 (small, admin-created user base); attempts are limited to
  30 an hour per user, failures included. The count is exact even when requests
  arrive at the same moment (#41: each account's or user's check takes a PostgreSQL
  advisory lock for a few milliseconds, so parallel requests take turns; tested with
  real threads, and the same for sign-in and drafting).

### When someone leaves: deactivate, do not delete (#39)

The supported way to offboard a person is to untick **Active** on their account in `/admin/` (Accounts, Users, the
person, Save). The owner's decision on #39: nothing else is built, and the access rules above do not change.

- They are signed out on their next request (an open session gets a 403) and cannot sign back in (the same
  "Email or password is incorrect" as a wrong password). The project is gone from their view. In the app they may
  be told to sign in, which they cannot do: that is the end of access, not a fault. It also ends their `/admin/`
  access if they were staff.
- **Nothing they wrote is lost**: the projects they created, the questions they wrote and the answers they
  recorded stay as they were, and the other members still see all of it. In the app only an answer shows who
  recorded it (their email); who created a project or a question is kept in the database and `/admin/`.
- **Deleting the account is refused**, on purpose: any one of a project they created (`Project.created_by`), a
  question they wrote (`Question.created_by`) or an answer they recorded (`Answer.recorded_by`) is enough, and
  each is `PROTECT`. There is no tool to reassign the creator (not built: deactivation is enough).
  Deleting someone who wrote none of these does work, but prefer deactivating anyway: it deletes their
  memberships (which can leave a project with no owner at all) and, for a staff user, their `/admin/` history.
- **A project's only owner: hand it over before deactivating.** A deactivated owner cannot manage the project,
  and the app has no way to change a member's role or to see who is deactivated (the members list still shows
  them as owner). So before you deactivate the only owner, either have them make someone else an owner (remove
  the person, add them again with the owner role: the add-member API takes a role; whether the screens offer it was not checked), or change the role yourself in `/admin/` (Projects, the project,
  Memberships). The second route has not been tried by hand.
- **Ticking Active again gives everything back, including old sessions**: deactivating does not delete a
  person's open sessions, so a browser they were signed in on works again at once. If the account goes to
  someone else, or after a dispute, change the password first (Django ends old sessions when it changes; this
  was not run here).

Tested in `backend/projects/test_offboarding.py` (a signed-in user loses access, cannot sign back in, nothing is
lost and the recorder is still named, deletion is refused for each kind of record on its own, reactivation
restores access). Not tried in `/admin/` by hand.

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

The workspace (`/projects/<id>`) shows what the project is waiting on: the
counts of questions in each status, and every question with its number, status
and text; a question in status **open** or **asked** also says how long it has
been open (what it blocks is on the selected question). The age counts from when
the question was created; re-opening a question does not reset it. The project
list shows the same count of open questions (`open_question_count`, computed in
the database from the same two statuses).

### Question screens

In the workspace (`/projects/<id>`; the older `/questions` address redirects to
it) the list shows every question (any status, with a filter by status), and the
panel on the right is where people add a question, edit its three text fields,
change its status and record an answer (text, who answered, date,
chat/meeting/email/other, optional note).
Only the status buttons the transition table allows are offered; the server
still decides, and its message is shown if it refuses. Validation errors from
the API appear next to the field. If the server refuses an answer because the
question moved while the form was open (a teammate answered or dropped it), the
form stays open with what was typed, the question behind it is reloaded, and the
save button is offered again only if the question, as far as the page knows
(it could not be reloaded, say), can still be answered (if not, the text stays so
it can be copied; the hint says the answer was not saved). Re-opening an answered question keeps the old
answer, shown as "Earlier answer".

## Drafting a message (Claude)

In the workspace (`/projects/<id>`; the older `/draft`, `/questions` and `/overview` addresses redirect to it): pick open or asked questions (up to 10) and get a
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

## Language (English, Azerbaijani)

The interface is English by default, with Azerbaijani as a second language (#71). An `EN | AZ` switch sits in the headers of the landing, sign-in, projects and workspace pages and at the top of the older pages; the choice is kept in the browser's local storage. `<html lang>` follows the choice on every page.

- **Where the words live:** `frontend/lib/i18n/en.ts` (the master list of keys) and `az.ts` (same keys; a missing one is a compile error and a test failure). No library. Use `useT()` in a client component, or `<T k="..." />` in a server page. `{name}` in a text is filled in at run time.
- **First paint is always English**: the server cannot know the choice, and the markup must match. A person who chose Azerbaijani sees it as soon as the page has loaded, after a brief English flash (accepted for v1).
- **Never translated:** what a person typed (questions, answers) and the drafted message. The draft prompt already asks for Azerbaijani.
- **Status words** come from the dictionaries (`status.open` and so on), one set per language, next to the one table of colours (`lib/status.ts`). They follow the language on every page, including pages whose other words are still English.
- **The Azerbaijani wording was first written by Claude, not by a native speaker; the owner reviewed and changed it on 2026-11-10** (for example `Ləğv olunub` for a dropped question and `sahib` for an owner). Technical terms stay in English.
- **Translated:** the landing page, the sign-in page and form, the projects page and its list and new-project form, the workspace (`/projects/[id]`: shell, members, how long a question has been open, question card, add and edit forms, answer form, draft panel and its error messages), the 404, the session status in every header, the home link's name, the status words and the waking-up note. The landing page's sample questions stay in English (a question is the ledger entry and is never translated, as in the design example) and its sample message is already Azerbaijani (as the drafting feature writes it); both are shown the same in both languages. **Still English** (things that cannot follow a browser choice): the page titles and social-card text (they are fixed when the page is built) and any message the server itself sends back (a refused status change, a validation error: shown as the server wrote it).

## Staging on Render

A staging site for looking at the app with **invented demo data**. It is
described by `render.yaml` (the API, the frontend and a PostgreSQL 17 database,
all on Render's free plan, in Frankfurt) and deploys from the `staging` branch.

**Never put real client questions, names or messages on it.** The free database
has no backups and is deleted 30 days after it is created (to keep the data longer,
see "Using Supabase for the database instead of Render's" below).

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
3. The first request to a sleeping free service takes a minute or two (measured below).
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

### Using Supabase for the database instead of Render's

Render's free database is deleted after 30 days (see below). Supabase's free PostgreSQL is not deleted, but it **pauses**
after about a week with little activity and has **no backups** on the free plan. The app only needs plain PostgreSQL, so the
only thing that changes is `DJANGO_DATABASE_URL`; there is no code change. This is a procedure for the owner (it needs
the Supabase and Render accounts); nothing here has been done on Render yet.

**Do this once**

1. In Supabase: **New project**. Region **Frankfurt (eu-central-1)**, the same region as Render. Generate a database password
   of letters and digits only (anything else must be percent-encoded in the URL). Under **Security**, turn **Enable Data API
   off** (and leave "automatically expose new tables" and "automatic RLS" off): Django keeps all its tables, including the
   users table, in the `public` schema, and the Data API would put them behind a public REST endpoint. The app does not
   use it.
2. Wait until the project is ready. A new project took about **7 minutes** before the pooler accepted connections
   (the first attempts answered `tenant/user ... not found`, which is not a password error).
3. **Connect**, then **Session pooler**: host `aws-N-<region>.pooler.supabase.com`, port **5432**, user
   `postgres.<project-ref>`. Use this one, not the others:
   - *Direct connection*: IPv6 only on the free plan; whether Render's free services can reach IPv6 was not checked.
   - *Transaction pooler* (port 6543): no session-level state, no prepared statements. The app's request limits take a
     **transaction-level** advisory lock (`core/throttles.py`), which the Supabase documentation says works there, but this
     was not tested; the session pooler was.
4. Build the URL: `postgresql://postgres.<project-ref>:<password>@<pooler host>:5432/postgres?sslmode=require`
   (`sslmode` is the only option `config/dburl.py` accepts).
5. In Render, on the API service, **Environment**: set `DJANGO_DATABASE_URL` to that URL and save; the service redeploys, and
   its start command migrates, creates the cache table, purges expired counters and loads the demo data. `render.yaml`
   marks the variable `sync: false`, so a later Blueprint sync leaves your value alone (Render's documentation says
   `sync: false` variables are ignored after the first creation; not tested here).
6. Run the smoke test (`scripts/smoke_test.py`, usage in its header) against the frontend's address.
7. Only after that works: delete the old database in Render by hand. `render.yaml` still has its `databases:` block, on
   purpose: Render's documentation does not say what removing a block does, so it is removed in a later change, after the
   database is gone.

**Things to know**

- **15 connections at once.** On the project this was tried on, the session pooler allowed 15 clients (`EMAXCONNSESSION ...
  pool_size: 15`). The API (one worker, four threads) needs a few. The burst tests in `core/test_exact_throttles.py` open
  25 to 45 connections and fail against it for that reason, not because the counting is wrong.
- **Never put this URL in `backend/.env`.** While `DJANGO_DATABASE_URL` is set, every local run and every test goes to
  that database. The tests create and drop their own `test_*` databases there (a teardown error left three behind in one
  trial), and some assume the local database. Local work and the tests use the Docker database.
- **Pausing.** A free project is paused after about a week without enough database activity (a few requests a day usually
  keep it awake; opening it in the dashboard counts). Supabase emails a warning about a week before. A paused project is
  restored from the dashboard (the documentation says up to a year after pausing); until then the API's database calls
  fail. A Render service that sleeps makes no requests, so a quiet week pauses the database. No keep-alive is built.
- **Limits and backups (free plan).** 500 MB per project; 5 GB of egress for the organization; the dashboard showed "No
  backups". The rule above still holds: invented demo data only.

**What was checked** (on the Supabase project itself, from a developer machine, not from Render): the URL is read as
intended; `migrate` and `createcachetable` ran; `manage.py check --database default` was clean; a 12-way simultaneous
burst of sign-in checks let exactly 4 through against a limit of 4 (12 without the lock); the backend suite ran against it
with 371 of 380 tests passing. The nine that failed are the five connection-count tests above, three that test how
`POSTGRES_*` is read while a URL is set (the URL wins, as designed), and one that sends 400 requests after a one-minute
lock and takes about 90 seconds over the internet, so the lock had expired (it passes with an hourly window).
**Not checked:** a deploy on Render with this database, the transaction pooler, the direct connection, a pause and a
restore, behaviour under real traffic.

### Things to know (Render's free plan, from its documentation)

- **Services sleep** after 15 minutes without traffic and restart at will.
  **Measured** on 2026-11-09, three samples each after 20 idle minutes: the first
  request took 82.6, 92.3 and 92.5 s on the API and 33.2, 33.1 and 33.3 s on the
  web service; a warm request 0.1 s. The services wake one after the other, so a
  visitor to a fully asleep site may wait about two minutes (not measured end to
  end). The app says so after five seconds of waiting (`WakingNote`).
  Everything the API needs is done in its start command (`migrate`,
  `createcachetable`, `purge_expired_cache`, `load_demo_data`), because free instances have no shell.
- **The database expires 30 days after creation**, with 14 days to upgrade, then
  it and its data are deleted. To renew: delete the database resource, then sync
  the Blueprint (Render recreates it); the API restarts, migrates and reloads
  the demo data. Not tested.
- **A drafting reply can take up to about 135 seconds.** Render's documentation
  states no limit on request duration, so whether a free instance allows it is
  untested.
- The API's own address is public (free services cannot receive private
  traffic); it answers only what the app's rules allow. Django's admin is
  **switched off** on it (`DJANGO_ADMIN_ENABLED=0`): a public host has no need of it. Its sign-in page is
  limited all the same (#45): it shares the app's attempt counter, ten a minute per account, so guessing at
  `/admin/` is not a second budget; a sixth guess there after five at the app's sign-in counts as the sixth.
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
- Python is Render's default (3.14.x); Node is pinned to 22.22.2 (CI has no exact pin: it asks for Node 22 and takes what the runner provides).

## Built with claude-harness

This project is built with [claude-harness](https://github.com/rmusayevr/claude-harness):
work goes through GitHub issues, every PR is reviewed by a second Claude with
fresh eyes, and safety guards stop risky commands. It is also the harness's
first real end-to-end test.

## License

MIT. See [LICENSE](./LICENSE).
