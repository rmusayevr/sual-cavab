"""config/dburl.py (#10): one URL in, a DATABASES entry out, and no surprises."""

import os
import subprocess
import sys
from pathlib import Path

from urllib.parse import quote

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from config.dburl import database_from_url
from core.testing import invented_password

PW = invented_password()


class ParseTests(SimpleTestCase):
    def test_a_full_url_becomes_a_databases_entry(self):
        entry = database_from_url(f"postgresql://sual_user:{PW}@dpg-abc123-a:5433/sual_db")
        self.assertEqual(
            entry,
            {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": "sual_db",
                "USER": "sual_user",
                "PASSWORD": PW,
                "HOST": "dpg-abc123-a",
                "PORT": "5433",
            },
        )

    def test_postgres_scheme_and_default_port(self):
        entry = database_from_url("postgres://u:p@db.example.invalid/name")
        self.assertEqual((entry["HOST"], entry["PORT"], entry["NAME"]), ("db.example.invalid", "5432", "name"))

    def test_special_characters_in_the_password_are_decoded(self):
        awkward = "pa$@:/ss" + PW  # a "$", "@", ":" or "/" in a password must survive
        entry = database_from_url(f"postgresql://u:{quote(awkward, safe='')}@host/name")
        self.assertEqual(entry["PASSWORD"], awkward)

    def test_sslmode_is_passed_on(self):
        entry = database_from_url("postgresql://u:p@host/name?sslmode=require")
        self.assertEqual(entry["OPTIONS"], {"sslmode": "require"})

    def test_whitespace_around_the_url_is_ignored(self):
        self.assertEqual(database_from_url("  postgresql://u:p@host/name \n")["NAME"], "name")


class RefusalTests(SimpleTestCase):
    def refused(self, url):
        with self.assertRaises(ImproperlyConfigured) as caught:
            database_from_url(url)
        message = str(caught.exception)
        self.assertIn("DJANGO_DATABASE_URL", message)
        self.assertNotIn(PW, message)  # never echoes the password back
        return message

    def test_another_scheme_is_refused(self):
        self.refused(f"mysql://u:{PW}@host/name")
        self.refused(f"http://u:{PW}@host/name")

    def test_a_missing_host_or_database_name_is_refused(self):
        self.refused(f"postgresql://u:{PW}@/name")
        self.refused(f"postgresql://u:{PW}@host")
        self.refused(f"postgresql://u:{PW}@host/")

    def test_a_bad_port_is_refused(self):
        self.refused(f"postgresql://u:{PW}@host:notaport/name")

    def test_an_unsupported_option_is_refused_not_ignored(self):
        self.assertIn("'options'", self.refused(f"postgresql://u:{PW}@host/name?options=-c%20x"))

    def test_an_option_without_a_value_is_refused_not_dropped(self):
        self.assertIn("'sslmode'", self.refused(f"postgresql://u:{PW}@host/name?sslmode="))
        self.assertIn("'foo'", self.refused(f"postgresql://u:{PW}@host/name?foo"))

    def test_nonsense_is_refused(self):
        self.refused("not a url")
        self.refused("")


class SettingsUseItTests(SimpleTestCase):
    """The settings take DJANGO_DATABASE_URL when it is set, and POSTGRES_* otherwise."""

    def database_with(self, **env):
        base = {k: v for k, v in os.environ.items() if k != "DJANGO_DATABASE_URL"}
        code = (
            "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); "
            "from django.conf import settings; import json; d = settings.DATABASES['default']; "
            "print(json.dumps({k: d[k] for k in ('NAME', 'HOST', 'PORT')}))"
        )
        result = subprocess.run(
            [sys.executable, "-c", code], cwd=Path(settings.BASE_DIR), env={**base, **env}, capture_output=True, text=True, timeout=120
        )
        return result

    def test_the_url_wins_when_it_is_set(self):
        result = self.database_with(DJANGO_DATABASE_URL="postgresql://u:p@from-url.invalid:6543/urldb")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"NAME": "urldb"', result.stdout)
        self.assertIn('"HOST": "from-url.invalid"', result.stdout)
        self.assertIn('"PORT": "6543"', result.stdout)

    def test_an_unreadable_url_stops_the_server_before_it_starts(self):
        result = self.database_with(DJANGO_DATABASE_URL="mysql://u:p@host/name")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DJANGO_DATABASE_URL must start with postgresql://", result.stderr)

    def test_a_common_database_url_in_the_shell_is_ignored(self):
        # A DATABASE_URL meant for another project must not redirect this one.
        result = self.database_with(DATABASE_URL="postgresql://u:p@other-project.invalid:1/otherdb", POSTGRES_DB="mine", POSTGRES_HOST="mine.invalid")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"NAME": "mine"', result.stdout)
        self.assertNotIn("other-project", result.stdout)
