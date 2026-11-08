from rest_framework.routers import DefaultRouter

from .views import QuestionViewSet

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register(r"projects/(?P<project_id>\d+)/questions", QuestionViewSet, basename="question")

urlpatterns = router.urls
