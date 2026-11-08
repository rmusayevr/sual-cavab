"""The access rule approved on #5, one test per cell, with real requests.

| Action                         | owner | member | not a member |
|--------------------------------|-------|--------|--------------|
| See the project                | yes   | yes    | no (404)     |
| Edit name, client, description | yes   | yes    | no (404)     |
| Add or remove members          | yes   | no     | no (404)     |
| Delete the project             | nobody (no endpoint)            |
"""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Membership, Project

PASSWORD = "invented-test-password"


def make_user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


class ProjectAccessTestCase(TestCase):
    def setUp(self):
        self.owner = make_user("owner@example.com")
        self.member = make_user("member@example.com")
        self.outsider = make_user("outsider@example.com")
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=self.project, user=self.owner, role=Membership.Role.OWNER)
        Membership.objects.create(project=self.project, user=self.member, role=Membership.Role.MEMBER)

    def as_user(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def detail(self):
        return f"/api/projects/{self.project.pk}/"

    def members(self):
        return f"/api/projects/{self.project.pk}/members/"


class SeeTests(ProjectAccessTestCase):
    def test_owner_sees_the_project(self):
        self.assertEqual(self.as_user(self.owner).get(self.detail()).status_code, 200)

    def test_member_sees_the_project(self):
        self.assertEqual(self.as_user(self.member).get(self.detail()).status_code, 200)

    def test_outsider_gets_404_for_the_project(self):
        self.assertEqual(self.as_user(self.outsider).get(self.detail()).status_code, 404)

    def test_outsider_gets_the_same_404_as_for_a_project_that_does_not_exist(self):
        client = self.as_user(self.outsider)

        hidden = client.get(self.detail())
        missing = client.get("/api/projects/999999/")

        self.assertEqual((hidden.status_code, hidden.json()), (missing.status_code, missing.json()))

    def test_list_shows_only_my_projects(self):
        Project.objects.create(name="Someone else's", client_name="Other", created_by=self.outsider)

        names = [p["name"] for p in self.as_user(self.member).get("/api/projects/").json()]

        self.assertEqual(names, ["Ticketing"])

    def test_outsider_lists_no_projects(self):
        self.assertEqual(self.as_user(self.outsider).get("/api/projects/").json(), [])

    def test_superuser_who_is_not_a_member_gets_404(self):
        admin = get_user_model().objects.create_superuser(email="root@example.com", password=PASSWORD)

        self.assertEqual(self.as_user(admin).get(self.detail()).status_code, 404)

    def test_anonymous_request_is_refused(self):
        self.assertEqual(APIClient().get("/api/projects/").status_code, 403)

    def test_project_shows_the_callers_role(self):
        self.assertEqual(self.as_user(self.member).get(self.detail()).json()["my_role"], "member")


class EditTests(ProjectAccessTestCase):
    def test_owner_edits_the_project(self):
        response = self.as_user(self.owner).patch(self.detail(), {"name": "Ticketing v2"}, format="json")

        self.assertEqual(response.status_code, 200)

    def test_member_edits_the_project(self):
        response = self.as_user(self.member).patch(self.detail(), {"client_name": "Renamed"}, format="json")

        self.assertEqual(response.status_code, 200)

    def test_outsider_gets_404_when_editing(self):
        response = self.as_user(self.outsider).patch(self.detail(), {"name": "Hijacked"}, format="json")

        self.assertEqual(response.status_code, 404)

    def test_outsider_edit_changes_nothing(self):
        self.as_user(self.outsider).patch(self.detail(), {"name": "Hijacked"}, format="json")
        self.project.refresh_from_db()

        self.assertEqual(self.project.name, "Ticketing")


class DeleteTests(ProjectAccessTestCase):
    def test_owner_cannot_delete_the_project(self):
        self.assertEqual(self.as_user(self.owner).delete(self.detail()).status_code, 405)


class CreateTests(ProjectAccessTestCase):
    def test_any_signed_in_user_can_create_a_project(self):
        response = self.as_user(self.outsider).post(
            "/api/projects/", {"name": "New", "client_name": "Invented"}, format="json"
        )

        self.assertEqual(response.status_code, 201)

    def test_creator_becomes_the_owner(self):
        response = self.as_user(self.outsider).post(
            "/api/projects/", {"name": "New", "client_name": "Invented"}, format="json"
        )

        self.assertEqual(response.json()["my_role"], "owner")


class MemberManagementTests(ProjectAccessTestCase):
    def setUp(self):
        super().setUp()
        self.newcomer = make_user("newcomer@example.com")

    def add(self, user, email, **extra):
        return self.as_user(user).post(self.members(), {"email": email, **extra}, format="json")

    def test_owner_adds_a_member(self):
        self.assertEqual(self.add(self.owner, "newcomer@example.com").status_code, 201)

    def test_member_cannot_add_members(self):
        self.assertEqual(self.add(self.member, "newcomer@example.com").status_code, 403)

    def test_outsider_gets_404_when_adding_members(self):
        self.assertEqual(self.add(self.outsider, "newcomer@example.com").status_code, 404)

    def test_member_sees_the_member_list(self):
        emails = [m["email"] for m in self.as_user(self.member).get(self.members()).json()]

        self.assertEqual(sorted(emails), ["member@example.com", "owner@example.com"])

    def test_outsider_gets_404_for_the_member_list(self):
        self.assertEqual(self.as_user(self.outsider).get(self.members()).status_code, 404)

    def test_the_same_user_cannot_be_added_twice(self):
        self.assertEqual(self.add(self.owner, "member@example.com").status_code, 400)

    def test_adding_an_email_with_no_account_is_refused(self):
        self.assertEqual(self.add(self.owner, "nobody@example.com").status_code, 400)

    def test_owner_removes_a_member(self):
        url = f"{self.members()}{self.member.pk}/"

        self.assertEqual(self.as_user(self.owner).delete(url).status_code, 204)

    def test_member_cannot_remove_members(self):
        url = f"{self.members()}{self.owner.pk}/"

        self.assertEqual(self.as_user(self.member).delete(url).status_code, 403)

    def test_outsider_gets_404_when_removing_members(self):
        url = f"{self.members()}{self.member.pk}/"

        self.assertEqual(self.as_user(self.outsider).delete(url).status_code, 404)

    def test_the_last_owner_cannot_be_removed(self):
        url = f"{self.members()}{self.owner.pk}/"

        self.assertEqual(self.as_user(self.owner).delete(url).status_code, 400)

    def test_an_owner_can_leave_when_another_owner_remains(self):
        self.add(self.owner, "newcomer@example.com", role="owner")
        url = f"{self.members()}{self.owner.pk}/"

        self.assertEqual(self.as_user(self.owner).delete(url).status_code, 204)

    def test_removed_member_loses_access(self):
        self.as_user(self.owner).delete(f"{self.members()}{self.member.pk}/")

        self.assertEqual(self.as_user(self.member).get(self.detail()).status_code, 404)
