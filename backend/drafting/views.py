import logging

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Project
from questions.models import Question

from .client import DraftingFailed, DraftingNotConfigured, get_client
from .config import validate_drafting_model
from .prompt import build_prompt
from .serializers import DraftRequestSerializer
from .throttles import DraftThrottle

# Only counts and ids are logged here: never the prompt, the question text or
# the draft, and never anything the API sent back.
log = logging.getLogger("drafting")

NOT_SET_UP = "Drafting is not set up on this server."
COULD_NOT_WRITE = "The draft could not be written. Try again in a minute."


class DraftView(APIView):
    """POST /api/projects/<id>/draft/  {"questions": [1, 3]}  ->  {"draft": "..."}

    Returns text for a person to review. Nothing is sent anywhere, nothing is
    stored. Any member of the project may draft (same rule as questions); a
    non-member gets the same 404 as a project that does not exist.
    """

    throttle_classes = [DraftThrottle]

    def post(self, request, project_id):
        project = get_object_or_404(Project.objects.visible_to(request.user), pk=project_id)

        payload = DraftRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        numbers = payload.validated_data["questions"]

        # Only open or asked questions of THIS project can be drafted.
        found = {
            q.number: q
            for q in Question.objects.filter(
                project=project,
                number__in=numbers,
                status__in=[Question.Status.OPEN, Question.Status.ASKED],
            )
        }
        missing = sorted(n for n in numbers if n not in found)
        if missing:
            labels = ", ".join(f"Q{n}" for n in missing)
            return Response(
                {"questions": [f"Not open or asked in this project: {labels}."]}, status=status.HTTP_400_BAD_REQUEST
            )

        try:
            model = validate_drafting_model(settings.DRAFTING_MODEL)
            client = get_client()
        except (DraftingNotConfigured, ImproperlyConfigured):
            log.warning("draft refused: not set up (project=%s)", project.pk)
            return Response({"detail": NOT_SET_UP}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        system, user = build_prompt(
            [
                {"number": q.number, "text": q.text, "why_it_matters": q.why_it_matters, "blocks": q.blocks}
                for q in sorted(found.values(), key=lambda q: q.number)
            ]
        )

        log.info("draft requested project=%s questions=%s", project.pk, len(found))
        try:
            text = client.draft(system=system, user=user, model=model)
        except DraftingNotConfigured:
            return Response({"detail": NOT_SET_UP}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except DraftingFailed as err:
            log.error("draft failed project=%s reason=%s", project.pk, err)
            return Response({"detail": COULD_NOT_WRITE}, status=status.HTTP_502_BAD_GATEWAY)
        except Exception as err:  # noqa: BLE001 - whatever it is, the user gets the fixed message
            log.error("draft failed project=%s error=%s", project.pk, type(err).__name__)
            return Response({"detail": COULD_NOT_WRITE}, status=status.HTTP_502_BAD_GATEWAY)

        response = Response({"draft": text, "model": model})
        response["Cache-Control"] = "no-store"
        return response
