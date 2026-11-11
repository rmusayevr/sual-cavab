import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.utils import timezone

DATABASE_CACHE = "django.core.cache.backends.db.DatabaseCache"


class Command(BaseCommand):
    help = (
        "Delete the expired rows of the database cache tables (the sign-in, member-add and drafting throttle "
        "counters), in bounded batches (#40). Django only culls expired rows once a table passes a million."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count the expired rows; delete nothing.")
        parser.add_argument("--batch-size", type=int, default=1000, help="Rows deleted per statement (default 1000).")
        parser.add_argument(
            "--max-batches",
            type=int,
            default=100,
            help="Most statements per cache table in one run (default 100): the work is bounded, and a later run "
            "finishes what is left.",
        )

    def handle(self, *args, **options):
        batch_size, max_batches, dry_run = options["batch_size"], options["max_batches"], options["dry_run"]
        if batch_size < 1 or max_batches < 1:
            raise CommandError("--batch-size and --max-batches must be 1 or more.")
        connection = connections["default"]  # where the cache tables are (core.checks looks there too)
        tables = [(alias, c["LOCATION"]) for alias, c in settings.CACHES.items() if c.get("BACKEND") == DATABASE_CACHE]
        if not tables:
            self.stdout.write("No database cache is configured: nothing to purge.")
            return
        existing = connection.introspection.table_names()
        quote = connection.ops.quote_name
        for alias, table in tables:
            if table not in existing:
                self.stderr.write(
                    f"{alias}: the cache table {table!r} does not exist: run python manage.py createcachetable"
                )
                continue
            started = time.monotonic()
            now = connection.ops.adapt_datetimefield_value(timezone.now())
            name = quote(table)
            if dry_run:
                with connection.cursor() as cursor:
                    cursor.execute(f"SELECT COUNT(*) FROM {name} WHERE expires < %s", [now])
                    count = cursor.fetchone()[0]
                self.stdout.write(f"{alias}: would remove {count} expired row(s) from {table} (dry run, nothing deleted)")
                continue
            removed = batches = 0
            while batches < max_batches:
                with connection.cursor() as cursor:
                    # A bounded delete. The outer "expires < now" is re-checked when the row is locked: a counter that
                    # was renewed after the subselect picked it (its expiry moved to the future) must not be deleted.
                    cursor.execute(
                        f"DELETE FROM {name} WHERE expires < %s AND cache_key IN "
                        f"(SELECT cache_key FROM {name} WHERE expires < %s LIMIT %s)",
                        [now, now, batch_size],
                    )
                    deleted = cursor.rowcount
                batches += 1
                removed += deleted
                if deleted < batch_size:
                    break
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {name} WHERE expires < %s", [now])
                left = cursor.fetchone()[0]
            message = (
                f"{alias}: removed {removed} expired row(s) from {table} in {batches} batch(es), "
                f"{time.monotonic() - started:.2f} s"
            )
            if left:
                message += f"; {left} expired row(s) are still there (run it again)"
            self.stdout.write(message)
