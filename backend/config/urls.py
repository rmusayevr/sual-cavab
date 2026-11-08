from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("api/", include("core.urls")),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("projects.urls")),
    path("api/", include("questions.urls")),
    path("api/", include("drafting.urls")),
]

# The admin's sign-in page has no rate limit, so a public host can switch it off
# (DJANGO_ADMIN_ENABLED=0). It is on by default.
if settings.ADMIN_ENABLED:
    urlpatterns.insert(0, path("admin/", admin.site.urls))
