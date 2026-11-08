from django.contrib import admin

from .models import Membership, Project


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    autocomplete_fields = ["user"]


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "client_name", "created_by", "created_at")
    search_fields = ("name", "client_name")
    # Only changed by creating a question, under a row lock (#6): never editable here.
    readonly_fields = ("next_question_number",)
    inlines = [MembershipInline]

    def save_model(self, request, obj, form, change):
        if not change:
            super().save_model(request, obj, form, change)
            return
        # Write only what the form changed. A full save() writes back every column
        # from the copy loaded when the form was submitted, including a stale
        # next_question_number (review of #21).
        if form.changed_data:
            obj.save(update_fields=[*form.changed_data, "updated_at"])
