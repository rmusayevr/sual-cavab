from rest_framework.routers import DefaultRouter

from .views import ProjectViewSet

router = DefaultRouter(trailing_slash=True)
router.include_root_view = False
router.register("projects", ProjectViewSet, basename="project")

urlpatterns = router.urls
