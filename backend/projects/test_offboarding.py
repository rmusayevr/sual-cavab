"""Offboarding is deactivation (#39, the owner's choice: no rule change, `created_by` stays PROTECT).

When someone leaves, an admin unticks "active" on their account in /admin/. These tests pin what that does:
the person is signed out and cannot sign back in, the project is gone from their view, and nothing they wrote is
lost. Deleting the account is refused (the project, question and answer rows point at it), which is the point."""

from django.contrib.auth import get_user_model
from django.db.models import ProtectedError
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from core.testing import invented_password
from questions.models import Answer, Question

from .models import Membership, Project

PASSWORD = invented_password()


class OffboardingTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.leaver = User.objects.create_user(email="leaver@example.com", password=PASSWORD)
        self.stays = User.objects.create_user(email="stays@example.com", password=PASSWORD)
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.leaver)
        Membership.objects.create(project=self.project, user=self.leaver, role=Membership.Role.OWNER)
        Membership.objects.create(project=self.project, user=self.stays, role=Membership.Role.OWNER)
        self.question = Question.objects.create(
            project=self.project, number=1, text="Which invented format?", created_by=self.leaver
        )
        self.answer = Answer.objects.create(
            question=self.question, text="Invented answer", answered_by="Invented Contact",
            answered_on="2026-11-10", channel=Answer.Channel.CHAT, recorded_by=self.leaver,
        )

    def sign_in(self, email):
        client = APIClient()
        response = client.post(reverse("auth-login"), {"email": email, "password": PASSWORD}, format="json")
        return client, response

    def deactivate(self):
        self.leaver.is_active = False
        self.leaver.save()

    def counts(self):
        return Project.objects.count(), Question.objects.count(), Answer.objects.count(), Membership.objects.count()

    def test_a_deactivated_user_who_is_signed_in_loses_access_at_once(self):
        client, response = self.sign_in("leaver@example.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get(f"/api/projects/{self.project.pk}/").status_code, 200)

        self.deactivate()

        self.assertIn(client.get(f"/api/projects/{self.project.pk}/").status_code, (401, 403))
        self.assertIn(client.get("/api/projects/").status_code, (401, 403))

    def test_a_deactivated_user_cannot_sign_back_in(self):
        self.deactivate()

        client, response = self.sign_in("leaver@example.com")

        self.assertEqual(response.status_code, 400)
        self.assertIn(client.get(f"/api/projects/{self.project.pk}/").status_code, (401, 403))

    def test_nothing_the_user_wrote_is_lost(self):
        before = self.counts()

        self.deactivate()

        self.assertEqual(self.counts(), before)
        self.assertEqual(self.answer.recorded_by, self.leaver)
        client, _ = self.sign_in("stays@example.com")  # the others still see all of it
        detail = client.get(f"/api/projects/{self.project.pk}/questions/{self.question.number}/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["current_answer"]["text"], "Invented answer")

    def test_deleting_the_account_is_refused_and_loses_nothing(self):
        before = self.counts()

        with self.assertRaises(ProtectedError):
            self.leaver.delete()

        self.assertEqual(self.counts(), before)
        self.assertTrue(get_user_model().objects.filter(pk=self.leaver.pk).exists())

    def test_ticking_active_again_gives_everything_back(self):
        self.deactivate()
        self.leaver.is_active = True
        self.leaver.save()

        client, response = self.sign_in("leaver@example.com")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get(f"/api/projects/{self.project.pk}/").status_code, 200)
