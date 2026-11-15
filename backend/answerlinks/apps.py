from django.apps import AppConfig


class AnswerlinksConfig(AppConfig):
    name = "answerlinks"

    def ready(self):
        from . import signals  # noqa: F401  (connects the receivers)
