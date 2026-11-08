from django.conf import settings
from django.db import models
from django.db.models import Q


class Question(models.Model):
    """An open question a project is waiting on: Q1, Q2... per project (#6).

    Nothing here is ever deleted by the app: "dropped" is a status, and every
    foreign key is PROTECT, so removing a project, question or user in the
    admin cannot silently take questions and answers with it.
    """

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ASKED = "asked", "Asked"
        ANSWERED = "answered", "Answered"
        DROPPED = "dropped", "Dropped"

    project = models.ForeignKey("projects.Project", on_delete=models.PROTECT, related_name="questions")
    number = models.PositiveIntegerField()  # per project; never reused
    text = models.TextField()
    why_it_matters = models.TextField(blank=True)
    blocks = models.TextField(blank=True)  # the task or decision it blocks; free text in v1
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # When the question last entered each status. Never cleared on leaving it,
    # so no information is overwritten away.
    asked_at = models.DateTimeField(null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)
    dropped_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["number"]
        constraints = [models.UniqueConstraint(fields=["project", "number"], name="one_number_per_question_per_project")]

    @property
    def label(self) -> str:
        return f"Q{self.number}"

    def __str__(self) -> str:
        return f"{self.label} ({self.project})"


class Answer(models.Model):
    """What was answered, by whom, when and where.

    Answers are never edited or deleted. Re-opening a question marks its
    current answer superseded and keeps it as history; a new answer is a new row.
    """

    class Channel(models.TextChoices):
        CHAT = "chat", "Chat"
        MEETING = "meeting", "Meeting"
        EMAIL = "email", "Email"
        OTHER = "other", "Other"

    question = models.ForeignKey(Question, on_delete=models.PROTECT, related_name="answers")
    text = models.TextField()
    answered_by = models.CharField(max_length=200)  # free text: the client contact may not be a user
    answered_on = models.DateField()
    channel = models.CharField(max_length=10, choices=Channel.choices)
    channel_note = models.CharField(max_length=200, blank=True)
    recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    recorded_at = models.DateTimeField(auto_now_add=True)
    superseded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-recorded_at", "-id"]
        constraints = [
            # At most one current answer per question, even if two requests race.
            models.UniqueConstraint(
                fields=["question"], condition=Q(superseded_at__isnull=True), name="one_current_answer_per_question"
            )
        ]

    def __str__(self) -> str:
        return f"Answer to {self.question.label} by {self.answered_by}"
