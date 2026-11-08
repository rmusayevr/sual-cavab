from django.db import transaction
from django.http import Http404
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from .models import Membership, Project
from .permissions import role_may_manage_members
from .serializers import AddMemberSerializer, MemberSerializer, ProjectSerializer
from .throttles import MemberAddThrottle


def lock_memberships(project, user):
    """Lock the project's memberships and return (rows, the caller's role).

    The caller's role is read from the locked rows, so an owner who was removed
    a moment ago is refused with a 404 (they are no longer a member), not
    allowed through on a role read before the lock (review of #19).
    """
    rows = list(project.memberships.select_related("user").select_for_update(of=("self",)))
    caller = next((m for m in rows if m.user_id == user.pk), None)
    if caller is None:
        raise Http404
    return rows, caller.role


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

    def get_throttles(self):
        # Only adding a member is limited: it answers "does this email have an
        # account?" (accepted for v1 on #19, with this limit).
        if self.action == "members" and self.request.method == "POST":
            return [MemberAddThrottle()]
        return super().get_throttles()

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

        with transaction.atomic():
            rows, caller_role = lock_memberships(project, request.user)
            if not role_may_manage_members(caller_role):
                raise PermissionDenied("Only an owner can add members.")
            # Validate only after authorizing: validation answers "does this
            # email have an account?", which a non-owner must not learn.
            payload = AddMemberSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            new_user = payload.validated_data["email"]
            if any(m.user_id == new_user.pk for m in rows):
                raise ValidationError({"email": ["This user is already a member."]})
            membership = Membership.objects.create(project=project, user=new_user, role=payload.validated_data["role"])
        return Response(MemberSerializer(membership).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["delete"], url_path=r"members/(?P<user_id>\d+)")
    def remove_member(self, request, pk=None, user_id=None):
        project = self.get_object()
        with transaction.atomic():
            rows, caller_role = lock_memberships(project, request.user)
            if not role_may_manage_members(caller_role):
                raise PermissionDenied("Only an owner can remove members.")
            target = next((m for m in rows if m.user_id == int(user_id)), None)
            if target is None:
                return Response({"detail": "Not a member of this project."}, status=status.HTTP_404_NOT_FOUND)
            # Only active owners count: a deactivated owner can't manage the
            # project, so leaving them as the last owner would orphan it.
            active_owners = [m for m in rows if m.role == Membership.Role.OWNER and m.user.is_active]
            if target in active_owners and len(active_owners) == 1:
                raise ValidationError({"detail": "A project needs at least one active owner."})
            target.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
