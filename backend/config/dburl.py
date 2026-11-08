"""Read a database address given as one URL (#10).

A Render Blueprint can hand a service its database only as a connection string
(`postgresql://user:password@host:port/name`), not as separate host and port
values, so the settings accept one. The variable is DJANGO_DATABASE_URL, not the
common DATABASE_URL: a developer's shell may hold a DATABASE_URL for another
project, and the tests must never be pointed at that by accident.
"""

from urllib.parse import parse_qs, unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured

SCHEMES = {"postgres", "postgresql"}
# Query options that are passed on to the PostgreSQL driver as they are.
ALLOWED_OPTIONS = {"sslmode"}


def database_from_url(url):
    """The Django DATABASES entry for `url`. Refuses anything it cannot read, and says why."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port or 5432
    except ValueError:
        raise ImproperlyConfigured("DJANGO_DATABASE_URL is not a valid URL.") from None
    if parts.scheme not in SCHEMES:
        raise ImproperlyConfigured("DJANGO_DATABASE_URL must start with postgresql:// (or postgres://).")
    name = unquote(parts.path.lstrip("/"))
    if not parts.hostname or not name:
        raise ImproperlyConfigured("DJANGO_DATABASE_URL needs a host and a database name.")

    options = {}
    for key, values in parse_qs(parts.query).items():
        if key not in ALLOWED_OPTIONS:
            raise ImproperlyConfigured(f"DJANGO_DATABASE_URL: the option {key!r} is not supported.")
        options[key] = values[-1]

    entry = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": name,
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": parts.hostname,
        "PORT": str(port),
    }
    if options:
        entry["OPTIONS"] = options
    return entry
