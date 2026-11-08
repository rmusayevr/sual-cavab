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
    inlines = [MembershipInline]
