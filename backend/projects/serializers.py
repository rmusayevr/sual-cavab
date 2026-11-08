from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.models import normalize_email

from .models import Membership, Project


class ProjectSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = ["id", "name", "client_name", "description", "my_role", "created_at", "updated_at"]
        read_only_fields = ["id", "my_role", "created_at", "updated_at"]

    def update(self, instance, validated_data):
        # Write only the fields that were sent. DRF's default saves every column
        # from the copy loaded at the start of the request, which would write
        # back a stale next_question_number and rewind the question counter
        # (review of #21), or revert another user's edit to a field not sent.
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save(update_fields=[*validated_data, "updated_at"])
        # Answer with the row as it is now, not the copy loaded earlier.
        return Project.objects.prefetch_related("memberships").get(pk=instance.pk)

    def get_my_role(self, project):
        user = self.context["request"].user
        for membership in project.memberships.all():  # prefetched by the view
            if membership.user_id == user.pk:
                return membership.role
        return None


class MemberSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    name = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields = ["user_id", "email", "name", "role", "added_at"]

    def get_name(self, membership):
        return membership.user.get_full_name()


class AddMemberSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(choices=Membership.Role.choices, default=Membership.Role.MEMBER)

    def validate_email(self, value):
        try:
            return get_user_model().objects.get(email=normalize_email(value), is_active=True)
        except get_user_model().DoesNotExist:
            # Accounts are created by an admin (#4); an owner can only add an
            # existing, active user.
            raise serializers.ValidationError("No active user has this email. Ask an admin to create the account.")
