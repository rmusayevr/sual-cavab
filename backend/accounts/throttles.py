import functools
import hashlib
import math
import unicodedata

from django.core.cache import caches
from django.http import HttpResponse
from django.utils.cache import add_never_cache_headers
from rest_framework.throttling import SimpleRateThrottle

from .models import normalize_email


class LoginPerAccountThrottle(SimpleRateThrottle):
    """Limits sign-in attempts per account (normalized email), not per address.

    Behind the Next.js /api proxy every request reaches Django from the same
    address, and X-Forwarded-For is client-controlled, so a per-IP limit is
    either one bucket for everyone or trivially reset (review of #18). Keying
    on the email stops password guessing against any account; the most it lets
    someone do is lock one known email for a minute. Owner's decision on #18.
    """

    scope = "login"

    @property
    def cache(self):
        # Its own cache alias (settings.CACHES["throttle"]): counters must be
        # shared by all workers and must not be evictable by an attacker.
        return caches["throttle"]

    def get_cache_key(self, request, view):
        email = request.data.get("email") if hasattr(request.data, "get") else None
        return self.key_for(email)

    def key_for(self, email):
        if not isinstance(email, str) or not normalize_email(email):
            return None  # no account named: nothing to guess, and the view refuses it
        # A fixed-length digest, not the email: the cache key column is
        # varchar(255), and a long email overflowed it, so the write failed
        # silently and that account was never throttled (review of #18).
        ident = hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class AdminLoginThrottle(LoginPerAccountThrottle):
    """The same counter and rate, for Django's admin sign-in form (#45).

    The form names the account in `username` (the email). Same scope, same cache, same key as the app's own
    sign-in, so guesses at /admin/ and at /api/auth/login/ draw on ONE budget per account: switching pages is
    not a second ten attempts a minute."""

    def get_cache_key(self, request, view):
        username = request.POST.get("username")
        if isinstance(username, str):
            # The admin form folds the username with NFKC before it signs in (UsernameField.to_python), so a
            # fullwidth "a" signs in as "a". Count what the form will authenticate, or every spelling is a
            # fresh budget (review of #102).
            username = unicodedata.normalize("NFKC", username)
        return self.key_for(username)


def protect_admin_login(site):
    """Put AdminLoginThrottle in front of the admin site's sign-in view (a POST is an attempt; showing the
    page is not). Safe to call twice. Done when the app loads, before the admin URLs are built."""
    if getattr(site.login, "throttled", False):
        return
    original = site.login

    @functools.wraps(original)
    def login(request, *args, **kwargs):
        if request.method == "POST":
            throttle = AdminLoginThrottle()
            if not throttle.allow_request(request, None):
                response = HttpResponse(
                    "Too many sign-in attempts. Wait a minute and try again.",
                    status=429,
                    content_type="text/plain; charset=utf-8",
                )
                add_never_cache_headers(response)  # the admin's own login view is never cached either
                wait = throttle.wait()
                if wait:
                    response["Retry-After"] = str(math.ceil(wait))
                return response
        return original(request, *args, **kwargs)

    login.throttled = True
    site.login = login
