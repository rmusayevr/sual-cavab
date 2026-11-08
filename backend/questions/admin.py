from django.contrib import admin

from .models import Answer, Question


class AnswerInline(admin.TabularInline):
    """Answers are history: shown, never added, edited or deleted here."""

    model = Answer
    extra = 0
    can_delete = False
    readonly_fields = [f.name for f in Answer._meta.fields if f.name != "id"]

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    """Look, and fix typos in the three text fields. Nothing else.

    Status changes go through the transition rules (answering needs an answer,
    re-opening keeps it as history), so status and its timestamps are read-only.
    Questions are never added or deleted here: "dropped" is a status (#6).
    """

    list_display = ("project", "number", "status", "created_by", "created_at")
    list_filter = ("status",)
    search_fields = ("text", "project__name")
    readonly_fields = (
        "project", "number", "status", "created_by", "created_at", "updated_at",
        "asked_at", "answered_at", "dropped_at",
    )
    inlines = [AnswerInline]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        # Write only the text the form changed, so a long-open form cannot write
        # back an old status over an answer given meanwhile (review of #21).
        if form.changed_data:
            obj.save(update_fields=[*form.changed_data, "updated_at"])
