"""Django settings for Sual-Cavab.

All deployment-specific values come from environment variables. For local
work, copy `backend/.env.example` to `backend/.env`; values already set in the
real environment win over the file.
"""

import os
import sys
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from drafting.config import DEFAULT_MODEL, validate_drafting_model, validate_sdk_environment

from .dburl import database_from_url

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Load KEY=VALUE lines from `path` into os.environ without overriding."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        os.environ.setdefault(key, value)


_load_dotenv(BASE_DIR / ".env")


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


DEBUG = _env_bool("DJANGO_DEBUG", default=False)

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG is off.")
    SECRET_KEY = "insecure-local-development-only"

ALLOWED_HOSTS = [h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()]
if DEBUG and not ALLOWED_HOSTS:
    ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "core",
    "accounts",
    "projects",
    "questions",
    "drafting",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves collected static files (the admin's CSS and JS) from the app itself (#10).
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# One URL (DJANGO_DATABASE_URL) when a platform hands the database over that way
# (Render does, #10); otherwise the separate POSTGRES_* values.
_DATABASE_URL = os.environ.get("DJANGO_DATABASE_URL", "").strip()
DATABASES = {
    "default": database_from_url(_DATABASE_URL)
    if _DATABASE_URL
    else {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "sual_cavab"),
        "USER": os.environ.get("POSTGRES_USER", "sual_cavab"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# While `manage.py test` runs, hash passwords with a fast hasher. Most tests
# create several users, and Django's default (PBKDF2, 1.5 million iterations,
# about 0.5 s a hash here) made the suite take minutes (#25). This is decided
# from the command line, not from an environment variable, so a running server
# cannot end up with a weak hasher through a stray setting; a test checks that
# any other way of loading these settings keeps the default.
# Known limit: `manage.py test --parallel` on Linux with Python 3.14 starts its
# workers through a forkserver, whose processes see sys.argv == ["-c"], so they
# would hash with PBKDF2. Nothing here uses --parallel; if it is added, the two
# in-process tests in core/tests.py (PasswordHasherTests) fail loudly in the
# workers, and this switch needs another signal for them.
if sys.argv[1:2] == ["test"]:
    PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    # Each test run gets its own database (#42). With one shared name, `--noinput`
    # makes a second run delete the database the first run is using: 18 to 20
    # errors in the first run when started 1.5 to 2.8 seconds apart, a failed
    # database creation when started together. A run that is killed leaves its
    # database behind (see the README for how to drop it).
    # --keepdb keeps Django's one shared name: its whole point is to find last run's
    # database again. It has no short form (-k is Django's test-name filter), and
    # argparse accepts any unambiguous start of a long option, so --keep and --keepd
    # count too. Otherwise a long configured name is cut so the whole name stays
    # within PostgreSQL's 63 BYTES (it would cut a longer one without a word and lose
    # the end of the id), with 4 left for the _<n> that Django adds to the name of a
    # --parallel clone. The id at the end is what makes the name unique.
    if not any(arg.startswith("--k") and "--keepdb".startswith(arg) for arg in sys.argv):
        _pid_suffix = f"_{os.getpid()}"
        _room = 63 - len("test_") - len(_pid_suffix) - 4
        _base = DATABASES["default"]["NAME"].encode()[:_room].decode(errors="ignore")
        DATABASES["default"].setdefault("TEST", {})["NAME"] = f"test_{_base}{_pid_suffix}"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Baku"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"  # `collectstatic` writes here (the deploy's build step)
# Compressed, but without the hashed-name manifest: the manifest storage fails
# any page that names a file `collectstatic` has not run for, which would break
# the admin in tests and local runs.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    # Sign-in throttle counters (#4, owner's decision on #18): in PostgreSQL, so
    # workers read the same counters, restarts keep them, and made-up emails
    # can't push a real account's counter out (the 300-entry in-memory default
    # evicted it). Culling only runs once the table passes MAX_ENTRIES: it then
    # deletes expired rows, and live ones only if still over the limit. Until
    # then expired rows accumulate (follow-up). DRF's update isn't atomic, so
    # simultaneous requests can exceed the rate slightly. Needs
    # `createcachetable`; without the table, sign-in, member-adds and drafting fail closed
    # with a 500, and `manage.py check --database default` (and `migrate`) warn with the
    # command (#47).
    "throttle": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "throttle_cache",
        "OPTIONS": {"MAX_ENTRIES": 1_000_000},
    },
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    # Deny by default (#4): a view that forgets its permissions refuses anonymous users.
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # Sign-in attempts per account (accounts.throttles.LoginPerAccountThrottle).
    "DEFAULT_THROTTLE_RATES": {
        "login": os.environ.get("DJANGO_LOGIN_RATE", "10/min"),
        # 'Add member' attempts per user (projects.throttles.MemberAddThrottle).
        "member_add": os.environ.get("DJANGO_MEMBER_ADD_RATE", "30/hour"),
        # Drafts per user (drafting.throttles.DraftThrottle): each is a paid API call.
        "draft": os.environ.get("DJANGO_DRAFT_RATE", "20/hour"),
    },
    # For any throttle keyed on the client address: how many proxies in front
    # *append* to X-Forwarded-For. Keep 0 (use the connection address) unless
    # something like nginx or a load balancer appends it. Next.js does not
    # append: it passes a client-supplied value through, so 1 behind Next.js
    # alone would trust a forged address (review of #18).
    "NUM_PROXIES": int(os.environ.get("DJANGO_NUM_PROXIES") or 0),
}

# The browser talks to the Next.js origin, which proxies /api to Django, so a
# POST's Origin header is the frontend's. Comma-separated full origins.
CSRF_TRUSTED_ORIGINS = [o.strip() for o in os.environ.get("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",") if o.strip()]
if DEBUG and not CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

# Drafting (#9). A Fable or Mythos model makes the server refuse to start.
# Django's admin (on by default). Its sign-in page has no rate limit; a public
# staging host turns it off (DJANGO_ADMIN_ENABLED=0, #10).
ADMIN_ENABLED = _env_bool("DJANGO_ADMIN_ENABLED", default=True)

DRAFTING_MODEL = validate_drafting_model(os.environ.get("DRAFTING_MODEL") or DEFAULT_MODEL)
validate_sdk_environment(os.environ)

# Drafting logs counts and error class names only (never question text or
# anything the API sent back); this makes those lines reach the server log.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"drafting": {"handlers": ["console"], "level": "INFO"}},
}

# Deployed behind a platform that terminates HTTPS (#10). Set DJANGO_BEHIND_HTTPS=1
# there. It only ever adds protection, so a stray value cannot weaken a server:
# the platform's proxy says "https" in X-Forwarded-Proto, cookies are Secure, and
# browsers are told to insist on HTTPS. `manage.py check --deploy` is clean with
# it on (a test runs exactly that).
# Django does NOT redirect plain HTTP itself (SECURE_SSL_REDIRECT stays off): the
# platform's load balancer already redirects HTTP to HTTPS (Render's docs), and
# the browser reaches Django through the Next.js proxy, a second proxy hop that
# may pass the visitor's X-Forwarded-Proto on as it is. Anything other than the
# exact "https" Django compares with (say "https, https" if a hop appends) would
# turn a Django redirect into a loop on every request. That has not been seen;
# it was not worth risking when the platform already redirects.
if _env_bool("DJANGO_BEHIND_HTTPS"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # One hour while staging settles; raise it once HTTPS is known to work for good.
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS") or 3600)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # Not "preload": that is a promise to browser vendors that lasts a year or
    # more, and does not belong on a staging host with a one-hour HSTS.
    SILENCED_SYSTEM_CHECKS = ["security.W021", "security.W008"]  # W008: the redirect is the platform's
