from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .models import Membership, Project
from .permissions import can_manage_members
from .serializers import AddMemberSerializer, MemberSerializer, ProjectSerializer


class ProjectViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Projects the caller is a member of. No delete in v1 (#5).

    Every lookup goes through visible_to(), so another user's project is a 404:
    not found and not allowed look the same.
    """

    serializer_class = ProjectSerializer

    def get_queryset(self):
        return Project.objects.visible_to(self.request.user).prefetch_related("memberships")

    @transaction.atomic
    def perform_create(self, serializer):
        project = serializer.save(created_by=self.request.user)
        Membership.objects.create(project=project, user=self.request.user, role=Membership.Role.OWNER)

    @action(detail=True, methods=["get", "post"], url_path="members")
    def members(self, request, pk=None):
        project = self.get_object()  # 404 unless the caller is a member
        if request.method == "GET":
            memberships = project.memberships.select_related("user")
            return Response(MemberSerializer(memberships, many=True).data)

        if not can_manage_members(project, request.user):
            raise PermissionDenied("Only an owner can add members.")
        payload = AddMemberSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                membership = Membership.objects.create(
                    project=project, user=payload.validated_data["email"], role=payload.validated_data["role"]
                )
        except IntegrityError:
            raise ValidationError({"email": ["This user is already a member."]})
        return Response(MemberSerializer(membership).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>\d+)")
    def remove_member(self, request, pk=None, user_id=None):
        project = self.get_object()
        if not can_manage_members(project, request.user):
            raise PermissionDenied("Only an owner can remove members.")
        with transaction.atomic():
            # Lock the project's memberships so two concurrent removals can't
            # both pass the last-owner check.
            memberships = list(project.memberships.select_for_update())
            target = next((m for m in memberships if m.user_id == int(user_id)), None)
            if target is None:
                return Response({"detail": "Not a member of this project."}, status=status.HTTP_404_NOT_FOUND)
            owners = [m for m in memberships if m.role == Membership.Role.OWNER]
            if target.role == Membership.Role.OWNER and len(owners) == 1:
                raise ValidationError({"detail": "A project needs at least one owner."})
            target.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
