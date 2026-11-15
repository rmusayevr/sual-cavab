"""Simultaneous requests (real threads): the locks the design relies on, each with a test that fails without it (#114)."""

import threading
import time
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.db import connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from projects.models import Membership, Project
from questions.models import Question

from .models import AnswerLink, AnswerSubmission
from .services import create_link
from .support import PASSWORD, link_answers, with_token


class SlowCap:
    """Stands in for the per-question cap. The view compares `count >= cap`; Python then calls this object's
    __le__, which waits before answering. That puts the delay between COUNTING the waiting answers and
    ADDING one, which is exactly the gap the link-row lock closes."""

    def __le__(self, count):
        time.sleep(0.1)
        return 5 <= count  # "count >= 5" is evaluated by Python as 5 <= count


def at_the_same_moment(count, work):
    """Run work(i) in `count` threads released together; return the results in order."""
    barrier = threading.Barrier(count)
    results = [None] * count

    def run(i):
        try:
            barrier.wait(timeout=30)
            results[i] = work(i)
        except Exception as exc:  # shown by the assertion, not lost in the thread
            results[i] = exc
        finally:
            connections.close_all()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
    return results


class SimultaneousTests(TransactionTestCase):
    databases = {"default"}

    def setUp(self):
        caches["throttle"].clear()
        User = get_user_model()
        self.users = [User.objects.create_user(email=f"user{n}@example.invalid", password=PASSWORD) for n in range(4)]
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.users[0])
        for n, user in enumerate(self.users):
            role = Membership.Role.OWNER if n == 0 else Membership.Role.MEMBER
            Membership.objects.create(project=self.project, user=user, role=role)
        self.question = Question.objects.create(project=self.project, number=1, text="Which?", created_by=self.users[0])

    def test_the_cap_of_five_waiting_answers_per_question_is_exact_under_simultaneous_submissions(self):
        _, token = create_link(self.project, self.users[0], days=7)
        def submit(i):
            client = APIClient()
            return client.post(
                link_answers(1), {"text": f"answer {i}", "name": "n"}, format="json", **with_token(token)
            ).status_code

        with mock.patch("answerlinks.views.MAX_PENDING_PER_QUESTION", SlowCap()):
            results = at_the_same_moment(10, submit)

        self.assertEqual(sorted(results), [201] * 5 + [429] * 5, results)
        self.assertEqual(AnswerSubmission.objects.filter(question=self.question).count(), 5)

    def test_making_links_at_the_same_moment_leaves_exactly_one_unrevoked_link_and_no_server_error(self):
        real = __import__("secrets").token_urlsafe

        def slow(nbytes=None):
            time.sleep(0.05)  # widen the gap between revoking the old link and adding the new one
            return real(nbytes)

        def make(i):
            client = APIClient()
            client.force_authenticate(self.users[i])
            return client.post(f"/api/projects/{self.project.pk}/answer-link/", {}, format="json").status_code

        with mock.patch("answerlinks.services.secrets.token_urlsafe", slow):
            results = at_the_same_moment(4, make)

        self.assertEqual(results, [201] * 4, results)
        self.assertEqual(AnswerLink.objects.filter(project=self.project).count(), 4)
        self.assertEqual(AnswerLink.objects.filter(project=self.project, revoked_at__isnull=True).count(), 1)
