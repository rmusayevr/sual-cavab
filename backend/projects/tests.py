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

from core.testing import invented_password
PASSWORD = invented_password()


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

    def test_member_edits_the_project_with_put(self):
        body = {"name": "Renamed", "client_name": "Invented Client", "description": ""}

        self.assertEqual(self.as_user(self.member).put(self.detail(), body, format="json").status_code, 200)

    def test_a_role_sent_with_a_project_edit_changes_nothing(self):
        self.as_user(self.member).patch(self.detail(), {"role": "owner", "my_role": "owner"}, format="json")

        self.assertEqual(Membership.objects.get(project=self.project, user=self.member).role, "member")

    def test_outsider_gets_404_when_editing(self):
        response = self.as_user(self.outsider).patch(self.detail(), {"name": "Hijacked"}, format="json")

        self.assertEqual(response.status_code, 404)

    def test_outsider_edit_changes_nothing(self):
        self.as_user(self.outsider).patch(self.detail(), {"name": "Hijacked"}, format="json")
        self.project.refresh_from_db()

        self.assertEqual(self.project.name, "Ticketing")


class EditRaceTests(ProjectAccessTestCase):
    """Review of #21: the project edit gets the same protections as questions."""

    def after_get_object(self, action):
        from unittest import mock

        from .views import ProjectViewSet

        real = ProjectViewSet.get_object

        def wrapper(view):
            project = real(view)
            action()
            return project

        return mock.patch.object(ProjectViewSet, "get_object", wrapper)

    def test_a_member_removed_mid_request_cannot_edit_the_project(self):
        remove = lambda: Membership.objects.filter(project=self.project, user=self.member).delete()  # noqa: E731

        with self.after_get_object(remove):
            response = self.as_user(self.member).patch(self.detail(), {"name": "Too late"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.project.refresh_from_db()
        self.assertEqual(self.project.name, "Ticketing")

    def test_the_edit_answers_with_the_project_as_it_is_now(self):
        change = lambda: Project.objects.filter(pk=self.project.pk).update(description="Changed meanwhile")  # noqa: E731

        with self.after_get_object(change):
            response = self.as_user(self.owner).patch(self.detail(), {"name": "Renamed"}, format="json")

        self.assertEqual(response.json()["description"], "Changed meanwhile")

    def test_editing_a_project_locks_the_membership_before_writing_it(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            self.as_user(self.owner).patch(self.detail(), {"name": "Renamed"}, format="json")
        sql = [q["sql"] for q in ctx.captured_queries]

        lock = next(i for i, s in enumerate(sql) if 'FROM "projects_membership"' in s and "FOR UPDATE" in s)
        write = next(i for i, s in enumerate(sql) if 'UPDATE "projects_project"' in s)
        self.assertLess(lock, write)


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


class MemberAddThrottleTests(ProjectAccessTestCase):
    """Owner-approved on #19: a 201 vs a 400 on 'add member' tells a signed-in
    user whether an email has an account. Accepted for v1, with attempts
    limited per user so it can't be used to list accounts in bulk."""

    def setUp(self):
        super().setUp()
        from django.core.cache import caches

        caches["throttle"].clear()

    def guess(self, user, n):
        return self.as_user(user).post(self.members(), {"email": f"guess{n}@example.com"}, format="json")

    def test_member_add_attempts_are_limited_per_user(self):
        for n in range(30):
            self.guess(self.owner, n)

        self.assertEqual(self.guess(self.owner, 30).status_code, 429)

    def test_failed_guesses_count_toward_the_limit(self):
        # Every one of these is a 400 ("no active user has this email").
        statuses = {self.guess(self.owner, n).status_code for n in range(30)}

        self.assertEqual(statuses, {400})
        self.assertEqual(self.guess(self.owner, 30).status_code, 429)

    def test_one_users_limit_does_not_block_another_user(self):
        for n in range(31):
            self.guess(self.owner, n)

        self.assertEqual(self.guess(self.member, 0).status_code, 403)  # reaches the view: not throttled

    def test_listing_members_is_not_limited(self):
        for n in range(31):
            self.guess(self.owner, n)

        self.assertEqual(self.as_user(self.owner).get(self.members()).status_code, 200)


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

    def test_a_duplicate_add_that_races_the_lock_is_a_400_not_a_500(self):
        # Review round 2 of #19: PostgreSQL's FOR UPDATE does not show a blocked
        # request the row another request inserted while it waited, so the
        # in-memory duplicate check can pass and the unique constraint fires.
        # Simulate that stale view: the user is already a member, but the
        # locked rows the view reads do not include them.
        from unittest import mock

        from . import views

        Membership.objects.create(project=self.project, user=self.newcomer, role=Membership.Role.MEMBER)
        real_lock = views.lock_memberships

        def stale_lock(project, user):
            rows, role = real_lock(project, user)
            return [m for m in rows if m.user_id != self.newcomer.pk], role

        with mock.patch.object(views, "lock_memberships", stale_lock):
            response = self.add(self.owner, "newcomer@example.com")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Membership.objects.filter(project=self.project, user=self.newcomer).count(), 1)

    def test_a_member_gets_403_whether_or_not_the_email_has_an_account(self):
        # Authorize before validating: otherwise a non-owner can tell an email
        # with no account (400) from one with an account (403).
        unknown = self.add(self.member, "nobody@example.com")
        known = self.add(self.member, "newcomer@example.com")

        self.assertEqual((unknown.status_code, known.status_code), (403, 403))

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

    def test_the_last_active_owner_cannot_be_removed_when_the_other_owner_is_deactivated(self):
        # Review of #19: a deactivated owner can't manage the project, so
        # counting them let the only active owner leave.
        ghost = make_user("ghost@example.com")
        Membership.objects.create(project=self.project, user=ghost, role=Membership.Role.OWNER)
        ghost.is_active = False
        ghost.save()
        url = f"{self.members()}{self.owner.pk}/"

        self.assertEqual(self.as_user(self.owner).delete(url).status_code, 400)

    def test_a_deactivated_owner_can_be_removed(self):
        ghost = make_user("ghost@example.com")
        Membership.objects.create(project=self.project, user=ghost, role=Membership.Role.OWNER)
        ghost.is_active = False
        ghost.save()

        self.assertEqual(self.as_user(self.owner).delete(f"{self.members()}{ghost.pk}/").status_code, 204)

    def test_an_owner_removed_a_moment_ago_cannot_remove_members(self):
        # Review of #19: the owner check ran before the row lock, so an owner
        # removed concurrently still completed one removal. Simulate the
        # concurrent removal landing right after the project is looked up.
        from unittest import mock

        from .views import ProjectViewSet

        real_get_object = ProjectViewSet.get_object

        def get_object_then_lose_ownership(view):
            project = real_get_object(view)
            Membership.objects.filter(project=project, user=self.owner).delete()
            return project

        with mock.patch.object(ProjectViewSet, "get_object", get_object_then_lose_ownership):
            response = self.as_user(self.owner).delete(f"{self.members()}{self.member.pk}/")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(Membership.objects.filter(project=self.project, user=self.member).exists())

    def test_an_owner_removed_a_moment_ago_cannot_add_members(self):
        from unittest import mock

        from .views import ProjectViewSet

        real_get_object = ProjectViewSet.get_object

        def get_object_then_lose_ownership(view):
            project = real_get_object(view)
            Membership.objects.filter(project=project, user=self.owner).delete()
            return project

        with mock.patch.object(ProjectViewSet, "get_object", get_object_then_lose_ownership):
            response = self.add(self.owner, "newcomer@example.com")

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Membership.objects.filter(project=self.project, user=self.newcomer).exists())

    def test_removed_member_loses_access(self):
        self.as_user(self.owner).delete(f"{self.members()}{self.member.pk}/")

        self.assertEqual(self.as_user(self.member).get(self.detail()).status_code, 404)


class OpenQuestionCountTests(ProjectAccessTestCase):
    """The project list shows how many questions are still open (#7)."""

    def add(self, project, status, n):
        from questions.models import Question

        return Question.objects.create(
            project=project, number=n, text=f"Invented question {n}", status=status, created_by=self.owner
        )

    def count_for(self, user, project):
        rows = self.as_user(user).get("/api/projects/").json()
        return next(r["open_question_count"] for r in rows if r["id"] == project.pk)

    def test_counts_open_and_asked_only(self):
        for n, status in enumerate(["open", "asked", "answered", "dropped", "open"], start=1):
            self.add(self.project, status, n)
        self.assertEqual(self.count_for(self.member, self.project), 3)

    def test_counts_are_per_project(self):
        other = Project.objects.create(name="Booking", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=other, user=self.owner, role=Membership.Role.OWNER)
        self.add(self.project, "open", 1)
        self.add(other, "open", 1)
        self.add(other, "asked", 2)
        self.assertEqual(self.count_for(self.owner, self.project), 1)
        self.assertEqual(self.count_for(self.owner, other), 2)

    def test_zero_when_nothing_is_open(self):
        self.add(self.project, "answered", 1)
        self.assertEqual(self.count_for(self.owner, self.project), 0)

    def test_a_just_created_project_answers_with_a_zero_count(self):
        created = self.as_user(self.owner).post(
            "/api/projects/", {"name": "Fresh", "client_name": "Invented Client"}, format="json"
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json()["open_question_count"], 0)

    def test_detail_and_edit_answer_carry_the_count(self):
        self.add(self.project, "open", 1)
        client = self.as_user(self.owner)
        self.assertEqual(client.get(self.detail()).json()["open_question_count"], 1)
        edited = client.patch(self.detail(), {"name": "Ticketing 2"}, format="json")
        self.assertEqual(edited.json()["open_question_count"], 1)

    def test_an_outsider_learns_nothing(self):
        self.add(self.project, "open", 1)
        self.assertEqual(self.as_user(self.outsider).get("/api/projects/").json(), [])
        self.assertEqual(self.as_user(self.outsider).get(self.detail()).status_code, 404)
