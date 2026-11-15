"""The Claude drafting feature is gone (#115). These fail if any piece of it comes back by accident."""

from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from core.testing import invented_password
from projects.models import Membership, Project


class DraftingIsGoneTests(TestCase):
    def test_a_member_asking_for_a_draft_gets_404_not_a_draft_and_not_a_server_error(self):
        # 404 for the route, not 403 or 503: nothing answers at that address any more.
        user = get_user_model().objects.create_user(email="ada@example.invalid", password=invented_password())
        project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=user)
        Membership.objects.create(project=project, user=user, role=Membership.Role.OWNER)
        client = APIClient()
        client.force_authenticate(user)

        response = client.post(f"/api/projects/{project.id}/draft/", {"questions": [1]}, format="json")

        self.assertEqual(response.status_code, 404)


class NothingOfDraftingIsLeftTests(SimpleTestCase):
    def test_the_app_is_not_installed_and_its_package_is_gone(self):
        self.assertNotIn("drafting", settings.INSTALLED_APPS)
        self.assertFalse((Path(settings.BASE_DIR) / "drafting").exists())

    def test_no_draft_rate_limit_is_configured(self):
        self.assertNotIn("draft", settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"])

    def test_the_server_no_longer_reads_a_model_or_a_key_for_drafting(self):
        self.assertFalse(hasattr(settings, "DRAFTING_MODEL"))

    def test_the_anthropic_sdk_is_not_a_dependency(self):
        requirements = (Path(settings.BASE_DIR) / "requirements.txt").read_text(encoding="utf-8").lower()

        self.assertNotIn("anthropic", requirements)
