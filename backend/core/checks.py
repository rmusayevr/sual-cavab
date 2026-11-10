from django.conf import settings
from django.core.checks import Tags, Warning, register
from django.db import connections

DATABASE_CACHE = "django.core.cache.backends.db.DatabaseCache"


@register(Tags.database)
def cache_tables_exist(app_configs, databases=None, **kwargs):
    """
    Name a missing cache table and the command that creates it (#47).

    Sign-in and member-adds count attempts in a database cache table (settings.CACHES["throttle"]).
    Without the table they answer a bare 500, and the cause is one setup step, `createcachetable`,
    that only the README and the deploy command mention.

    A WARNING, not an error, on purpose: `migrate` runs the database checks before `createcachetable`
    makes the table on a new database (render.yaml runs them in that order), and an error here would stop
    that first deploy. Database checks run with `manage.py check --database default` and with `migrate`.

    Quiet when the database cannot be reached: the other checks and the commands themselves say so.
    """
    if not databases or "default" not in databases:
        return []  # the cache tables are in the default database; nothing to look at otherwise
    messages = []
    for alias, config in settings.CACHES.items():
        if config.get("BACKEND") != DATABASE_CACHE:
            continue
        table = config["LOCATION"]
        try:
            existing = connections["default"].introspection.table_names()
        except Exception:  # noqa: BLE001 - an unreachable database is not this check's finding
            return []
        if table not in existing:
            messages.append(
                Warning(
                    f"The cache table {table!r} (CACHES[{alias!r}]) does not exist, so sign-in and "
                    "adding members answer a server error (500).",
                    hint="Run: python manage.py createcachetable",
                    id="core.W001",
                )
            )
    return messages
