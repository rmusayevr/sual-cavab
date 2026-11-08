import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.urls import reverse


class DatabaseTests(TestCase):
    """Fails loudly when the suite is not really talking to PostgreSQL."""

    def test_database_is_postgresql_and_reachable(self):
        self.assertEqual(connection.vendor, "postgresql")
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            self.assertEqual(cursor.fetchone(), (1,))


class HealthEndpointTests(SimpleTestCase):
    def test_get_returns_ok_status(self):
        response = self.client.get(reverse("health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_post_is_not_allowed(self):
        response = self.client.post(reverse("health"))

        self.assertEqual(response.status_code, 405)


class PasswordHasherTests(SimpleTestCase):
    """The fast hasher is for `manage.py test` only (#25)."""

    def first_hasher_when_loaded_by(self, code):
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=Path(settings.BASE_DIR),
            capture_output=True,
            text=True,
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_tests_run_with_the_fast_hasher(self):
        self.assertEqual(settings.PASSWORD_HASHERS, ["django.contrib.auth.hashers.MD5PasswordHasher"])

    def test_a_password_made_in_a_test_still_checks(self):
        encoded = make_password("invented-test-password")
        self.assertTrue(encoded.startswith("md5$"))
        self.assertTrue(check_password("invented-test-password", encoded))
        self.assertFalse(check_password("another-password", encoded))

    def test_a_server_loading_these_settings_keeps_the_default_hasher(self):
        # What a wsgi/asgi server does: import the settings with no `test` on the command line.
        code = (
            "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
            "from django.conf import settings; print(settings.PASSWORD_HASHERS[0])"
        )
        self.assertEqual(self.first_hasher_when_loaded_by(code), "django.contrib.auth.hashers.PBKDF2PasswordHasher")

    def test_other_manage_py_commands_keep_the_default_hasher(self):
        for command in ("shell", "check", "runserver"):
            with self.subTest(command=command):
                code = (
                    "import os, sys; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
                    f"sys.argv = ['manage.py', '{command}']; "
                    "from django.conf import settings; print(settings.PASSWORD_HASHERS[0])"
                )
                self.assertEqual(
                    self.first_hasher_when_loaded_by(code), "django.contrib.auth.hashers.PBKDF2PasswordHasher"
                )

    def test_a_test_word_later_in_the_command_line_does_not_count(self):
        # `manage.py shell test` is not a test run.
        code = (
            "import os, sys; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
            "sys.argv = ['manage.py', 'shell', 'test']; "
            "from django.conf import settings; print(settings.PASSWORD_HASHERS[0])"
        )
        self.assertEqual(self.first_hasher_when_loaded_by(code), "django.contrib.auth.hashers.PBKDF2PasswordHasher")


class DeployCheckTests(SimpleTestCase):
    """DJANGO_BEHIND_HTTPS=1 makes `manage.py check --deploy` clean (#10)."""

    def deploy_check(self, **env):
        base = {k: v for k, v in os.environ.items() if k not in ("DJANGO_DEBUG", "DJANGO_BEHIND_HTTPS")}
        return subprocess.run(
            [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"],
            cwd=Path(settings.BASE_DIR),
            env={**base, "DJANGO_SECRET_KEY": "k" * 8 + "Zq9x" * 15, "DJANGO_ALLOWED_HOSTS": "api.example.invalid", **env},
            capture_output=True,
            text=True,
            timeout=120,
        )

    def test_a_deployment_with_the_https_switch_on_is_clean(self):
        result = self.deploy_check(DJANGO_DEBUG="0", DJANGO_BEHIND_HTTPS="1")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_the_same_deployment_without_the_switch_is_not(self):
        result = self.deploy_check(DJANGO_DEBUG="0")
        self.assertNotEqual(result.returncode, 0)
        for warning in ("security.W004", "security.W012", "security.W016"):  # HSTS, session cookie, CSRF cookie
            self.assertIn(warning, result.stderr)

    def test_the_switch_does_not_make_django_redirect(self):
        # Only the platform redirects: a Django redirect would loop behind two proxies.
        code = (
            "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
            "from django.conf import settings; print(settings.SECURE_SSL_REDIRECT, settings.SESSION_COOKIE_SECURE, settings.CSRF_COOKIE_SECURE)"
        )
        base = {k: v for k, v in os.environ.items() if k != "DJANGO_BEHIND_HTTPS"}
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=Path(settings.BASE_DIR), env={**base, "DJANGO_BEHIND_HTTPS": "1"}, capture_output=True, text=True, timeout=120
        )
        self.assertEqual(result.stdout.strip(), "False True True", result.stderr)


class AdminSwitchTests(SimpleTestCase):
    """DJANGO_ADMIN_ENABLED=0 removes /admin/ (its sign-in has no rate limit; #10)."""

    def admin_reachable(self, **env):
        base = {k: v for k, v in os.environ.items() if k != "DJANGO_ADMIN_ENABLED"}
        code = (
            "import os, django; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); django.setup(); "
            "from django.urls import Resolver404, resolve\n"
            "try:\n    resolve('/admin/login/'); print('reachable')\n"
            "except Resolver404:\n    print('gone')"
        )
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=Path(settings.BASE_DIR), env={**base, **env}, capture_output=True, text=True, timeout=120
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_the_admin_is_on_by_default(self):
        self.assertEqual(self.admin_reachable(), "reachable")

    def test_the_admin_is_gone_when_switched_off(self):
        for value in ("0", "false", "no"):
            with self.subTest(value=value):
                self.assertEqual(self.admin_reachable(DJANGO_ADMIN_ENABLED=value), "gone")

    def test_the_app_itself_still_works_with_the_admin_off(self):
        self.assertEqual(self.admin_reachable(DJANGO_ADMIN_ENABLED="1"), "reachable")
