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
    list_display = ("project", "number", "status", "created_by", "created_at")
    list_filter = ("status",)
    search_fields = ("text", "project__name")
    readonly_fields = ("project", "number", "created_by")
    inlines = [AnswerInline]
