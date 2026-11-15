"""A client is, on every team route, exactly a stranger (#121).

Every route that starts with /api/projects/ is called with every HTTP method, with real ids, once as a client of the
project and once as a person who is on no project at all. The status and the JSON body must be identical: the client's
role gives no power and reveals nothing on the team's side. A route added later is covered without anyone listing it.
The client's own routes (/api/client/...) are tested in test_client_routes.py.
"""

import re

from django.contrib.admindocs.views import extract_views_from_urlpatterns, simplify_regex
from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import TestCase
from django.urls import get_resolver
from rest_framework.test import APIClient

from core.testing import invented_password
from projects.models import Membership, Project
from questions.models import Answer, Question

from .models import AnswerSubmission
from .services import create_link

METHODS = ["get", "head", "options", "post", "put", "patch", "delete"]
# The one place a stranger and a client legitimately differ: any signed-in person may start a project, a person who
# is only ever a client may not (decided on #121). Tested in projects/test_client_role.py.
EXCLUDED = {("post", "/api/projects/")}


def routes(ids):
    """Concrete paths for every /api/projects/... pattern, with real ids filled in by parameter name."""
    found = set()
    for _view, regex, _namespace, _name in extract_views_from_urlpatterns(get_resolver().url_patterns):
        path = simplify_regex(regex)
        if "?" in path or "(" in path or "\\" in path:
            continue
        if not path.startswith("/api/projects/"):
            continue
        found.add(re.sub(r"<(?:\w+:)?(\w+)>", lambda m: str(ids.get(m.group(1), 1)), path))
    return sorted(found)


class ClientIsAStrangerOnTheTeamsRoutesTests(TestCase):
    def setUp(self):
        caches["throttle"].clear()
        User = get_user_model()
        self.owner = User.objects.create_user(email="owner@example.invalid", password=invented_password())
        self.client_user = User.objects.create_user(email="client@example.invalid", password=invented_password())
        self.stranger = User.objects.create_user(email="stranger@example.invalid", password=invented_password())
        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=self.project, user=self.owner, role=Membership.Role.OWNER)
        Membership.objects.create(project=self.project, user=self.client_user, role=Membership.Role.CLIENT)
        self.question = Question.objects.create(project=self.project, number=1, text="Which?", created_by=self.owner)
        Question.objects.create(project=self.project, number=2, text="Answered one", status="answered", created_by=self.owner)
        Answer.objects.create(
            question=Question.objects.get(project=self.project, number=2), text="A SECRET ANSWER", answered_by="Someone",
            answered_on="2026-11-10", channel="app", recorded_by=self.owner,
        )
        link, _ = create_link(self.project, self.owner, days=7)
        self.submission = AnswerSubmission.objects.create(link=link, question=self.question, text="x", submitter_name="y")
        self.ids = {
            "pk": self.project.pk, "project_id": self.project.pk, "number": 1, "submission_id": self.submission.pk,
            "user_id": self.owner.pk,
        }

    def call(self, who, method, path):
        api = APIClient(raise_request_exception=False)
        api.force_authenticate(who)
        response = getattr(api, method)(path, {}, format="json")
        body = response.content if "json" in response.get("Content-Type", "") else b""
        return response.status_code, body

    def test_the_walk_finds_the_routes_that_matter(self):
        paths = routes(self.ids)

        self.assertGreater(len(paths), 10)
        for fragment in ("/members/", "/transition/", "/answer-link/", "/submissions/", "/accept/", "/questions/"):
            self.assertTrue(any(fragment in p for p in paths), fragment)

    def test_every_route_every_method_gives_a_client_exactly_what_it_gives_a_stranger(self):
        differences = []
        for path in routes(self.ids):
            for method in METHODS:
                if (method, path) in EXCLUDED:
                    continue
                client_result = self.call(self.client_user, method, path)
                stranger_result = self.call(self.stranger, method, path)
                if client_result != stranger_result:
                    differences.append((method.upper(), path, client_result[0], stranger_result[0]))

        self.assertEqual(differences, [])

    def test_a_client_is_refused_on_the_project_itself_and_sees_no_answer(self):
        base = f"/api/projects/{self.project.pk}/"
        for suffix in ("", "questions/", "questions/1/", "questions/2/", "members/", "answer-link/", "submissions/"):
            status, body = self.call(self.client_user, "get", base + suffix)
            self.assertEqual(status, 404, suffix)
            self.assertNotIn(b"SECRET", body, suffix)
        # and the project list, which is the team's list, is empty for them
        self.assertEqual(self.call(self.client_user, "get", "/api/projects/")[0], 200)
        self.assertNotIn(b"Ticketing", self.call(self.client_user, "get", "/api/projects/")[1])
