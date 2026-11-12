"""scripts/backup_database.py (#35): the parts that keep the database password safe, refuse a dangerous target, and decide
whether a restore matches. Docker and the databases are replaced by fakes here; what the script does against real
databases was checked by hand (README, "Backups and restore")."""

import importlib.util
import io
import os
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock, skipUnless
from urllib.parse import quote

from django.conf import settings
from django.test import SimpleTestCase

from core.testing import invented_password

SCRIPT = Path(settings.BASE_DIR).parent / "scripts" / "backup_database.py"
REPO = Path(settings.BASE_DIR).parent


def load_script():
    spec = importlib.util.spec_from_file_location("backup_database", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BD = load_script()
SECRET = invented_password()  # made per run: a literal here looks like a leaked secret to a scanner (#44)


def url_with(secret=SECRET, user="postgres.invented", host="pooler.example.invalid", tail="/postgres?sslmode=require"):
    return f"postgresql://{user}:{quote(secret, safe='')}@{host}:5432{tail}"


def finished(code=0, out=b"", err=""):
    return SimpleNamespace(returncode=code, stdout=out, stderr=err.encode("utf-8"))


class ParseSourceTests(SimpleTestCase):
    def test_the_address_is_split_into_the_variables_libpq_reads(self):
        self.assertEqual(
            BD.parse_source(url_with()),
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

        self.assertEqual(BD.parse_source(url_with(tricky))["PGPASSWORD"], tricky)

    def test_ssl_defaults_to_required_and_the_last_value_wins(self):
        self.assertEqual(BD.parse_source(url_with(tail="/postgres"))["PGSSLMODE"], "require")
        self.assertEqual(BD.parse_source(url_with(tail="/postgres?sslmode=disable"))["PGSSLMODE"], "disable")
        self.assertEqual(BD.parse_source(url_with(tail="/postgres?sslmode=disable&sslmode=verify-full"))["PGSSLMODE"], "verify-full")

    def test_a_bad_address_is_refused_without_quoting_the_address_or_the_password(self):
        bad = {
            "scheme typo": f"postgresq://u:{SECRET}@host:5432/x",
            "user only": "postgresql://u@host:5432/x",
            "no database": f"postgresql://u:{SECRET}@host:5432",
            "no user": f"postgresql://:{SECRET}@host:5432/x",
            "port not a number": f"postgresql://u:{SECRET}@host:port/x",
            "null character": f"postgresql://u:{SECRET}%00@host:5432/x",
            "not an address": SECRET,
        }
        for label, url in bad.items():
            with self.subTest(label), self.assertRaises(BD.Fail) as caught:
                BD.parse_source(url)
            self.assertNotIn(SECRET, str(caught.exception))
            self.assertNotIn(url, str(caught.exception))


class ReadUrlTests(SimpleTestCase):
    def read(self, env_value=None, backup_file=None, env_file=None):
        with tempfile.TemporaryDirectory() as folder:
            repo = Path(folder)
            (repo / "backend").mkdir()
            if backup_file is not None:
                (repo / "backend" / ".env.backup").write_text(backup_file, encoding="utf-8")
            if env_file is not None:
                (repo / "backend" / ".env").write_text(env_file, encoding="utf-8")
            environ = {} if env_value is None else {"BACKUP_DATABASE_URL": env_value}
            with mock.patch.object(BD, "REPO", repo), mock.patch.dict(os.environ, environ, clear=True):
                return BD.read_url()

    def test_quotes_and_spaces_pasted_around_it_are_removed(self):
        self.assertEqual(self.read(f'  "{url_with()}" '), url_with())

    def test_the_environment_wins_over_the_file(self):
        self.assertEqual(self.read(url_with(), backup_file="BACKUP_DATABASE_URL=postgresql://other:x@h:5432/d\n"), url_with())

    def test_the_file_is_used_when_the_environment_has_nothing(self):
        self.assertEqual(self.read(None, backup_file=f"FOO=1\nBACKUP_DATABASE_URL={url_with()}\n"), url_with())

    def test_backend_dotenv_is_never_read_because_django_loads_it_into_its_environment(self):
        with self.assertRaises(BD.Fail) as caught:
            self.read(None, env_file=f"BACKUP_DATABASE_URL={url_with()}\n")
        self.assertIn(".env.backup", str(caught.exception))

    def test_the_django_database_url_is_never_read(self):
        with self.assertRaises(BD.Fail):
            self.read(None, backup_file=f"DJANGO_DATABASE_URL={url_with()}\n")

    def test_nothing_set_says_where_to_set_it(self):
        with self.assertRaises(BD.Fail) as caught:
            self.read(None, backup_file="FOO=1\n")
        self.assertIn("BACKUP_DATABASE_URL", str(caught.exception))


class SecretHandlingTests(SimpleTestCase):
    def source(self):
        return BD.Source(url_with())

    def test_the_password_is_replaced_in_any_message_in_any_case(self):
        self.assertEqual(BD.scrub(f"bad {SECRET} here", [SECRET]), "bad *** here")
        self.assertEqual(BD.scrub(f"host {SECRET.lower()} {SECRET.upper()}", [SECRET]), "host *** ***")
        self.assertEqual(BD.scrub("nothing here", [SECRET, ""]), "nothing here")

    def test_the_password_is_never_in_the_arguments_handed_to_docker(self):
        args = self.source().exec_args(["sh", "-c", "pg_dump"])
        joined = " ".join(args)

        self.assertNotIn(SECRET, joined)
        self.assertNotIn("pooler.example.invalid", joined)
        for name in ("PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGTZ", "PGOPTIONS"):
            self.assertIn(name, args)  # the NAME is passed; docker takes the value from this process's environment

    def test_the_environment_carries_the_values_and_pins_the_formatting(self):
        environ = self.source().environ()

        self.assertEqual(environ["PGPASSWORD"], SECRET)
        self.assertEqual(environ["PGTZ"], "UTC")
        self.assertEqual(environ["PGOPTIONS"], BD.PINNED)
        self.assertEqual(environ["PGSSLMODE"], "require")

    def test_run_replaces_the_password_in_what_a_command_printed(self):
        with mock.patch.object(BD.subprocess, "run", return_value=finished(1, err=f"could not connect as {SECRET}")):
            code, _, err = BD.run(["x"], secrets=[SECRET])

        self.assertEqual((code, err), (1, "could not connect as ***"))

    def test_run_replaces_the_password_before_it_cuts_the_message_short(self):
        message = "x" * 297 + SECRET
        with mock.patch.object(BD.subprocess, "run", return_value=finished(1, err=message)):
            _, _, err = BD.run(["x"], secrets=[SECRET])

        self.assertEqual(err, "x" * 297 + "***")  # cutting first would leave the start of the password in the message

    def test_a_failed_query_says_so_without_the_password(self):
        with mock.patch.object(BD.subprocess, "run", return_value=finished(2, err=f"FATAL {SECRET}")):
            with self.assertRaises(BD.Fail) as caught:
                BD.query(self.source(), "source", "select 1", "restore_check")

        self.assertNotIn(SECRET, str(caught.exception))

    def test_a_failed_dump_says_so_without_the_password(self):
        with tempfile.TemporaryDirectory() as folder, mock.patch.object(BD.subprocess, "run", return_value=finished(1, err=f"FATAL {SECRET}")):
            with self.assertRaises(BD.Fail) as caught:
                BD.backup(self.source(), Path(folder) / "x.dump")

        self.assertNotIn(SECRET, str(caught.exception))
        self.assertIn("pg_dump failed", str(caught.exception))

    def test_a_bad_address_on_the_command_line_prints_no_secret(self):
        errors = io.StringIO()
        with mock.patch.dict(os.environ, {"BACKUP_DATABASE_URL": f"postgresq://u:{SECRET}@h:1/x"}), redirect_stderr(errors):
            code = BD.main(["backup", "x.dump"])

        self.assertEqual(code, 1)
        self.assertNotIn(SECRET, errors.getvalue())
        self.assertIn("FAILED", errors.getvalue())

    def test_an_unexpected_error_is_reported_by_its_class_only(self):
        errors = io.StringIO()
        with mock.patch.dict(os.environ, {"BACKUP_DATABASE_URL": url_with()}), mock.patch.object(BD, "backup", side_effect=ValueError(f"oops {SECRET}")), redirect_stderr(errors):
            code = BD.main(["backup", "x.dump"])

        self.assertEqual(code, 1)
        self.assertIn("ValueError", errors.getvalue())
        self.assertNotIn(SECRET, errors.getvalue())


class BackupTargetTests(SimpleTestCase):
    def source(self):
        return BD.Source(url_with())

    def refused(self, path, message):
        try:
            with mock.patch.object(BD, "run") as run, self.assertRaises(BD.Fail) as caught:
                BD.backup(self.source(), path)
            run.assert_not_called()
            self.assertIn(message, str(caught.exception))
        finally:
            Path(path).unlink(missing_ok=True)  # a failing test must not leave a file in the repository
            Path(str(path) + ".partial").unlink(missing_ok=True)

    def test_a_dump_in_the_repository_root_is_refused_before_anything_runs(self):
        self.refused(REPO / "staging-test.dump", "inside this repository")

    def test_a_dump_in_a_folder_of_the_repository_is_refused(self):
        self.refused(REPO / "backend" / "staging-test.dump", "inside this repository")

    @skipUnless(os.name == "nt", "a network path only means something on Windows")
    def test_a_network_or_extended_length_path_is_refused(self):
        self.refused(chr(92) * 2 + "localhost" + chr(92) + "share" + chr(92) + "x.dump", "not supported")

    def test_a_folder_that_does_not_exist_is_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            self.refused(Path(folder) / "missing" / "x.dump", "does not exist")

    def test_an_existing_file_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            existing = Path(folder) / "keep.dump"
            existing.write_bytes(b"precious")

            with mock.patch.object(BD, "run") as run, self.assertRaises(BD.Fail):
                BD.backup(self.source(), existing)

            self.assertEqual(existing.read_bytes(), b"precious")
            run.assert_not_called()

    def test_a_partial_file_left_by_an_earlier_attempt_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            partial = Path(folder) / "x.dump.partial"
            partial.write_bytes(b"old")

            with mock.patch.object(BD, "run") as run, self.assertRaises(BD.Fail):
                BD.backup(self.source(), Path(folder) / "x.dump")

            self.assertEqual(partial.read_bytes(), b"old")
            run.assert_not_called()

    def test_a_whole_dump_appears_under_its_name_and_nothing_else_is_left(self):
        def dumping(args, **kwargs):
            kwargs["stdout"].write(b"PGDMP-bytes")
            return 0, "", ""

        with tempfile.TemporaryDirectory() as folder, redirect_stdout(io.StringIO()):
            target = Path(folder) / "new.dump"
            with mock.patch.object(BD, "run", side_effect=dumping):
                BD.backup(self.source(), target)

            self.assertEqual(target.read_bytes(), b"PGDMP-bytes")
            self.assertEqual(sorted(p.name for p in Path(folder).iterdir()), ["new.dump"])

    def test_a_failed_dump_leaves_no_file_at_all(self):
        def failing(args, **kwargs):
            kwargs["stdout"].write(b"half")
            return 1, "", "broken"

        with tempfile.TemporaryDirectory() as folder:
            with mock.patch.object(BD, "run", side_effect=failing), self.assertRaises(BD.Fail):
                BD.backup(self.source(), Path(folder) / "new.dump")

            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_an_unexpected_error_or_an_interruption_leaves_no_file_either(self):
        for error in (RuntimeError("boom"), KeyboardInterrupt()):
            with self.subTest(type(error).__name__), tempfile.TemporaryDirectory() as folder:
                with mock.patch.object(BD, "run", side_effect=error), self.assertRaises(type(error)):
                    BD.backup(self.source(), Path(folder) / "new.dump")

                self.assertEqual(list(Path(folder).iterdir()), [])


class CopyNameTests(SimpleTestCase):
    def test_only_a_new_lower_case_name_made_for_the_purpose_is_accepted(self):
        for good in ("restore_check", "restore_check2", "r", "a" * 63):
            with self.subTest(good):
                BD.check_copy_name(good)
        for bad in ("postgres", "template0", "template1", "sual_cavab", "Restore_Check", "1abc", "_x", "a b", "a;b", "a'b", 'a"b', "a-b", "", "a" * 64, "é"):
            with self.subTest(bad), self.assertRaises(BD.Fail):
                BD.check_copy_name(bad)

    def test_the_command_line_refuses_a_bad_name_before_reading_the_address(self):
        errors = io.StringIO()
        with mock.patch.object(BD, "check") as check, mock.patch.object(BD, "read_url") as read_url, redirect_stderr(errors):
            code = BD.main(["check", "file.dump", "x; DROP DATABASE postgres"])

        self.assertEqual(code, 1)
        check.assert_not_called()
        read_url.assert_not_called()


class CheckTests(SimpleTestCase):
    """check(): what it asks the local database, and how it ends. `local`, `run` and `compare` are fakes."""

    def source(self):
        return BD.Source(url_with())

    def run_check(self, *, exists="0", busy="0", restore_code=0, differences=0, copy="restore_check"):
        asked = []

        def local(sql, database="postgres", container=None):
            asked.append((database, sql))
            if sql == BD.EMPTY_DATABASE:
                return busy
            if "from pg_database where datname" in sql:
                return exists
            return ""

        with tempfile.TemporaryDirectory() as folder:
            dump = Path(folder) / "x.dump"
            dump.write_bytes(b"data")
            with (
                mock.patch.object(BD, "local", side_effect=local),
                mock.patch.object(BD, "run", return_value=(restore_code, "", "restore broke")),
                mock.patch.object(BD, "compare", return_value=differences) as compare,
                redirect_stdout(io.StringIO()),
            ):
                try:
                    code, error = BD.check(self.source(), dump, copy), None
                except BD.Fail as exc:
                    code, error = None, str(exc)
        return code, error, asked, compare

    def test_a_new_copy_is_created_and_its_empty_public_schema_removed_without_cascade(self):
        code, error, asked, compare = self.run_check()

        self.assertEqual((code, error), (0, None))
        sql = [s for _, s in asked]
        self.assertIn("CREATE DATABASE restore_check", sql)
        self.assertIn("DROP SCHEMA IF EXISTS public", sql)
        self.assertFalse([s for s in sql if "CASCADE" in s.upper()])
        self.assertFalse([s for s in sql if s.upper().startswith("DROP DATABASE")])
        compare.assert_called_once()

    def test_an_existing_empty_copy_is_reused_not_created(self):
        code, _, asked, _ = self.run_check(exists="1", busy="0")

        self.assertEqual(code, 0)
        self.assertFalse([s for _, s in asked if s.startswith("CREATE DATABASE")])
        self.assertIn(("restore_check", BD.EMPTY_DATABASE), asked)

    def test_a_copy_that_holds_anything_is_refused_and_nothing_is_dropped(self):
        code, error, asked, compare = self.run_check(exists="1", busy="3")

        self.assertIsNone(code)
        self.assertIn("not an empty database", error)
        self.assertFalse([s for _, s in asked if "DROP" in s.upper()])
        compare.assert_not_called()

    def test_a_failed_restore_says_the_copy_was_left_behind_and_compares_nothing(self):
        code, error, _, compare = self.run_check(restore_code=1)

        self.assertIsNone(code)
        self.assertIn("pg_restore failed", error)
        self.assertIn("DROP DATABASE restore_check", error)
        compare.assert_not_called()

    def test_the_exit_status_is_zero_only_when_nothing_differs(self):
        self.assertEqual(self.run_check(differences=0)[0], 0)
        self.assertEqual(self.run_check(differences=1)[0], 1)
        self.assertEqual(self.run_check(differences=5)[0], 1)

    def test_a_name_that_is_not_a_copy_is_refused_by_check_itself_before_the_database_is_touched(self):
        with tempfile.TemporaryDirectory() as folder:
            dump = Path(folder) / "any.dump"
            dump.write_bytes(b"data")  # a real file, so only the name can be the reason for the refusal
            for name in ("postgres", "template1", "sual_cavab", "Restore_Check"):
                with self.subTest(name), mock.patch.object(BD, "local") as local, self.assertRaises(BD.Fail) as caught:
                    BD.check(self.source(), dump, name)
                local.assert_not_called()
                self.assertNotIn("is not a file", str(caught.exception))

    def test_a_dump_that_is_not_a_file_is_refused_before_the_database_is_touched(self):
        with mock.patch.object(BD, "local") as local, self.assertRaises(BD.Fail):
            BD.check(self.source(), Path(tempfile.gettempdir()) / "no-such-dump-file.dump", "restore_check")

        local.assert_not_called()

    def test_the_emptiness_test_looks_at_relations_functions_schemas_and_templates(self):
        for part in ("pg_class", "pg_proc", "pg_namespace", "datistemplate"):
            self.assertIn(part, BD.EMPTY_DATABASE)


class CompareTests(SimpleTestCase):
    def compare(self, source_rows=None, copy_rows=None, source_schema=None, copy_schema=None, source_tables=("a", "b"), copy_tables=("a", "b")):
        seen = []

        def query(source, side, sql, copy):
            seen.append((side, sql))
            tables = source_tables if side == "source" else copy_tables
            if sql == BD.LIST_TABLES:
                return "\n".join(tables)
            if sql.startswith("select count(*), coalesce(md5(string_agg(t::text"):
                table = sql.split("public.")[1].split(" ")[0].strip('"')
                rows = (source_rows if side == "source" else copy_rows) or {}
                if rows.get(table) == "FAIL":
                    raise BD.Fail("no such table")
                return rows.get(table, "3|aaaaaaaa")
            for name, text in BD.SCHEMA_CHECKS.items():
                if sql == text:
                    schema = (source_schema if side == "source" else copy_schema) or {}
                    return schema.get(name, "7|bbbbbbbb")
            raise AssertionError(f"unexpected query: {sql[:80]}")

        with mock.patch.object(BD, "query", side_effect=query), redirect_stdout(io.StringIO()) as printed:
            problems = BD.compare(BD.Source(url_with()), "restore_check")
        return problems, seen, printed.getvalue()

    def test_identical_sides_have_no_differences(self):
        problems, _, printed = self.compare()

        self.assertEqual(problems, 0)
        self.assertIn("differences: 0", printed)

    def test_a_table_whose_contents_differ_is_counted(self):
        problems, _, printed = self.compare(copy_rows={"b": "3|cccccccc"})

        self.assertEqual(problems, 1)
        self.assertIn("DIFF b", printed)

    def test_a_table_with_another_row_count_is_counted(self):
        self.assertEqual(self.compare(copy_rows={"a": "4|aaaaaaaa"})[0], 1)

    def test_a_table_missing_from_the_copy_is_counted_with_its_reason(self):
        problems, _, printed = self.compare(copy_rows={"b": "FAIL"}, copy_tables=("a",))

        self.assertEqual(problems, 2)  # the list of tables and the table itself
        self.assertIn("missing or unreadable", printed)

    def test_every_kind_of_schema_difference_is_counted(self):
        for name in BD.SCHEMA_CHECKS:
            with self.subTest(name):
                problems, _, printed = self.compare(copy_schema={name: "7|dddddddd"})
                self.assertEqual(problems, 1)
                self.assertIn(f"DIFF {name}", printed)

    def test_several_differences_are_all_counted(self):
        problems, _, _ = self.compare(copy_rows={"a": "9|x", "b": "9|y"}, copy_schema={"columns": "1|z", "views": "1|z"})

        self.assertEqual(problems, 4)

    def test_a_source_with_no_tables_is_an_error_not_a_pass(self):
        with self.assertRaises(BD.Fail):
            self.compare(source_tables=(), copy_tables=())

    def test_the_checksums_do_not_depend_on_the_servers_sort_order(self):
        _, seen, _ = self.compare()

        row_checks = [sql for _, sql in seen if sql.startswith("select count(*), coalesce(md5(string_agg(t::text")]
        self.assertTrue(row_checks)
        for sql in row_checks:
            self.assertIn('collate "C"', sql)
        for name, sql in BD.SCHEMA_CHECKS.items():
            self.assertIn('collate "C"', sql, name)

    def test_every_check_runs_on_both_sides(self):
        _, seen, _ = self.compare()

        for name, sql in BD.SCHEMA_CHECKS.items():
            self.assertEqual(sorted(side for side, s in seen if s == sql), ["copy", "source"], name)
        self.assertEqual(
            sorted(BD.SCHEMA_CHECKS),
            ["columns", "constraints", "functions", "indexes", "sequences", "table options", "triggers", "views"],
        )

    def test_a_table_name_is_quoted(self):
        self.assertEqual(BD.quoted("plain"), '"plain"')
        self.assertEqual(BD.quoted('odd"name'), '"odd""name"')
