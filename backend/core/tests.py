import os
import subprocess
import sys
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from core.testing import invented_password


class DatabaseTests(TestCase):
    """Fails loudly when the suite is not really talking to PostgreSQL."""

    def test_database_is_postgresql_and_reachable(self):
        self.assertEqual(connection.vendor, "postgresql")
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            self.assertEqual(cursor.fetchone(), (1,))

    def test_the_database_in_use_is_the_one_configured_for_this_run(self):
        # The wiring: Django created and uses the database the settings name. That the name carries
        # the process's own id is checked in a fresh process (core.tests.TestDatabaseNameTests).
        # A TestCase, so the test database exists whichever tests were selected (#42).
        # Compared with the configured name, not os.getpid(): a --parallel worker has its own
        # id and connects to a clone named <configured name>_<n> (review of #59).
        name = connection.settings_dict["NAME"]
        default = settings.DATABASES["default"]
        configured = default.get("TEST", {}).get("NAME") or default["NAME"]  # under --keepdb Django's own name
        self.assertTrue(name == configured or name.startswith(configured + "_"), (name, configured))


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
        password = invented_password()
        encoded = make_password(password)
        self.assertTrue(encoded.startswith("md5$"))
        self.assertTrue(check_password(password, encoded))
        self.assertFalse(check_password(invented_password(), encoded))

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


class TestDatabaseNameTests(SimpleTestCase):
    """Each `manage.py test` process has its own test database (#42).

    With one shared name, `--noinput` makes a second run delete the database the
    first run is using: 18 to 20 errors in the first run when started 1.5 to 2.8
    seconds apart, a failed database creation when started together.
    """

    def seen_by(self, argv="['manage.py', 'test']", **env):
        """The test database name a fresh process gets, and that process's id."""
        code = (
            "import os, sys; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
            f"sys.argv = {argv}; "
            "from django.conf import settings; "
            "print('TESTNAME=' + settings.DATABASES['default'].get('TEST', {}).get('NAME', '')); "
            "print('PID=' + str(os.getpid()))"
        )
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=Path(settings.BASE_DIR),
            env={**{k: v for k, v in os.environ.items() if k != "DJANGO_DATABASE_URL"}, "PYTHONIOENCODING": "utf-8", **env},
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        # Looked up by prefix, so extra output or a space in a name cannot shift what is read.
        lines = {line.split("=", 1)[0]: line.split("=", 1)[1] for line in result.stdout.splitlines() if "=" in line}
        return lines["TESTNAME"], lines["PID"]

    def test_the_name_ends_with_the_processs_own_id(self):
        name, pid = self.seen_by()
        self.assertTrue(name.startswith("test_"), name)
        self.assertTrue(name.endswith(f"_{pid}"), (name, pid))

    def test_two_test_runs_get_different_database_names(self):
        self.assertNotEqual(self.seen_by()[0], self.seen_by()[0])

    def test_a_long_database_name_still_fits_postgresql_and_keeps_the_id(self):
        # PostgreSQL cuts a name at 63 characters without a word; Django then refuses it,
        # and the cut name has lost the end of the process id (review of #59).
        name, pid = self.seen_by(POSTGRES_DB="sual_cavab_" + "x" * 44)
        self.assertLessEqual(len(name), 63 - 4, name)  # 4: room for a --parallel clone's _<n>
        self.assertTrue(name.startswith("test_sual_cavab_x"), name)
        self.assertTrue(name.endswith(f"_{pid}"), (name, pid))

    def test_a_name_with_a_space_is_read_whole(self):
        # The probe once read output by splitting on spaces, so a name with one was taken for "no name".
        name, pid = self.seen_by(POSTGRES_DB="has space")
        self.assertEqual(name, f"test_has space_{pid}")

    def test_the_limit_counts_bytes_not_characters(self):
        # PostgreSQL's 63 is bytes: 44 letters of "ə" are 88 bytes.
        name, pid = self.seen_by(POSTGRES_DB="sual_cavab_" + "ə" * 44)
        self.assertLessEqual(len(name.encode()), 63 - 4, name)
        self.assertTrue(name.endswith(f"_{pid}"), (name, pid))

    def test_keepdb_keeps_the_one_shared_name(self):
        # --keepdb exists to find last run's database; a name that changes every run never does.
        # argparse accepts any unambiguous start of a long option, so --keep and --keepd are keepdb too.
        for flag in ("--keepdb", "--keepd", "--keep", "--k"):
            with self.subTest(flag=flag):
                self.assertEqual(self.seen_by(argv=f"['manage.py', 'test', '{flag}']")[0], "")

    def test_k_is_a_test_name_filter_not_keepdb(self):
        # In Django's test runner -k PATTERN selects tests by name; it does not keep the database.
        for argv in ("['manage.py', 'test', '-k', 'test_health']", "['manage.py', 'test', '-ktest_health']"):
            with self.subTest(argv=argv):
                name, pid = self.seen_by(argv=argv)
                self.assertTrue(name.endswith(f"_{pid}"), (name, pid))

    def test_a_server_keeps_djangos_default_test_name(self):
        for command in ("runserver", "shell", "check", "migrate"):
            with self.subTest(command=command):
                self.assertEqual(self.seen_by(argv=f"['manage.py', '{command}']")[0], "")

    def test_a_test_word_later_in_the_command_line_does_not_count(self):
        self.assertEqual(self.seen_by(argv="['manage.py', 'shell', 'test']")[0], "")


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
