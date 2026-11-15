from django.conf import settings
from django.db import models
from django.db.models import Q


class AnswerLink(models.Model):
    """A private link that lets someone with no account see a project's open questions and send answers (#114).

    Only the SHA-256 hash of the token is stored: the token itself is shown once, when the link is made, and
    cannot be recovered. A project has at most one link that has not been revoked: making a new one revokes
    the old one. Nothing is deleted (same rule as questions and answers).
    """

    project = models.ForeignKey("projects.Project", on_delete=models.PROTECT, related_name="answer_links")
    token_hash = models.CharField(max_length=64, unique=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            # One unrevoked link per project, even if two requests race to make one.
            models.UniqueConstraint(
                fields=["project"], condition=Q(revoked_at__isnull=True), name="one_unrevoked_answer_link_per_project"
            )
        ]

    def __str__(self) -> str:
        return f"Answer link of {self.project} (made {self.created_at:%Y-%m-%d})"


class AnswerSubmission(models.Model):
    """What a client sent through a link. It is not an answer: a team member accepts or dismisses it.

    Accepting runs the existing questions.services.change_status() and links the Answer it made; the text the
    client typed stays here exactly as sent, even if the member edited the answer before accepting.
    """

    class State(models.TextChoices):
        PENDING = "pending", "Pending"
        ACCEPTED = "accepted", "Accepted"
        DISMISSED = "dismissed", "Dismissed"

    link = models.ForeignKey(AnswerLink, on_delete=models.PROTECT, related_name="submissions")
    question = models.ForeignKey("questions.Question", on_delete=models.PROTECT, related_name="submissions")
    text = models.TextField()
    submitter_name = models.CharField(max_length=100)  # typed by the client: never verified
    submitted_at = models.DateTimeField(auto_now_add=True)
    state = models.CharField(max_length=10, choices=State.choices, default=State.PENDING)
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name="+"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    answer = models.OneToOneField(
        "questions.Answer", on_delete=models.PROTECT, null=True, blank=True, related_name="submission"
    )

    class Meta:
        ordering = ["submitted_at", "id"]
        indexes = [models.Index(fields=["link", "state"]), models.Index(fields=["question", "state"])]

    def __str__(self) -> str:
        return f"{self.submitter_name} on {self.question} ({self.state})"
