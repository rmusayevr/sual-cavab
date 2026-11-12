"""The project list comes in pages (#49): 25 to a page, in the order the list already had (name, then id).

Only the people's own projects are counted and shown; the page number is the only knob."""

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from core.testing import invented_password

from .models import Membership, Project

PAGE = 25


def make_user(email):
    return get_user_model().objects.create_user(email=email, password=invented_password())


class ProjectPaginationTests(TestCase):
    def setUp(self):
        self.me = make_user("me@example.com")
        self.other = make_user("other@example.com")
        self.mine = []
        for n in range(30):
            project = Project.objects.create(name=f"Invented {n:02d}", client_name="Invented Client", created_by=self.me)
            Membership.objects.create(project=project, user=self.me, role=Membership.Role.OWNER)
            self.mine.append(project)
        for n in range(3):  # not mine: must be neither counted nor shown
            project = Project.objects.create(name=f"Elsewhere {n}", client_name="Other", created_by=self.other)
            Membership.objects.create(project=project, user=self.other, role=Membership.Role.OWNER)
        self.client = APIClient()
        self.client.force_authenticate(self.me)

    def page(self, number=None, **extra):
        query = {} if number is None else {"page": number}
        return self.client.get("/api/projects/", {**query, **extra})

    def test_the_first_page_holds_a_page_and_says_how_many_there_are(self):
        body = self.page().json()

        self.assertEqual(len(body["results"]), PAGE)
        self.assertEqual(body["count"], 30)  # mine only: the 3 elsewhere are not counted
        self.assertEqual(body["page"], 1)
        self.assertEqual(body["page_size"], PAGE)

    def test_the_second_page_holds_the_rest_and_nothing_repeats(self):
        first = self.page(1).json()["results"]
        second = self.page(2).json()["results"]

        self.assertEqual(len(second), 5)
        ids = [p["id"] for p in first + second]
        self.assertEqual(len(set(ids)), 30)
        self.assertEqual([p["name"] for p in first + second], [p.name for p in self.mine])  # by name, then id

    def test_a_page_past_the_end_or_not_a_page_is_not_found(self):
        for number in ("3", "0", "-1", "abc"):
            with self.subTest(page=number):
                self.assertEqual(self.page(number).status_code, 404)

    def test_the_size_of_a_page_cannot_be_asked_for(self):
        self.assertEqual(len(self.page(page_size=1000).json()["results"]), PAGE)

    def test_nobody_else_s_project_appears_on_any_page(self):
        names = [p["name"] for number in (1, 2) for p in self.page(number).json()["results"]]

        self.assertFalse([n for n in names if n.startswith("Elsewhere")])

    def test_signed_out_is_still_refused(self):
        self.assertEqual(APIClient().get("/api/projects/").status_code, 403)

    def test_a_person_on_no_project_gets_an_empty_first_page(self):
        client = APIClient()
        client.force_authenticate(make_user("nobody@example.com"))

        body = client.get("/api/projects/").json()

        self.assertEqual((body["count"], body["results"]), (0, []))

    def test_a_page_costs_the_same_number_of_queries_however_many_projects_there_are(self):
        small = APIClient()
        small.force_authenticate(self.other)  # three projects
        with CaptureQueriesContext(connection) as few:
            small.get("/api/projects/")
        with CaptureQueriesContext(connection) as many:
            self.page(1)

        self.assertEqual(len(many), len(few))
