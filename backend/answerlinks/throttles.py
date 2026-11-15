from django.core.cache import caches
from rest_framework.throttling import SimpleRateThrottle

from core.throttles import ExactCountMixin

from .models import AnswerLink


class _SharedCache:
    @property
    def cache(self):
        # The shared, database-backed alias (settings.CACHES["throttle"]): the same counters for every worker.
        return caches["throttle"]


class PerLinkThrottle(_SharedCache, ExactCountMixin, SimpleRateThrottle):
    """Counts requests per link, not per address.

    Behind the Next.js proxy every request reaches Django from the same address and X-Forwarded-For is
    client-controlled, so a per-address limit is one bucket for everyone or trivially reset (review of #18).
    A link is what a client holds, so a link is what is counted. Keyed on the link's id, never on the token.
    """

    def get_cache_key(self, request, view):
        if not isinstance(request.auth, AnswerLink):
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.auth.pk}


class LinkReadThrottle(PerLinkThrottle):
    scope = "answer_link_read"


class LinkSubmitThrottle(PerLinkThrottle):
    scope = "answer_link_submit"


class InvalidTokenThrottle(_SharedCache, ExactCountMixin, SimpleRateThrottle):
    """One shared bucket for requests whose token failed. It never counts a valid link.

    It cannot be keyed on the token: an attacker chooses those, and every new key is a new row in the cache
    table. Guessing a 256-bit token is not feasible; this only keeps a flood of garbage cheap. Used by
    answerlinks.authentication, which runs before DRF's own throttle step.
    """

    scope = "answer_link_invalid"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": "all"}


class PerUserThrottle(_SharedCache, ExactCountMixin, SimpleRateThrottle):
    """Counts a signed-in client's requests per person (#121), keyed on the user's id, never on the address."""

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class ClientReadThrottle(PerUserThrottle):
    scope = "client_read"


class ClientSubmitThrottle(PerUserThrottle):
    scope = "client_submit"
