"""Question status changes: the transitions the owner approved on #6.

    open     -> asked, answered (with an answer), dropped
    asked    -> open (un-ask), answered (with an answer), dropped
    answered -> open (re-open: the answer is kept as history)
    open/asked -> answered again by restore_last_answer(): the most recently replaced answer comes back (#121)
    dropped  -> open (restore)

Anything else is refused. The caller holds a row lock on the question.
"""

from django.utils import timezone

from .models import Answer, Question

S = Question.Status

TRANSITIONS = {
    S.OPEN: {S.ASKED, S.ANSWERED, S.DROPPED},
    S.ASKED: {S.OPEN, S.ANSWERED, S.DROPPED},
    S.ANSWERED: {S.OPEN},
    S.DROPPED: {S.OPEN},
}


class TransitionNotAllowed(Exception):
    def __init__(self, current, to):
        self.current = current
        self.to = to
        self.allowed = sorted(str(s) for s in TRANSITIONS[S(current)])
        super().__init__(f"{current} -> {to}")


def in_app_answer(user, text):
    """An answer typed in the app by `user` (#121): given by them, today, in the app."""
    return {
        "text": text,
        "answered_by": (user.get_full_name() or user.email)[:200],  # the column holds 200; a name can be 301 long
        "answered_on": timezone.localdate(),
        "channel": Answer.Channel.APP,
        "channel_note": "",
    }


class NothingToRestore(Exception):
    """The question is not waiting for an answer, or no earlier answer exists."""


def restore_last_answer(question):
    """Undo a re-open: the most recently replaced answer is the current one again and the question is answered.

    Only for an open or asked question (a dropped one must be restored first) that has an earlier answer. Nothing is
    copied or deleted. The caller holds a row lock on the question, so two restores take turns and the second is refused."""
    if question.status not in (S.OPEN, S.ASKED):
        raise NothingToRestore(f"A {question.status} question has no answer to put back.")
    if question.answers.filter(superseded_at__isnull=True).exists():
        raise NothingToRestore("This question already has an answer.")
    last = question.answers.filter(superseded_at__isnull=False).order_by("-superseded_at", "-id").first()
    if last is None:
        raise NothingToRestore("This question has no earlier answer.")
    last.superseded_at = None
    last.save(update_fields=["superseded_at"])
    question.status = S.ANSWERED
    question.answered_at = timezone.now()
    question.save(update_fields=["status", "answered_at", "updated_at"])
    return question


def change_status(question, to, user, answer=None):
    """Move `question` to `to`; `answer` is a dict with at least the text, required for 'answered'.

    Whatever the dict leaves out (who answered, when, where) is filled in as an answer typed in the app by `user`;
    a caller that knows better (accepting what a client sent through the answer link) says so explicitly."""
    current, to = S(question.status), S(to)
    if to not in TRANSITIONS[current]:
        raise TransitionNotAllowed(current, to)
    if to == S.ANSWERED and not answer:
        raise ValueError("an answer is required to mark a question answered")
    now = timezone.now()

    if current == S.ANSWERED:  # re-opening: keep the answer, mark it superseded
        question.answers.filter(superseded_at__isnull=True).update(superseded_at=now)
    if to == S.ASKED:
        question.asked_at = now
    elif to == S.ANSWERED:
        Answer.objects.create(question=question, recorded_by=user, **{**in_app_answer(user, answer["text"]), **answer})
        question.answered_at = now
    elif to == S.DROPPED:
        question.dropped_at = now

    question.status = to
    question.save(update_fields=["status", "asked_at", "answered_at", "dropped_at", "updated_at"])
    return question
