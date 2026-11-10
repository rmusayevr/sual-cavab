from io import StringIO
from unittest import mock

from django.core.checks import Warning as CheckWarning
from django.core.management import call_command
from django.test import TestCase, override_settings

from django.core.checks.registry import registry

DB_CACHE = "django.core.cache.backends.db.DatabaseCache"


def cache_tables_exist(app_configs, databases=None, **kwargs):
    """The check as Django registered it. The test module must not import core.checks itself: that import
    would register the check even if core/apps.py stopped doing it (review of #95)."""
    registered = [c for c in registry.registered_checks if c.__name__ == "cache_tables_exist"]
    assert registered, "core.checks.cache_tables_exist is not registered: core/apps.py ready() must import it"
    return registered[0](app_configs, databases=databases, **kwargs)


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

    @override_settings(CACHES=caches("invented_missing_cache_table"))
    def test_it_says_what_stops_working_without_the_table_including_drafting(self):
        (message,) = cache_tables_exist(None, databases=["default"])

        for words in ("signing in", "adding members", "drafting"):
            self.assertIn(words, message.msg)

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
    def test_a_database_that_cannot_be_read_is_reported_not_called_clean(self):
        from django.db import OperationalError, connections

        with mock.patch.object(connections["default"].introspection, "table_names", side_effect=OperationalError("down")):
            (message,) = cache_tables_exist(None, databases=["default"])

        self.assertEqual(message.id, "core.W002")
        self.assertIn("invented_missing_cache_table", message.msg)
        self.assertIn("OperationalError", message.msg)

    def test_the_check_is_registered_by_the_app_not_by_this_test_module(self):
        names = [c.__name__ for c in registry.registered_checks]

        self.assertIn("cache_tables_exist", names)

    @override_settings(CACHES=caches("invented_missing_cache_table"))
    def test_a_database_that_is_not_being_checked_is_left_alone(self):
        self.assertEqual(cache_tables_exist(None, databases=None), [])
        self.assertEqual(cache_tables_exist(None, databases=["other"]), [])
