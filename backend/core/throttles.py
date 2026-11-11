from django.db import connections, transaction


class ExactCountMixin:
    """Make a DRF throttle's count exact when requests arrive at the same moment (#41).

    DRF reads the history from the cache, decides, then writes it back. Two requests that both read before
    either writes both get in, so a burst could pass more than the limit, and every extra worker widens the
    gap. This holds a PostgreSQL advisory lock named after the throttle's cache key for the length of that read
    and write: requests for the same key (one account, one user) take turns, and every other key is untouched.
    The lock is shared by all workers because it lives in the database, and it is released at the end of the
    transaction opened here, a few milliseconds later; the request itself (a draft can run for minutes) is not
    inside it. Without PostgreSQL there is nothing to lock with and the count is DRF's own.

    Put it first in the bases: `class MyThrottle(ExactCountMixin, SimpleRateThrottle)`.
    """

    def allow_request(self, request, view):
        key = self.get_cache_key(request, view)
        connection = connections["default"]  # where the cache table lives (core.checks looks there too)
        if key is None or connection.vendor != "postgresql":
            return super().allow_request(request, view)
        with transaction.atomic(using="default"):
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [key])
            return super().allow_request(request, view)
