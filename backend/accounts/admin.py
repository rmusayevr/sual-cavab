from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm, UserCreationForm

from django import forms

from .models import User, normalize_email


def clean_unique_email(form):
    """Emails are stored lower-cased, so uniqueness must ignore case: without
    this, 'Ada@x' passes the form and fails the database constraint (a 500)."""
    email = normalize_email(form.cleaned_data.get("email"))
    others = User.objects.filter(email__iexact=email)
    if form.instance.pk:
        others = others.exclude(pk=form.instance.pk)
    if others.exists():
        raise forms.ValidationError("A user with this email already exists.")
    return email


class EmailUserCreationForm(UserCreationForm):
    class Meta:
        model = User
        fields = ("email",)

    def clean_email(self):
        return clean_unique_email(self)


class EmailUserChangeForm(UserChangeForm):
    class Meta:
        model = User
        fields = "__all__"

    def clean_email(self):
        return clean_unique_email(self)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Admins create users here; there is no self sign-up in v1 (#4)."""

    form = EmailUserChangeForm
    add_form = EmailUserCreationForm
    ordering = ("email",)
    list_display = ("email", "first_name", "last_name", "is_active", "is_staff")
    search_fields = ("email", "first_name", "last_name")
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )
