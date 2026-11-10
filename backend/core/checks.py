from django.conf import settings
from django.core.checks import Tags, Warning, register
from django.db import connections

DATABASE_CACHE = "django.core.cache.backends.db.DatabaseCache"


@register(Tags.database)
def cache_tables_exist(app_configs, databases=None, **kwargs):
    """
    Name a missing cache table and the command that creates it (#47).

    The throttles (settings.CACHES["throttle"], a database cache table) count attempts at sign-in, at
    adding a member and at drafting. Without the table those requests answer a bare 500 (with drafting
    switched off too: the throttle runs before the handler), and the cause is one setup step,
    `createcachetable`, that only the README and the deploy command mention.

    A WARNING, not an error, on purpose: `migrate` runs the database checks before `createcachetable`
    makes the table on a new database (render.yaml runs them in that order), so on a first deploy or a
    first local setup the warning shows once, one command before it is fixed. An error would stop that
    first deploy. Database checks run with `manage.py check --database default` and with `migrate`.

    If the database cannot be looked at, say so (core.W002) rather than report a clean result. A database
    host that does not answer can make this wait as long as the operating system's connect timeout
    (minutes): `migrate` and every other command that connects wait the same.
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
        except Exception as error:  # noqa: BLE001 - whatever stops us looking is reported, not raised
            messages.append(
                Warning(
                    f"Could not check that the cache table {table!r} (CACHES[{alias!r}]) exists: "
                    f"the database could not be read ({type(error).__name__}).",
                    hint="Check the database settings and that the database is running.",
                    id="core.W002",
                )
            )
            return messages
        if table not in existing:
            messages.append(
                Warning(
                    f"The cache table {table!r} (CACHES[{alias!r}]) does not exist, so signing in, adding "
                    "members and drafting answer a server error (500).",
                    hint="Run: python manage.py createcachetable (a new database needs it once, after migrate)",
                    id="core.W001",
                )
            )
    return messages
