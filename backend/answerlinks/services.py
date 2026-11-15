"""Making, finding and revoking answer links (#114).

The token is 256 bits from `secrets`, shown once. Only its SHA-256 hash is stored (a token this long needs no
salt and no slow hash), so a database leak or a backup does not leak working links.
"""

import hashlib
import re
import secrets
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from projects.models import Project
from questions.models import Question

from .models import AnswerLink

DEFAULT_DAYS = 14
MIN_DAYS = 1
MAX_DAYS = 30
MAX_PENDING_PER_QUESTION = 5
MAX_PENDING_PER_LINK = 200

# What a client is shown and may answer: the questions still waiting (the same two statuses as the open count).
ANSWERABLE = [Question.Status.OPEN, Question.Status.ASKED]

# token_urlsafe(32) is always 43 characters of this alphabet; anything else cannot be a token.
TOKEN_FORMAT = re.compile(r"[A-Za-z0-9_-]{43}")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def usable_links():
    """Links that work right now: not revoked, not expired, and made by someone who is still an active member.

    Checked on every request and never cached, so revoking, expiry, removing the creator from the project and
    deactivating the creator all take effect on the very next request.
    """
    return AnswerLink.objects.filter(
        revoked_at__isnull=True,
        expires_at__gt=timezone.now(),
        created_by__is_active=True,
        project__memberships__user=F("created_by"),
    )


def find_usable_link(token):
    if not isinstance(token, str) or not TOKEN_FORMAT.fullmatch(token):
        return None
    return usable_links().select_related("project").filter(token_hash=hash_token(token)).first()


@transaction.atomic
def create_link(project, user, days=DEFAULT_DAYS):
    """Make a link for `project` and return (link, token); the old unrevoked link, if any, is revoked.

    The caller (a view) has already locked the caller's membership row; this takes the project row next, the
    same order as everywhere else (see projects/permissions.py), so two people making a link at once take
    turns instead of one hitting the one-unrevoked-link constraint.
    """
    Project.objects.select_for_update().get(pk=project.pk)
    now = timezone.now()
    AnswerLink.objects.filter(project=project, revoked_at__isnull=True).update(revoked_at=now, revoked_by=user)
    token = secrets.token_urlsafe(32)
    link = AnswerLink.objects.create(
        project=project, token_hash=hash_token(token), created_by=user, expires_at=now + timedelta(days=days)
    )
    return link, token


def revoke_links(project, revoked_by, created_by=None):
    """Revoke the project's unrevoked link, or only the ones `created_by` made. Returns how many."""
    links = AnswerLink.objects.filter(project=project, revoked_at__isnull=True)
    if created_by is not None:
        links = links.filter(created_by=created_by)
    return links.update(revoked_at=timezone.now(), revoked_by=revoked_by)
