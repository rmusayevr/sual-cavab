from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "core"

    def ready(self):
        from core import checks  # noqa: F401 - importing registers the system checks
