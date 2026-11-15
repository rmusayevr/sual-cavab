"""How the team sees, marks and decides an answer that came from a client account (#121)."""

from django.utils import timezone
from rest_framework.test import APIClient

from questions.models import Answer, Question

from .models import AnswerSubmission
from .services import create_link
from .support import LinkTestCase


class TeamSideTests(LinkTestCase):
    def setUp(self):
        super().setUp()
        from django.contrib.auth import get_user_model

        from core.testing import invented_password
        from projects.models import Membership

        self.ada = get_user_model().objects.create_user(
            email="ada@example.invalid", password=invented_password(), first_name="Ada", last_name="Client"
        )
        Membership.objects.create(project=self.project, user=self.ada, role=Membership.Role.CLIENT)
        self.from_account = AnswerSubmission.objects.create(
            submitted_by=self.ada, question=self.q1, text="Use Stripe.", submitter_name="Ada Client"
        )
        self.from_link = AnswerSubmission.objects.create(link=self.link, question=self.q2, text="Ali approves", submitter_name="Murad")

    def team(self):
        return self.as_user(self.member)

    def test_the_team_is_told_where_each_answer_came_from(self):
        listed = {s["id"]: s for s in self.team().get(self.team_url("submissions/")).json()}

        self.assertEqual(listed[self.from_account.pk]["source"], "account")
        self.assertEqual(listed[self.from_account.pk]["submitter_name"], "Ada Client")
        self.assertEqual(listed[self.from_link.pk]["source"], "link")

    def test_accepting_an_account_answer_marks_it_as_from_a_client_and_names_the_account(self):
        response = self.team().post(self.team_url(f"submissions/{self.from_account.pk}/accept/"), {}, format="json")

        self.assertEqual(response.status_code, 200)
        answer = Answer.objects.get(question=self.q1)
        self.assertEqual(
            (answer.channel, answer.answered_by, answer.recorded_by, answer.answered_on, answer.text),
            ("client", "Ada Client", self.member, timezone.localdate(), "Use Stripe."),
        )
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, Question.Status.ANSWERED)
        self.from_account.refresh_from_db()
        self.assertEqual((self.from_account.state, self.from_account.answer), ("accepted", answer))

    def test_accepting_a_link_answer_is_still_marked_as_from_the_link(self):
        self.team().post(self.team_url(f"submissions/{self.from_link.pk}/accept/"), {}, format="json")

        self.assertEqual(Answer.objects.get(question=self.q2).channel, "link")

    def test_the_member_may_edit_the_text_and_the_clients_own_words_stay(self):
        self.team().post(self.team_url(f"submissions/{self.from_account.pk}/accept/"), {"text": "Stripe only."}, format="json")

        self.assertEqual(Answer.objects.get(question=self.q1).text, "Stripe only.")
        self.from_account.refresh_from_db()
        self.assertEqual(self.from_account.text, "Use Stripe.")

    def test_dismiss_all_and_restore_cover_both_kinds(self):
        done = self.team().post(self.team_url("submissions/dismiss-pending/"), {}, format="json")
        self.assertEqual(done.json(), {"dismissed": 2})

        restored = self.team().post(self.team_url(f"submissions/{self.from_account.pk}/restore/"), {}, format="json")

        self.assertEqual(restored.status_code, 200)
        self.from_account.refresh_from_db()
        self.assertEqual(self.from_account.state, "pending")

    def test_a_clients_own_session_cannot_decide_anything(self):
        client = APIClient()
        client.force_authenticate(self.ada)
        for suffix in (f"submissions/{self.from_account.pk}/accept/", f"submissions/{self.from_account.pk}/dismiss/", "submissions/dismiss-pending/"):
            self.assertEqual(client.post(self.team_url(suffix), {}, format="json").status_code, 404, suffix)
        self.from_account.refresh_from_db()
        self.assertEqual(self.from_account.state, "pending")

    def test_a_submission_comes_from_a_link_or_an_account_never_both_and_never_neither(self):
        from django.db import IntegrityError, transaction

        for kwargs in ({"link": self.link, "submitted_by": self.ada}, {}):
            with self.assertRaises(IntegrityError), transaction.atomic():
                AnswerSubmission.objects.create(question=self.q1, text="x", submitter_name="n", **kwargs)
