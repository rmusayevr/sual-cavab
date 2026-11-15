from django.utils import timezone
from rest_framework import serializers

from projects.models import Project
from questions.models import Question

from .models import AnswerSubmission
from .services import DEFAULT_DAYS, MAX_DAYS, MIN_DAYS, usable_links

MAX_TEXT = 4000
MAX_NAME = 100


class PublicQuestionSerializer(serializers.ModelSerializer):
    """What a client sees of a question. An explicit allowlist: a field added to Question never reaches a
    client unless it is added here (and to the exact-payload test)."""

    label = serializers.CharField(read_only=True)

    class Meta:
        model = Question
        fields = ["number", "label", "text", "why_it_matters", "blocks"]
        read_only_fields = fields


class SubmissionInputSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=MAX_TEXT)  # trimmed, and blank is refused
    name = serializers.CharField(max_length=MAX_NAME)


class CreateLinkSerializer(serializers.Serializer):
    days = serializers.IntegerField(min_value=MIN_DAYS, max_value=MAX_DAYS, required=False, default=DEFAULT_DAYS)


class AcceptSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=MAX_TEXT, required=False)


class SubmissionSerializer(serializers.ModelSerializer):
    """What the team sees: who sent it (from a link: a name typed, never verified; from an account: the account's) and when."""

    question_number = serializers.IntegerField(source="question.number", read_only=True)
    question_label = serializers.CharField(source="question.label", read_only=True)
    question_text = serializers.CharField(source="question.text", read_only=True)
    decided_by = serializers.SerializerMethodField()
    source = serializers.SerializerMethodField()

    class Meta:
        model = AnswerSubmission
        fields = [
            "id",
            "source",
            "question_number",
            "question_label",
            "question_text",
            "text",
            "submitter_name",
            "submitted_at",
            "state",
            "decided_by",
            "decided_at",
        ]
        read_only_fields = fields

    def get_decided_by(self, submission):
        return submission.decided_by.email if submission.decided_by_id else None

    def get_source(self, submission):
        """"account" (a client account: the name is verified) or "link" (typed, never verified)."""
        return "account" if submission.submitted_by_id else "link"


def link_state(link):
    """active, expired or revoked; or creator_inactive when the person who made it can no longer vouch for it."""
    if link.revoked_at is not None:
        return "revoked"
    if link.expires_at <= timezone.now():
        return "expired"
    return "active" if usable_links().filter(pk=link.pk).exists() else "creator_inactive"


def describe_link(link):
    """The state of a link, for the team. Never the token and never its hash."""
    return {
        "exists": True,
        "state": link_state(link),
        "created_by": link.created_by.email,
        "created_at": link.created_at,
        "expires_at": link.expires_at,
        "revoked_at": link.revoked_at,
    }


class ClientProjectSerializer(serializers.ModelSerializer):
    """A client's project, as the client sees it: its id and name, nothing else (no client name, no description)."""

    class Meta:
        model = Project
        fields = ["id", "name"]
        read_only_fields = fields


class ClientAnswerInputSerializer(serializers.Serializer):
    """What a client account sends: the text. The name is the account's, so a name in the request is ignored."""

    text = serializers.CharField(max_length=MAX_TEXT)
