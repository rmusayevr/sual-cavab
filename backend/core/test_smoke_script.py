"""scripts/smoke_test.py (#10), run against a real server with the demo data."""

import importlib.util
import io
import os
from pathlib import Path
from unittest import mock

from django.conf import settings
from django.core.cache import caches
from django.core.management import call_command
from django.test import LiveServerTestCase

PASSWORD = "invented-demo-password-xyz"
SCRIPT = Path(settings.BASE_DIR).parent / "scripts" / "smoke_test.py"


def load_script():
    spec = importlib.util.spec_from_file_location("smoke_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SmokeScriptTests(LiveServerTestCase):
    # 127.0.0.1, not "localhost": on Windows "localhost" tries ::1 first and every
    # request waited about two seconds (20 s a test).
    host = "127.0.0.1"

    def setUp(self):
        caches["throttle"].clear()
        with mock.patch.dict(os.environ, {"DJANGO_DEMO_DATA": "1", "DEMO_PASSWORD": PASSWORD}):
            call_command("load_demo_data", stdout=io.StringIO())
        self.smoke = load_script()

    def run_script(self, password=PASSWORD):
        lines = []
        failures = self.smoke.run(self.live_server_url, password, out=lines.append)
        return failures, "\n".join(lines)

    def test_every_check_passes_against_a_site_with_the_demo_data(self):
        failures, output = self.run_script()
        # /login is a page of the Next.js frontend: Django alone answers 404 there.
        self.assertEqual([l for l in output.splitlines() if l.startswith("FAIL")], ["FAIL the sign-in page is served  (404)"])
        self.assertEqual(failures, 1, output)

    def test_it_fails_with_the_wrong_password(self):
        failures, output = self.run_script(password="not-the-demo-password")
        self.assertGreater(failures, 3, output)
        self.assertIn("FAIL the demo owner can sign in", output)

    def test_a_site_that_is_not_there_fails_at_once_instead_of_crashing_or_waiting(self):
        lines = []
        failures = self.smoke.run("http://127.0.0.1:9", PASSWORD, out=lines.append)
        self.assertEqual(failures, 1)
        self.assertIn("FAIL the site answers", "\n".join(lines))

    def test_the_password_is_never_printed(self):
        _, output = self.run_script()
        self.assertNotIn(PASSWORD, output)
        _, output = self.run_script(password="not-the-demo-password")
        self.assertNotIn("not-the-demo-password", output)

    def test_it_asks_for_the_password_and_a_url(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SMOKE_PASSWORD", None)
            self.assertEqual(self.smoke.main(["smoke_test.py", "http://example.invalid"]), 2)
        with mock.patch.dict(os.environ, {"SMOKE_PASSWORD": PASSWORD}):
            self.assertEqual(self.smoke.main(["smoke_test.py"]), 2)


class SmokeScriptWithoutDemoDataTests(LiveServerTestCase):
    """A site that is up but was never given the demo data must not pass."""

    host = "127.0.0.1"  # see SmokeScriptTests

    def test_it_fails_when_the_demo_accounts_and_projects_are_missing(self):
        smoke = load_script()
        lines = []
        failures = smoke.run(self.live_server_url, PASSWORD, out=lines.append)
        output = "\n".join(lines)
        self.assertIn("FAIL the demo owner can sign in", output)
        self.assertIn("FAIL Demo: Ticketing platform: 3 still open on the project list", output)
        self.assertGreater(failures, 3, output)
