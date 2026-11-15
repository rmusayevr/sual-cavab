from django.contrib.auth.models import AnonymousUser
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import NotFound, Throttled
from rest_framework.permissions import BasePermission

from .models import AnswerLink
from .services import find_usable_link
from .throttles import InvalidTokenThrottle

HEADER = "X-Answer-Token"
NOT_AVAILABLE = "This link is not available."


def not_available():
    return NotFound(NOT_AVAILABLE)


class AnswerLinkAuthentication(BaseAuthentication):
    """The only way into /api/answer-link/: the X-Answer-Token header. Cookies and sessions are ignored.

    request.user is always anonymous and request.auth is the AnswerLink, so nothing that asks "who is this
    person" (visible_to(), IsAuthenticated) can ever treat a link holder, or a team member who opens the
    link, as a member of anything.

    Every failure (no header, malformed, unknown, expired, revoked, creator gone) is the same 404 with the
    same body, so the client cannot tell them apart.
    """

    def authenticate(self, request):
        link = find_usable_link(request.headers.get(HEADER))
        if link is None:
            throttle = InvalidTokenThrottle()
            if not throttle.allow_request(request, None):
                raise Throttled(wait=throttle.wait())
            raise not_available()
        return AnonymousUser(), link


class HoldsAValidLink(BasePermission):
    def has_permission(self, request, view):
        return isinstance(request.auth, AnswerLink)
