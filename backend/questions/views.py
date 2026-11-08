from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from projects.models import Project
from projects.permissions import lock_caller_membership

from .models import Question
from .serializers import QuestionSerializer, TransitionSerializer
from .services import TransitionNotAllowed, change_status


class QuestionViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Questions of a project, at /api/projects/<project_id>/questions/.

    Any member of the project (owner or member) can list, add, edit, change the
    status of and answer questions (owner's decision on #5/#6). Everyone else
    gets a 404, identical to a missing project: the project is looked up with
    visible_to(), the same single door as in the projects API. No delete.
    """

    serializer_class = QuestionSerializer
    lookup_field = "number"
    lookup_value_regex = r"\d+"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)  # authentication, permissions first
        self.project = get_object_or_404(Project.objects.visible_to(request.user), pk=kwargs["project_id"])

    def get_queryset(self):
        return Question.objects.filter(project=self.project).prefetch_related("answers__recorded_by")

    def filter_queryset(self, queryset):
        raw = self.request.query_params.get("status") if self.action == "list" else None
        if raw is None:
            return queryset
        wanted = [s.strip() for s in raw.split(",")]
        unknown = [s for s in wanted if s not in Question.Status.values]
        if unknown or not all(wanted):
            # A typo must not look like "nothing is open".
            raise ValidationError({"status": [f"Use any of: {', '.join(Question.Status.values)} (comma-separated)."]})
        return queryset.filter(status__in=wanted)

    # Every write below locks the caller's membership row FIRST (it also re-checks
    # that they are still a member), then the project or question row: one lock
    # order everywhere, or concurrent requests deadlock. See projects/permissions.py.

    @transaction.atomic
    def perform_update(self, serializer):
        lock_caller_membership(self.project, self.request.user)
        serializer.save()

    @transaction.atomic
    def perform_create(self, serializer):
        lock_caller_membership(self.project, self.request.user)
        # Lock the project row to take the next number: concurrent creates
        # queue here, so numbers are unique and never reused.
        project = Project.objects.select_for_update().get(pk=self.project.pk)
        number = project.next_question_number
        Project.objects.filter(pk=project.pk).update(next_question_number=number + 1)
        serializer.save(project=project, number=number, created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, project_id=None, number=None):
        payload = TransitionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        with transaction.atomic():
            lock_caller_membership(self.project, request.user)
            locked = get_object_or_404(Question.objects.select_for_update().filter(project=self.project), number=number)
            try:
                change_status(locked, payload.validated_data["to"], request.user, payload.validated_data.get("answer"))
            except TransitionNotAllowed as err:
                raise ValidationError(
                    {"to": [f"A {err.current} question cannot become {err.to}."], "allowed": err.allowed}
                )
        return Response(self.get_serializer(self.get_queryset().get(pk=locked.pk)).data)
