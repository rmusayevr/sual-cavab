"""The row locks, proved with real threads on the real database (#34).

How the race is forced: the request that holds a lock stops inside its write
until PostgreSQL itself reports another session of this database waiting for a
lock (`pg_stat_activity`, `wait_event_type = 'Lock'`), and only then goes on. So the second request is
provably blocked at the lock, whatever the speed of the machine. Without the
lock nothing ever blocks, the wait ends at its timeout, both requests go on, and
the bad outcome happens (and the test asserts that something was blocked).

Lock order, from projects/permissions.py: the caller's membership row first,
then the project or question row.
"""

import threading
import time
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import connection, connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from questions.models import Answer, Question
from questions.services import change_status as real_change_status

from .models import Membership, Project

from core.testing import invented_password
PASSWORD = invented_password()
BLOCK_TIMEOUT = 10  # a correct lock blocks the other request at once; this only ends a wait that never comes
JOIN_TIMEOUT = 60


def make_user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


def as_user(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def wait_until_a_session_waits_for_a_lock():
    """Poll PostgreSQL until a session of this database waits for a lock; True if one does.

    Scoped to the current database, so another test run on the same server cannot
    answer for it. Runs on the calling thread's own connection (read-only, inside
    the request's transaction), so it does not disturb the locks it is watching.
    """
    deadline = time.monotonic() + BLOCK_TIMEOUT
    with connection.cursor() as cursor:
        while time.monotonic() < deadline:
            # pg_stat_activity is a snapshot PostgreSQL keeps for the whole transaction; without
            # this the first look is the only look, and a request that starts waiting later is missed.
            cursor.execute("SELECT pg_stat_clear_snapshot()")
            cursor.execute(
                "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
            if cursor.fetchone()[0]:
                return True
            time.sleep(0.02)
    return False


def run_together(*calls):
    """Run each call in its own thread; return their results in call order.

    A call that raised, or a thread still alive after the timeout, fails the test
    here with what happened. (A deadlocked thread can still hold its transaction,
    and the flush at teardown then waits for it; PostgreSQL normally ends a real
    deadlock within about a second with an error, which is reported here.)
    """
    results = [None] * len(calls)
    errors = []

    def run(i, call):
        try:
            results[i] = call()
        except Exception as exc:  # reported below
            errors.append(repr(exc))
        finally:
            connections.close_all()

    threads = [threading.Thread(target=run, args=(i, call), daemon=True) for i, call in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(JOIN_TIMEOUT)
    alive = [t for t in threads if t.is_alive()]
    if alive or errors:
        raise AssertionError(f"{len(alive)} thread(s) still running after {JOIN_TIMEOUT}s; errors: {errors}")
    return results


class RowLockTests(TransactionTestCase):
    def setUp(self):
        self.owner = make_user("owner@example.com")
        self.other = make_user("other@example.com")
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=self.project, user=self.owner, role=Membership.Role.OWNER)

    def add(self, user, role):
        return Membership.objects.create(project=self.project, user=user, role=role)

    def question(self):
        return Question.objects.create(project=self.project, number=1, text="Invented question", created_by=self.owner)

    def test_two_owners_removing_each_other_leave_one_owner(self):
        self.add(self.other, Membership.Role.OWNER)
        real_delete = Membership.delete
        start = threading.Barrier(2)
        was_blocked = []

        def delete_once_the_other_request_waits(membership, *args, **kwargs):
            was_blocked.append(wait_until_a_session_waits_for_a_lock())
            return real_delete(membership, *args, **kwargs)

        def remove(caller, target):
            start.wait(10)
            return as_user(caller).delete(f"/api/projects/{self.project.pk}/members/{target.pk}/").status_code

        with mock.patch.object(Membership, "delete", delete_once_the_other_request_waits):
            codes = run_together(lambda: remove(self.owner, self.other), lambda: remove(self.other, self.owner))

        # One removal wins and the other request was waiting for the lock meanwhile; once it
        # has the rows, its caller is no longer a member, so it is a 404.
        self.assertEqual(was_blocked, [True])
        self.assertEqual(sorted(codes), [204, 404])
        owners = Membership.objects.filter(project=self.project, role=Membership.Role.OWNER)
        self.assertEqual(owners.count(), 1)

    def test_two_answers_at_the_same_moment_record_only_one(self):
        self.add(self.other, Membership.Role.MEMBER)
        question = self.question()
        start = threading.Barrier(2)
        calls, was_blocked, first = [], [], threading.Lock()

        def change_status_once_the_other_request_waits(*args, **kwargs):
            with first:  # only the request that got the question first waits for the other
                calls.append(1)
                is_first = len(calls) == 1
            if is_first:
                was_blocked.append(wait_until_a_session_waits_for_a_lock())
            return real_change_status(*args, **kwargs)

        def answer(caller):
            start.wait(10)
            body = {
                "to": "answered",
                "answer": {
                    "text": "Refunds are allowed within 14 days.",
                    "answered_by": "Invented Contact",
                    "answered_on": timezone.localdate().isoformat(),
                    "channel": "email",
                },
            }
            url = f"/api/projects/{self.project.pk}/questions/{question.number}/transition/"
            return as_user(caller).post(url, body, format="json").status_code

        with mock.patch("questions.views.change_status", change_status_once_the_other_request_waits):
            codes = run_together(lambda: answer(self.owner), lambda: answer(self.other))

        # The second sees an answered question: answered -> answered is refused (400). Without the
        # question lock both pass that check, and the second insert hits the database's
        # one-current-answer constraint: the data stays safe, but the request errors instead of
        # getting this clean refusal (the test then fails on the error).
        self.assertEqual(was_blocked, [True])
        self.assertEqual(sorted(codes), [200, 400])
        self.assertEqual(Answer.objects.filter(question=question).count(), 1)

    def test_a_member_removed_a_moment_ago_cannot_make_one_more_change(self):
        self.add(self.other, Membership.Role.MEMBER)
        question = self.question()
        real_delete = Membership.delete
        removing = threading.Event()
        was_blocked = []

        def delete_once_the_member_waits(membership, *args, **kwargs):
            removing.set()  # the owner now holds every membership row of the project
            was_blocked.append(wait_until_a_session_waits_for_a_lock())
            return real_delete(membership, *args, **kwargs)

        def remove_member():
            return as_user(self.owner).delete(f"/api/projects/{self.project.pk}/members/{self.other.pk}/").status_code

        def change_status_as_member():
            removing.wait(10)
            url = f"/api/projects/{self.project.pk}/questions/{question.number}/transition/"
            return as_user(self.other).post(url, {"to": "asked"}, format="json").status_code

        with mock.patch.object(Membership, "delete", delete_once_the_member_waits):
            removed, changed = run_together(remove_member, change_status_as_member)

        # The member's request waited for its membership row; when the removal committed, the row
        # was gone: refused (404), not allowed one more change, and no 500 (no deadlock).
        self.assertEqual(was_blocked, [True])
        self.assertEqual((removed, changed), (204, 404))
        question.refresh_from_db()
        self.assertEqual(question.status, Question.Status.OPEN)
