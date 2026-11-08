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

## Built with claude-harness

This project is built with [claude-harness](https://github.com/rmusayevr/claude-harness):
work goes through GitHub issues, every PR is reviewed by a second Claude with
fresh eyes, and safety guards stop risky commands. It is also the harness's
first real end-to-end test.

## License

MIT. See [LICENSE](./LICENSE).
