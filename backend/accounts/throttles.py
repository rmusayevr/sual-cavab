import hashlib

from django.core.cache import caches
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
        if not isinstance(email, str) or not normalize_email(email):
            return None  # no account named: nothing to guess, and the view refuses it
        # A fixed-length digest, not the email: the cache key column is
        # varchar(255), and a long email overflowed it, so the write failed
        # silently and that account was never throttled (review of #18).
        ident = hashlib.sha256(normalize_email(email).encode("utf-8")).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}
