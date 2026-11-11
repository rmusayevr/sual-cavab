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

    What this depends on (each is tested in core/test_exact_throttles.py):
    - No transaction around the whole request. Inside one, the lock would last until it ends: with
      ATOMIC_REQUESTS on, a second draft would wait for the first draft to finish.
    - READ COMMITTED (PostgreSQL's default), so the read inside the lock sees the previous holder's commit.
    - The cache table exists. If it does not, the check raises (a 500) and nobody gets through: it fails closed.
    There is no lock timeout. Nothing holds the lock for long, so a wait only means another check is running.

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
