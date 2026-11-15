"""Putting back the earlier answer of a re-opened question (#121).

Re-opening keeps the answer as history. Restoring undoes the re-open: the most recently replaced answer is the
current one again and the question is answered again. Only for a question that has no current answer.
"""

import threading

from django.db import connections
from django.test import TransactionTestCase

from projects.models import Membership

from .models import Answer, Question
from .tests import QuestionTestCase, answer_payload, make_user


class RestoreAnswerTests(QuestionTestCase):
    def restore(self, number, user=None, project=None):
        return self.as_user(user or self.owner).post(self.url(project, number, "restore-answer/"), {}, format="json")

    def answered_then_reopened(self, text="Fourteen days."):
        number = self.ask()["number"]
        self.assertEqual(self.move(number, "answered", answer=answer_payload(text=text)).status_code, 200)
        self.assertEqual(self.move(number, "open").status_code, 200)
        return number

    def test_restoring_puts_the_earlier_answer_back_and_answers_the_question_again(self):
        number = self.answered_then_reopened()

        response = self.restore(number)

        self.assertEqual(response.status_code, 200, response.content)
        question = self.db_question(number)
        self.assertEqual(question.status, Question.Status.ANSWERED)
        self.assertIsNotNone(question.answered_at)
        current = question.answers.get(superseded_at__isnull=True)
        self.assertEqual(current.text, "Fourteen days.")
        self.assertEqual(question.answers.count(), 1)  # nothing was copied or deleted
        self.assertEqual(response.json()["status"], "answered")

    def test_with_several_earlier_answers_the_most_recently_replaced_one_comes_back(self):
        number = self.answered_then_reopened("first")
        self.move(number, "answered", answer=answer_payload(text="second"))
        self.move(number, "open")

        self.assertEqual(self.restore(number).status_code, 200)

        self.assertEqual(self.db_question(number).answers.get(superseded_at__isnull=True).text, "second")
        self.assertEqual(self.db_question(number).answers.count(), 2)

    def test_restoring_twice_the_second_time_is_refused_because_the_question_is_answered(self):
        number = self.answered_then_reopened()
        self.restore(number)

        again = self.restore(number)

        self.assertEqual(again.status_code, 400)
        self.assertEqual(self.db_question(number).answers.count(), 1)

    def test_a_question_that_was_never_answered_has_nothing_to_restore(self):
        number = self.ask()["number"]

        response = self.restore(number)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db_question(number).status, Question.Status.OPEN)

    def test_a_dropped_question_is_not_restored_to_answered(self):
        number = self.answered_then_reopened()
        self.move(number, "dropped")

        response = self.restore(number)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db_question(number).status, Question.Status.DROPPED)
        self.assertFalse(Answer.objects.filter(question__number=number, superseded_at__isnull=True).exists())

    def test_an_asked_question_may_have_its_answer_restored(self):
        number = self.answered_then_reopened()
        self.move(number, "asked")

        self.assertEqual(self.restore(number).status_code, 200)
        self.assertEqual(self.db_question(number).status, Question.Status.ANSWERED)

    def test_a_member_may_restore_and_a_stranger_gets_the_same_404_as_a_missing_question(self):
        number = self.answered_then_reopened()

        self.assertEqual(self.restore(number, user=self.outsider).status_code, 404)
        self.assertEqual(self.restore(999).status_code, 404)
        self.assertEqual(self.db_question(number).status, Question.Status.OPEN)
        self.assertEqual(self.restore(number, user=self.member).status_code, 200)

    def test_a_client_account_cannot_restore(self):
        number = self.answered_then_reopened()
        client_user = make_user("client@example.com")
        Membership.objects.create(project=self.project, user=client_user, role=Membership.Role.CLIENT)

        self.assertEqual(self.restore(number, user=client_user).status_code, 404)
        self.assertEqual(self.db_question(number).status, Question.Status.OPEN)

    def test_another_projects_question_is_not_reachable_through_this_project(self):
        other = self.make_project("Other", make_user("o2@example.com"))
        number = self.answered_then_reopened()

        self.assertEqual(self.restore(number, project=other).status_code, 404)

    def test_a_member_removed_mid_request_cannot_restore(self):
        from unittest import mock

        from .views import QuestionViewSet

        number = self.answered_then_reopened()
        real_initial = QuestionViewSet.initial

        def initial(view, request, *args, **kwargs):
            real_initial(view, request, *args, **kwargs)
            Membership.objects.filter(project=self.project, user=self.member).delete()

        with mock.patch.object(QuestionViewSet, "initial", initial):
            response = self.restore(number, user=self.member)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.db_question(number).status, Question.Status.OPEN)

    def test_a_question_that_somehow_already_has_a_current_answer_is_refused_not_broken(self):
        number = self.answered_then_reopened()
        question = self.db_question(number)
        Answer.objects.create(
            question=question, text="Newer", answered_by="Someone", answered_on="2026-11-10", channel="app", recorded_by=self.owner
        )

        response = self.restore(number)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(question.answers.filter(superseded_at__isnull=True).count(), 1)

    def test_the_request_must_be_a_post(self):
        number = self.answered_then_reopened()

        response = self.as_user(self.owner).get(self.url(None, number, "restore-answer/"))

        self.assertEqual(response.status_code, 405)


class ConcurrentRestoreTests(TransactionTestCase):
    def test_two_members_restoring_at_once_leave_exactly_one_current_answer(self):
        from rest_framework.test import APIClient

        owner = make_user("race-owner@example.com")
        from projects.models import Project

        project = Project.objects.create(name="Race", client_name="Invented", created_by=owner)
        Membership.objects.create(project=project, user=owner, role=Membership.Role.OWNER)
        question = Question.objects.create(project=project, number=1, text="Which?", created_by=owner)
        from .services import change_status

        other = make_user("race-member@example.com")
        Membership.objects.create(project=project, user=other, role=Membership.Role.MEMBER)
        change_status(question, "answered", owner, {"text": "A"})
        change_status(question, "open", owner)
        results = []

        def go(who):
            try:
                client = APIClient()
                client.force_authenticate(who)
                results.append(client.post(f"/api/projects/{project.pk}/questions/1/restore-answer/", {}, format="json").status_code)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=go, args=(who,)) for who in (owner, other)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(sorted(results), [200, 400])
        self.assertEqual(Answer.objects.filter(question=question, superseded_at__isnull=True).count(), 1)
        self.assertEqual(Answer.objects.filter(question=question).count(), 1)
