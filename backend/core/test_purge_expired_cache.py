from datetime import timedelta
from io import StringIO
from pathlib import Path

from django.conf import settings
from django.core.cache import caches
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone

TABLE = "invented_purge_cache_table"
DB_CACHE = "django.core.cache.backends.db.DatabaseCache"


def cache_settings(table=TABLE):
    return {
        "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
        "throttle": {"BACKEND": DB_CACHE, "LOCATION": table},
    }


class PurgeExpiredCacheTests(TestCase):
    """The sign-in throttle's counters live in a database cache table, and Django only culls expired rows once
    the table passes a million (#40). The command removes the expired ones, in bounded batches, safe to run
    twice or at the same time (a start of the service and a wake-up can overlap)."""

    databases = {"default"}

    def setUp(self):
        override = override_settings(CACHES=cache_settings())
        override.enable()
        self.addCleanup(override.disable)
        call_command("createcachetable", TABLE, verbosity=0)

    def add_row(self, key, expired):
        expires = timezone.now() + (timedelta(hours=-1) if expired else timedelta(hours=1))
        with connection.cursor() as cursor:
            cursor.execute(
                f"INSERT INTO {TABLE} (cache_key, value, expires) VALUES (%s, %s, %s)",
                [key, "x", connection.ops.adapt_datetimefield_value(expires)],
            )

    def keys(self):
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT cache_key FROM {TABLE} ORDER BY cache_key")
            return [row[0] for row in cursor.fetchall()]

    def run_command(self, *args):
        out = StringIO()
        call_command("purge_expired_cache", *args, stdout=out, stderr=out)
        return out.getvalue()

    def test_expired_rows_are_removed_and_live_ones_are_kept(self):
        for n in range(3):
            self.add_row(f"old{n}", expired=True)
        for n in range(2):
            self.add_row(f"live{n}", expired=False)

        output = self.run_command()

        self.assertEqual(self.keys(), ["live0", "live1"])
        self.assertIn("removed 3 expired row(s)", output)
        self.assertIn(TABLE, output)

    def test_a_live_counter_still_counts_after_a_purge(self):
        cache = caches["throttle"]
        cache.set("sign-in:ada", [1, 2, 3], timeout=3600)
        self.add_row("old", expired=True)

        self.run_command()

        self.assertEqual(cache.get("sign-in:ada"), [1, 2, 3])
        self.assertEqual(len(self.keys()), 1)

    def test_a_dry_run_counts_and_changes_nothing(self):
        for n in range(4):
            self.add_row(f"old{n}", expired=True)
        self.add_row("live", expired=False)

        output = self.run_command("--dry-run")

        self.assertEqual(len(self.keys()), 5)
        self.assertIn("would remove 4 expired row(s)", output)

    def test_a_second_run_removes_nothing_and_says_so(self):
        self.add_row("old", expired=True)
        self.run_command()

        output = self.run_command()

        self.assertIn("removed 0 expired row(s)", output)

    def test_the_work_is_bounded_and_a_later_run_finishes_it(self):
        for n in range(25):
            self.add_row(f"old{n:02d}", expired=True)

        first = self.run_command("--batch-size", "10", "--max-batches", "2")

        self.assertEqual(len(self.keys()), 5)  # 20 removed: two batches of 10
        self.assertIn("removed 20 expired row(s)", first)
        self.assertIn("5 expired row(s) are left", first)  # said, so a run that stopped early is not mistaken for done

        second = self.run_command("--batch-size", "10", "--max-batches", "2")

        self.assertEqual(self.keys(), [])
        self.assertIn("removed 5 expired row(s)", second)

    def test_a_missing_table_is_skipped_with_the_command_that_creates_it(self):
        with override_settings(CACHES=cache_settings("invented_missing_purge_table")):
            output = self.run_command()

        self.assertIn("does not exist", output)
        self.assertIn("createcachetable", output)

    @override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
    def test_caches_that_are_not_in_the_database_are_left_alone(self):
        output = self.run_command()

        self.assertNotIn("removed", output)
        self.assertIn("no database cache", output.lower())

    def test_a_bad_option_is_refused(self):
        from django.core.management.base import CommandError

        for args in (("--batch-size", "0"), ("--max-batches", "0")):
            with self.subTest(args=args), self.assertRaises(CommandError):
                self.run_command(*args)


class StartCommandTests(TestCase):
    """render.yaml runs the purge at every start (the owner's choice on #40: Render's free tier has no cron,
    and a free service restarts when it wakes)."""

    def start_command(self):
        text = (Path(settings.BASE_DIR).parent / "render.yaml").read_text(encoding="utf-8")
        start = text.index("startCommand: >-")
        lines = [line.strip() for line in text[start:].splitlines()[1:12] if line.strip() and not line.strip().startswith("#")]
        return " ".join(lines)

    def test_it_runs_after_the_table_exists_and_before_the_server_starts(self):
        command = self.start_command()

        self.assertLess(command.index("createcachetable"), command.index("purge_expired_cache"))
        self.assertLess(command.index("purge_expired_cache"), command.index("gunicorn"))

    def test_a_failed_purge_never_keeps_the_site_down(self):
        command = self.start_command()

        self.assertIn("(python manage.py purge_expired_cache ||", command)
        self.assertNotIn("&& python manage.py purge_expired_cache &&", command)
