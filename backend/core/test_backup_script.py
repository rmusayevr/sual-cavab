"""scripts/backup_database.py (#35): the parts that keep the database password safe and refuse a dangerous target.

No Docker and no database here: what it does against real databases was checked by hand (README, "Backups and restore")."""

import importlib.util
import io
import tempfile
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock
from urllib.parse import quote

from django.conf import settings
from django.test import SimpleTestCase

from core.testing import invented_password

SCRIPT = Path(settings.BASE_DIR).parent / "scripts" / "backup_database.py"


def load_script():
    spec = importlib.util.spec_from_file_location("backup_database", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SCRIPT_MODULE = load_script()
SECRET = invented_password()  # made per run: a literal here looks like a leaked secret to a scanner (#44)


def url_with(secret=SECRET, user="postgres.invented", host="pooler.example.invalid", tail="/postgres?sslmode=require"):
    return f"postgresql://{user}:{quote(secret, safe='')}@{host}:5432{tail}"


class ParseSourceTests(SimpleTestCase):
    def test_the_address_is_split_into_the_variables_libpq_reads(self):
        env = SCRIPT_MODULE.parse_source(url_with())

        self.assertEqual(
            env,
            {
                "PGHOST": "pooler.example.invalid",
                "PGPORT": "5432",
                "PGUSER": "postgres.invented",
                "PGPASSWORD": SECRET,
                "PGDATABASE": "postgres",
                "PGSSLMODE": "require",
            },
        )

    def test_a_password_with_special_characters_is_decoded(self):
        tricky = SECRET + "@:/#?%"

        self.assertEqual(SCRIPT_MODULE.parse_source(url_with(tricky))["PGPASSWORD"], tricky)

    def test_ssl_defaults_to_required_and_can_be_set(self):
        self.assertEqual(SCRIPT_MODULE.parse_source(url_with(tail="/postgres"))["PGSSLMODE"], "require")
        self.assertEqual(SCRIPT_MODULE.parse_source(url_with(tail="/postgres?sslmode=disable"))["PGSSLMODE"], "disable")

    def test_a_bad_address_is_refused_without_quoting_the_address_or_the_password(self):
        bad = {
            "scheme typo": f"postgresq://u:{SECRET}@host:5432/x",
            "user only": "postgresql://u@host:5432/x",
            "no database": f"postgresql://u:{SECRET}@host:5432",
            "no user": f"postgresql://:{SECRET}@host:5432/x",
            "port not a number": f"postgresql://u:{SECRET}@host:port/x",
            "not an address": SECRET,
        }
        for label, url in bad.items():
            with self.subTest(label), self.assertRaises(SCRIPT_MODULE.Fail) as caught:
                SCRIPT_MODULE.parse_source(url)
            message = str(caught.exception)
            self.assertNotIn(SECRET, message)
            self.assertNotIn(url, message)


class ReadUrlTests(SimpleTestCase):
    def read(self, env_value=None, file_text=None):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            if file_text is not None:
                (repo / "backend").mkdir()
                (repo / "backend" / ".env").write_text(file_text, encoding="utf-8")
            environ = {} if env_value is None else {"BACKUP_DATABASE_URL": env_value}
            with mock.patch.object(SCRIPT_MODULE, "REPO", repo), mock.patch.dict("os.environ", environ, clear=True):
                return SCRIPT_MODULE.read_url()

    def test_quotes_and_spaces_pasted_around_it_are_removed(self):
        self.assertEqual(self.read(f'  "{url_with()}" '), url_with())

    def test_the_environment_wins_over_the_env_file(self):
        self.assertEqual(self.read(url_with(), "BACKUP_DATABASE_URL=postgresql://other:x@h:5432/d\n"), url_with())

    def test_the_env_file_is_used_when_the_environment_has_nothing(self):
        self.assertEqual(self.read(None, f"FOO=1\nBACKUP_DATABASE_URL={url_with()}\n"), url_with())

    def test_nothing_set_says_where_to_set_it(self):
        with self.assertRaises(SCRIPT_MODULE.Fail) as caught:
            self.read(None, "FOO=1\n")
        self.assertIn("BACKUP_DATABASE_URL", str(caught.exception))

    def test_the_django_database_url_is_never_read(self):
        with self.assertRaises(SCRIPT_MODULE.Fail):
            self.read(None, f"DJANGO_DATABASE_URL={url_with()}\n")


class SecretHandlingTests(SimpleTestCase):
    def test_the_password_is_replaced_in_any_message(self):
        self.assertEqual(SCRIPT_MODULE.scrub(f"bad option {SECRET} here", [SECRET]), "bad option *** here")
        self.assertEqual(SCRIPT_MODULE.scrub("nothing here", [SECRET, ""]), "nothing here")

    def test_the_password_is_never_in_the_arguments_handed_to_docker(self):
        source = SCRIPT_MODULE.Source(url_with())

        args = source.exec_args(["sh", "-c", "pg_dump"])

        self.assertNotIn(SECRET, " ".join(args))
        self.assertNotIn("pooler.example.invalid", " ".join(args))
        self.assertIn("PGPASSWORD", args)  # the NAME is passed; docker takes the value from this process's environment
        self.assertEqual(source.environ()["PGPASSWORD"], SECRET)

    def test_a_bad_address_on_the_command_line_prints_no_secret(self):
        errors = io.StringIO()
        with mock.patch.dict("os.environ", {"BACKUP_DATABASE_URL": f"postgresq://u:{SECRET}@h:1/x"}), redirect_stderr(errors):
            code = SCRIPT_MODULE.main(["backup", "x.dump"])

        self.assertEqual(code, 1)
        self.assertNotIn(SECRET, errors.getvalue())
        self.assertIn("FAILED", errors.getvalue())


class BackupTargetTests(SimpleTestCase):
    def source(self):
        return SCRIPT_MODULE.Source(url_with())

    def test_a_dump_inside_the_repository_is_refused_before_anything_runs(self):
        inside = Path(settings.BASE_DIR).parent / "staging.dump"

        with mock.patch.object(SCRIPT_MODULE, "run") as run, self.assertRaises(SCRIPT_MODULE.Fail) as caught:
            SCRIPT_MODULE.backup(self.source(), inside)

        self.assertIn("inside this repository", str(caught.exception))
        run.assert_not_called()
        self.assertFalse(inside.exists())

    def test_an_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            existing = Path(folder) / "keep.dump"
            existing.write_bytes(b"precious")

            with mock.patch.object(SCRIPT_MODULE, "run") as run, self.assertRaises(SCRIPT_MODULE.Fail):
                SCRIPT_MODULE.backup(self.source(), existing)

            self.assertEqual(existing.read_bytes(), b"precious")
            run.assert_not_called()

    def test_a_failed_dump_leaves_no_half_written_file(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "new.dump"

            def failing(args, **kwargs):
                kwargs["stdout"].write(b"half")
                return 1, "", f"connection failed for {SECRET}"

            with mock.patch.object(SCRIPT_MODULE, "run", side_effect=failing), self.assertRaises(SCRIPT_MODULE.Fail) as caught:
                SCRIPT_MODULE.backup(self.source(), target)

            self.assertFalse(target.exists())
            self.assertIn("pg_dump failed", str(caught.exception))

    def test_a_copy_name_that_could_carry_sql_is_refused(self):
        with mock.patch.dict("os.environ", {"BACKUP_DATABASE_URL": url_with()}), mock.patch.object(SCRIPT_MODULE, "check") as check:
            errors = io.StringIO()
            with redirect_stderr(errors):
                code = SCRIPT_MODULE.main(["check", "file.dump", "x; DROP DATABASE postgres"])

        self.assertEqual(code, 1)
        check.assert_not_called()

    def test_quoting_a_table_name_doubles_its_quotes(self):
        self.assertEqual(SCRIPT_MODULE.quoted('odd"name'), '"odd""name"')
