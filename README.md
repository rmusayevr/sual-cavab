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
python manage.py runserver
```

`GET http://localhost:8000/api/health/` returns `{"status": "ok"}`.
Run the tests with `python manage.py test`. Environment variables already set
in your shell win over `backend/.env`.

## Run the frontend

Needs Node.js 22.22.2 or newer on the 22 line, or 24.15+ (the minimum jsdom
declares; it runs the frontend tests).

```bash
cd frontend
npm ci
cp .env.example .env.local    # NEXT_PUBLIC_API_URL points at the backend
npm run dev
```

Open `http://localhost:3000`. Checks: `npm run lint`, `npm run typecheck`,
`npm test`, `npm run build`.

## Built with claude-harness

This project is built with [claude-harness](https://github.com/rmusayevr/claude-harness):
work goes through GitHub issues, every PR is reviewed by a second Claude with
fresh eyes, and safety guards stop risky commands. It is also the harness's
first real end-to-end test.

## License

MIT. See [LICENSE](./LICENSE).
