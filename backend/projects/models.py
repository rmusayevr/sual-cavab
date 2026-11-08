from django.conf import settings
from django.db import models


class ProjectQuerySet(models.QuerySet):
    def visible_to(self, user):
        """The only way to reach projects: those the user is a member of (#5).

        No exception for superusers; they use the Django admin.
        """
        if not user or not user.is_authenticated:
            return self.none()
        return self.filter(memberships__user=user).distinct()


class Project(models.Model):
    name = models.CharField(max_length=200)
    client_name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ProjectQuerySet.as_manager()

    class Meta:
        ordering = ["name", "id"]

    def __str__(self) -> str:
        return self.name


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        MEMBER = "member", "Member"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["project", "user"], name="one_membership_per_user_per_project")]
        ordering = ["added_at", "id"]

    def __str__(self) -> str:
        return f"{self.user} in {self.project} ({self.role})"
