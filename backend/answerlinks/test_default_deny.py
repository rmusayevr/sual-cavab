"""A link token opens exactly two routes and nothing else (#114).

Every route in the project's URLconf is called with every HTTP method, once with a valid link token and once
with nothing. For every route except the two link routes the answers must be the same: the token adds no power
anywhere. A route added next month is covered without anyone remembering to list it.
"""

import re

from django.contrib.admindocs.views import extract_views_from_urlpatterns, simplify_regex
from django.urls import get_resolver
from rest_framework.test import APIClient

from .support import LINK_QUESTIONS, LinkTestCase, with_token

METHODS = ["get", "post", "put", "patch", "delete"]
LINK_PATHS = {LINK_QUESTIONS, "/api/answer-link/questions/1/answers/"}


def every_route():
    """Concrete paths for every pattern, with 1 for each parameter."""
    paths = set()
    for _view, regex, _namespace, _name in extract_views_from_urlpatterns(get_resolver().url_patterns):
        path = re.sub(r"<[^>]+>", "1", simplify_regex(regex))
        if "?" in path or "(" in path or "\\" in path:
            continue
        paths.add(path)
    return sorted(paths)


class DefaultDenyTests(LinkTestCase):
    def test_the_walk_really_finds_the_routes_that_matter(self):
        paths = every_route()

        self.assertGreater(len(paths), 15)
        for expected in (
            "/api/projects/1/members/",
            "/api/projects/1/questions/1/transition/",
            "/api/projects/1/answer-link/",
            "/api/projects/1/submissions/",
            "/api/projects/1/submissions/1/accept/",
            "/api/auth/me/",
        ):
            self.assertIn(expected, paths)
        self.assertTrue(LINK_PATHS <= set(paths))

    def test_a_link_token_changes_no_answer_anywhere_but_the_link_routes(self):
        with_link = APIClient(raise_request_exception=False)
        without = APIClient(raise_request_exception=False)
        differences = []
        for path in every_route():
            if path in LINK_PATHS:
                continue
            for method in METHODS:
                a = getattr(with_link, method)(path, {}, format="json", **with_token(self.token))
                b = getattr(without, method)(path, {}, format="json")
                # The status must match everywhere. The bytes must match too wherever the answer is JSON (the
                # API); an HTML page such as the admin sign-in embeds a fresh CSRF token on every request.
                is_json = "json" in a.get("Content-Type", "") or "json" in b.get("Content-Type", "")
                if a.status_code != b.status_code or (is_json and a.content != b.content):
                    differences.append((method.upper(), path, a.status_code, b.status_code))

        self.assertEqual(differences, [])

    def test_the_link_routes_are_the_only_ones_that_use_the_token_and_they_ignore_sessions(self):
        client = APIClient(raise_request_exception=False)
        client.force_login(self.owner)  # a real team session, and no token

        for path in LINK_PATHS:
            for method in METHODS:
                response = getattr(client, method)(path, {}, format="json")
                self.assertIn(response.status_code, (404, 405, 429), (method, path))

    def test_the_link_routes_only_allow_what_they_are_for(self):
        client = APIClient(raise_request_exception=False)
        for method in ("put", "patch", "delete"):
            for path in LINK_PATHS:
                response = getattr(client, method)(path, {}, format="json", **with_token(self.token))
                self.assertIn(response.status_code, (404, 405), (method, path))
        # reading the list is allowed; writing to it is not
        self.assertIn(client.post(LINK_QUESTIONS, {}, format="json", **with_token(self.token)).status_code, (404, 405))
