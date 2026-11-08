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

## Run the backend

Needs Python 3.12+ and a PostgreSQL you can create databases on.

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
drafts per user per hour (`DJANGO_DRAFT_RATE`), 30-second timeout, one retry.

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

## Built with claude-harness

This project is built with [claude-harness](https://github.com/rmusayevr/claude-harness):
work goes through GitHub issues, every PR is reviewed by a second Claude with
fresh eyes, and safety guards stop risky commands. It is also the harness's
first real end-to-end test.

## License

MIT. See [LICENSE](./LICENSE).
