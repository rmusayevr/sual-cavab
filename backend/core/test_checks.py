from io import StringIO

from django.core.checks import Warning as CheckWarning
from django.core.management import call_command
from django.test import TestCase, override_settings

from core.checks import cache_tables_exist

DB_CACHE = "django.core.cache.backends.db.DatabaseCache"


def caches(table):
    return {
        "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
        "throttle": {"BACKEND": DB_CACHE, "LOCATION": table},
    }


class CacheTableCheckTests(TestCase):
    """Without the throttle cache table, sign-in and member-adds answer a bare 500 (#47). The check names
    the table and the command that creates it, so the cause is one line away."""

    databases = {"default"}

    @override_settings(CACHES=caches("invented_missing_cache_table"))
    def test_a_missing_table_is_named_with_the_command_that_creates_it(self):
        messages = cache_tables_exist(None, databases=["default"])

        self.assertEqual(len(messages), 1)
        message = messages[0]
        self.assertEqual(message.id, "core.W001")
        self.assertIn("invented_missing_cache_table", message.msg)
        self.assertIn("throttle", message.msg)  # the cache's alias, to find it in the settings
        self.assertIn("python manage.py createcachetable", message.hint)

    def test_a_table_that_exists_is_not_reported(self):
        with override_settings(CACHES=caches("invented_present_cache_table")):
            call_command("createcachetable", "invented_present_cache_table", verbosity=0)

            self.assertEqual(cache_tables_exist(None, databases=["default"]), [])

    @override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
    def test_caches_that_are_not_in_the_database_are_ignored(self):
        self.assertEqual(cache_tables_exist(None, databases=["default"]), [])

    @override_settings(CACHES=caches("invented_missing_cache_table"))
    def test_it_is_a_warning_so_a_first_deploy_can_still_migrate_and_then_create_the_table(self):
        # `migrate` runs the database checks BEFORE `createcachetable` makes the table on a new database
        # (render.yaml runs them in that order); an error here would stop that first deploy.
        (message,) = cache_tables_exist(None, databases=["default"])

        self.assertIsInstance(message, CheckWarning)

    @override_settings(CACHES=caches("invented_missing_cache_table"))
    def test_manage_py_check_with_the_database_option_shows_it(self):
        err = StringIO()

        call_command("check", databases=["default"], stdout=StringIO(), stderr=err)

        self.assertIn("core.W001", err.getvalue())
        self.assertIn("python manage.py createcachetable", err.getvalue())

    @override_settings(CACHES=caches("invented_missing_cache_table"))
    def test_a_database_that_is_not_being_checked_is_left_alone(self):
        self.assertEqual(cache_tables_exist(None, databases=None), [])
        self.assertEqual(cache_tables_exist(None, databases=["other"]), [])
