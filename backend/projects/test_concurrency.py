"""The row locks, proved with real threads on the real database (#34).

Each test widens the race window on purpose: a short sleep inside the write,
after the lock is taken. Without the lock the bad outcome then happens every
time, not once in a hundred runs. Every thread is joined with a timeout, so a
deadlock fails the test instead of hanging the suite.

Lock order, from projects/permissions.py: the caller's membership row first,
then the project or question row.
"""

import threading
import time
from unittest import mock

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from questions.models import Answer, Question
from questions.services import change_status as real_change_status

from .models import Membership, Project

PASSWORD = "invented-test-password"
HOLD = 0.6  # seconds a write holds its locks, so the other request really waits
JOIN_TIMEOUT = 60


def make_user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


def as_user(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


def run_together(*calls):
    """Run each call in its own thread; return their results in call order.

    A call that raised, or a thread still alive after the timeout (a deadlock),
    fails the test here with what happened.
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

        def slow_delete(membership, *args, **kwargs):
            time.sleep(HOLD)
            return real_delete(membership, *args, **kwargs)

        def remove(caller, target):
            start.wait(10)
            return as_user(caller).delete(f"/api/projects/{self.project.pk}/members/{target.pk}/").status_code

        with mock.patch.object(Membership, "delete", slow_delete):
            codes = run_together(lambda: remove(self.owner, self.other), lambda: remove(self.other, self.owner))

        # One removal wins; the other caller is no longer a member, so it is a 404.
        self.assertEqual(sorted(codes), [204, 404])
        owners = Membership.objects.filter(project=self.project, role=Membership.Role.OWNER)
        self.assertEqual(owners.count(), 1)

    def test_two_answers_at_the_same_moment_record_only_one(self):
        self.add(self.other, Membership.Role.MEMBER)
        question = self.question()
        start = threading.Barrier(2)

        def slow_change_status(*args, **kwargs):
            time.sleep(HOLD)
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

        with mock.patch("questions.views.change_status", slow_change_status):
            codes = run_together(lambda: answer(self.owner), lambda: answer(self.other))

        # The second sees an answered question: answered -> answered is refused.
        self.assertEqual(sorted(codes), [200, 400])
        self.assertEqual(Answer.objects.filter(question=question).count(), 1)

    def test_a_member_removed_a_moment_ago_cannot_make_one_more_change(self):
        self.add(self.other, Membership.Role.MEMBER)
        question = self.question()
        real_delete = Membership.delete
        removing = threading.Event()

        def slow_delete(membership, *args, **kwargs):
            removing.set()  # the owner now holds every membership row of the project
            time.sleep(HOLD)
            return real_delete(membership, *args, **kwargs)

        def remove_member():
            return as_user(self.owner).delete(f"/api/projects/{self.project.pk}/members/{self.other.pk}/").status_code

        def change_status_as_member():
            removing.wait(10)
            url = f"/api/projects/{self.project.pk}/questions/{question.number}/transition/"
            return as_user(self.other).post(url, {"to": "asked"}, format="json").status_code

        with mock.patch.object(Membership, "delete", slow_delete):
            removed, changed = run_together(remove_member, change_status_as_member)

        # No 500 (no deadlock), and the removed member's write is refused, not allowed one more time.
        self.assertEqual((removed, changed), (204, 404))
        question.refresh_from_db()
        self.assertEqual(question.status, Question.Status.OPEN)
