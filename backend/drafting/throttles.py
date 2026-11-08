from django.core.cache import caches
from rest_framework.throttling import SimpleRateThrottle


class DraftThrottle(SimpleRateThrottle):
    """Limits drafts per signed-in user: each one is a paid API call.

    Every attempt counts, including ones refused with a 400 or a 404, so the
    endpoint cannot be used to burn money or probe project numbers quickly.
    """

    scope = "draft"

    @property
    def cache(self):
        # The shared, database-backed counters (settings.CACHES["throttle"]).
        return caches["throttle"]

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}
