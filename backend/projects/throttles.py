from django.core.cache import caches
from rest_framework.throttling import SimpleRateThrottle

from core.throttles import ExactCountMixin


class MemberAddThrottle(ExactCountMixin, SimpleRateThrottle):
    """Limits 'add member' attempts per signed-in user.

    A 201 versus a 400 on POST .../members/ tells the caller whether an email
    has an account. The owner accepted that for v1 (review of #19) on the
    condition that attempts are limited per user, so it can't be used to list
    accounts in bulk. Every attempt counts, successful or not: the failed
    guesses are the signal.
    """

    scope = "member_add"

    @property
    def cache(self):
        # The shared, database-backed alias (settings.CACHES["throttle"]), so
        # the counters survive restarts and are the same for every worker.
        return caches["throttle"]

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
