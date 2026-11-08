from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from projects.models import Membership, Project

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

    def require_membership(self):
        """Re-check, under a row lock, that the caller is still a member.

        initial() checked membership before any lock. Removing a member locks
        the project's membership rows, so locking the caller's row here makes a
        member removed mid-request get a 404 instead of one more write.
        """
        row = Membership.objects.select_for_update().filter(project=self.project, user=self.request.user).first()
        if row is None:
            raise Http404

    @transaction.atomic
    def perform_update(self, serializer):
        self.require_membership()
        serializer.save()

    @transaction.atomic
    def perform_create(self, serializer):
        # Lock the project row to take the next number: concurrent creates
        # queue here, so numbers are unique and never reused.
        project = Project.objects.select_for_update().get(pk=self.project.pk)
        self.require_membership()
        number = project.next_question_number
        Project.objects.filter(pk=project.pk).update(next_question_number=number + 1)
        serializer.save(project=project, number=number, created_by=self.request.user)

    @action(detail=True, methods=["post"], url_path="transition")
    def transition(self, request, project_id=None, number=None):
        payload = TransitionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        with transaction.atomic():
            locked = get_object_or_404(Question.objects.select_for_update().filter(project=self.project), number=number)
            self.require_membership()
            try:
                change_status(locked, payload.validated_data["to"], request.user, payload.validated_data.get("answer"))
            except TransitionNotAllowed as err:
                raise ValidationError(
                    {"to": [f"A {err.current} question cannot become {err.to}."], "allowed": err.allowed}
                )
        return Response(self.get_serializer(self.get_queryset().get(pk=locked.pk)).data)
