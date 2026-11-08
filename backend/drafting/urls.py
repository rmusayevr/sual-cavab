from django.urls import path

from .views import DraftView

urlpatterns = [
    path("projects/<int:project_id>/draft/", DraftView.as_view(), name="draft"),
]
