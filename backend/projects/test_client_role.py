"""The client role: a person who can only answer, never reach the team's side of a project (#121).

`Project.objects.visible_to()` is the one door every team route uses; a client must not pass it, or they would walk
into every team screen. `visible_to_client()` is the only door a client has, and only the client routes use it.
"""

from django.contrib.auth import get_user_model
from django.http import Http404
from django.test import TestCase
from rest_framework.test import APIClient

from core.testing import invented_password

from .models import Membership, Project
from .permissions import lock_caller_membership

PASSWORD = invented_password()


def user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


class RoleDoorTests(TestCase):
    def setUp(self):
        self.owner, self.member = user("owner@example.invalid"), user("member@example.invalid")
        self.client_user, self.stranger = user("client@example.invalid"), user("stranger@example.invalid")
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        for who, role in (
            (self.owner, Membership.Role.OWNER),
            (self.member, Membership.Role.MEMBER),
            (self.client_user, Membership.Role.CLIENT),
        ):
            Membership.objects.create(project=self.project, user=who, role=role)

    def test_the_team_door_lets_owners_and_members_in_and_not_clients_or_strangers(self):
        door = lambda who: list(Project.objects.visible_to(who))  # noqa: E731

        self.assertEqual(door(self.owner), [self.project])
        self.assertEqual(door(self.member), [self.project])
        self.assertEqual(door(self.client_user), [])
        self.assertEqual(door(self.stranger), [])

    def test_the_client_door_lets_clients_in_and_nobody_else(self):
        door = lambda who: list(Project.objects.visible_to_client(who))  # noqa: E731

        self.assertEqual(door(self.client_user), [self.project])
        for who in (self.owner, self.member, self.stranger):
            self.assertEqual(door(who), [], who.email)

    def test_nobody_signed_out_passes_either_door(self):
        from django.contrib.auth.models import AnonymousUser

        self.assertEqual(list(Project.objects.visible_to(AnonymousUser())), [])
        self.assertEqual(list(Project.objects.visible_to_client(AnonymousUser())), [])

    def test_a_person_who_is_a_client_here_and_a_member_there_uses_each_project_through_its_own_door(self):
        other = Project.objects.create(name="Booking", client_name="Other", created_by=self.owner)
        Membership.objects.create(project=other, user=self.client_user, role=Membership.Role.MEMBER)

        self.assertEqual(list(Project.objects.visible_to(self.client_user)), [other])
        self.assertEqual(list(Project.objects.visible_to_client(self.client_user)), [self.project])

    def test_the_two_conditions_apply_to_the_same_membership(self):
        # Someone who is a member of A and a client of B must not see B through the team door because
        # "has a membership" and "has a team role" were matched against different rows.
        other = Project.objects.create(name="Booking", client_name="Other", created_by=self.owner)
        Membership.objects.create(project=other, user=self.member, role=Membership.Role.CLIENT)

        self.assertEqual(list(Project.objects.visible_to(self.member)), [self.project])

    def test_a_clients_write_lock_is_refused_like_a_strangers(self):
        for who in (self.client_user, self.stranger):
            with self.assertRaises(Http404):
                lock_caller_membership(self.project, who)

    def test_the_team_still_gets_its_lock(self):
        for who in (self.owner, self.member):
            self.assertEqual(lock_caller_membership(self.project, who).user, who)


class CreatingAProjectTests(TestCase):
    """A person who is only ever a client has no team side to start a project on (#121)."""

    def setUp(self):
        self.owner = user("owner@example.invalid")
        self.client_user = user("client@example.invalid")
        project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=project, user=self.owner, role=Membership.Role.OWNER)
        Membership.objects.create(project=project, user=self.client_user, role=Membership.Role.CLIENT)

    def create(self, who):
        api = APIClient()
        api.force_authenticate(who)
        return api.post("/api/projects/", {"name": "New", "client_name": "Someone"}, format="json")

    def test_a_person_who_is_only_a_client_cannot_start_a_project(self):
        before = Project.objects.count()

        response = self.create(self.client_user)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Project.objects.count(), before)

    def test_a_client_who_is_also_on_a_team_somewhere_can(self):
        other = Project.objects.create(name="Booking", client_name="Other", created_by=self.owner)
        Membership.objects.create(project=other, user=self.client_user, role=Membership.Role.MEMBER)

        self.assertEqual(self.create(self.client_user).status_code, 201)

    def test_a_person_with_no_membership_yet_can_still_start_a_project(self):
        self.assertEqual(self.create(user("newcomer@example.invalid")).status_code, 201)


class OwnersAddClientsTests(TestCase):
    def setUp(self):
        self.owner, self.member = user("owner@example.invalid"), user("member@example.invalid")
        self.account = user("client@example.invalid")
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=self.project, user=self.owner, role=Membership.Role.OWNER)
        Membership.objects.create(project=self.project, user=self.member, role=Membership.Role.MEMBER)

    def add(self, who, role="client"):
        api = APIClient()
        api.force_authenticate(who)
        return api.post(f"/api/projects/{self.project.pk}/members/", {"email": self.account.email, "role": role}, format="json")

    def test_an_owner_can_add_an_existing_account_as_a_client(self):
        response = self.add(self.owner)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["role"], "client")
        self.assertEqual(Membership.objects.get(user=self.account).role, Membership.Role.CLIENT)

    def test_a_member_who_is_not_an_owner_cannot(self):
        self.assertEqual(self.add(self.member).status_code, 403)
        self.assertFalse(Membership.objects.filter(user=self.account).exists())

    def test_the_members_list_shows_a_client_as_a_client_and_only_to_the_team(self):
        self.add(self.owner)
        team = APIClient()
        team.force_authenticate(self.member)
        client_api = APIClient()
        client_api.force_authenticate(self.account)

        listed = team.get(f"/api/projects/{self.project.pk}/members/").json()
        by_email = {m["email"]: m["role"] for m in listed}

        self.assertEqual(by_email[self.account.email], "client")
        self.assertEqual(client_api.get(f"/api/projects/{self.project.pk}/members/").status_code, 404)

    def test_a_client_can_be_removed_and_loses_the_project_at_once(self):
        self.add(self.owner)
        owner_api = APIClient()
        owner_api.force_authenticate(self.owner)

        removed = owner_api.delete(f"/api/projects/{self.project.pk}/members/{self.account.pk}/")

        self.assertEqual(removed.status_code, 204)
        self.assertEqual(list(Project.objects.visible_to_client(self.account)), [])


class RollbackGuardTests(TestCase):
    """Going back to a release that does not know clients would turn every client into a team member (review of #123)."""

    def test_reversing_the_role_migration_is_refused_while_a_client_exists_and_allowed_when_none_does(self):
        import importlib

        from django.apps import apps
        from django.db import migrations

        module = importlib.import_module("projects.migrations.0003_alter_membership_role")
        owner = get_user_model().objects.create_user(email="o@example.invalid", password=invented_password())
        project = Project.objects.create(name="P", client_name="C", created_by=owner)
        module.refuse_while_clients_exist(apps, None)  # no client: fine

        Membership.objects.create(project=project, user=owner, role=Membership.Role.CLIENT)

        with self.assertRaises(migrations.exceptions.IrreversibleError):
            module.refuse_while_clients_exist(apps, None)
