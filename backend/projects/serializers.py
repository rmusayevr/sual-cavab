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
