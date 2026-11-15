"""The three routes of a client account (#121): their projects, a project's open questions, and sending an answer.

A client is a person with an account and the role "client" on a project. These routes know the client's own door only
(Project.objects.visible_to_client), build every reply from allowlist serializers and never touch the team's
serializers, and a client cannot reach any team route (Project.objects.visible_to refuses them there). What a client
sends is a pending submission from the signed-in person, never an answer: a team member accepts or dismisses it.
"""

from collections import defaultdict

from django.db import transaction
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.exceptions import NotFound, Throttled
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Membership, Project
from questions.models import Question

from .models import AnswerSubmission
from .serializers import ClientAnswerInputSerializer, ClientProjectSerializer, PublicQuestionSerializer
from .services import ANSWERABLE, MAX_PENDING_PER_LINK, MAX_PENDING_PER_QUESTION
from .throttles import ClientReadThrottle, ClientSubmitThrottle

# Per person and project: the same caps as for a link, counted for the person instead of for the link.
MAX_PENDING_PER_PROJECT = MAX_PENDING_PER_LINK


def display_name(user):
    """The name the team sees: the account's own, cut to the column that holds it."""
    return (user.get_full_name() or user.email)[:100]


class ClientProjectView(APIView):
    """Base of the client routes: signed in (the default), and a CLIENT of the project, else a plain 404.

    The team, a stranger and a client of another project all get the same 404 as a project that does not exist.
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)  # authentication, permissions, throttles first
        self.project = get_object_or_404(Project.objects.visible_to_client(request.user), pk=kwargs["project_id"])


class ClientProjectsView(APIView):
    throttle_classes = [ClientReadThrottle]

    def get(self, request):
        projects = Project.objects.visible_to_client(request.user).order_by("name", "id")
        return Response(ClientProjectSerializer(projects, many=True).data)


class ClientQuestionsView(ClientProjectView):
    throttle_classes = [ClientReadThrottle]

    def get(self, request, project_id):
        questions = Question.objects.filter(project=self.project, status__in=ANSWERABLE).order_by("number")
        own = (
            AnswerSubmission.objects.filter(
                submitted_by=request.user,
                question__project=self.project,
                state__in=[AnswerSubmission.State.PENDING, AnswerSubmission.State.ACCEPTED],  # a dismissal is not shown
            )
            .select_related("question")
            .order_by("submitted_at", "id")
        )
        # An answer is accepted at the moment its question is answered, which takes the question off the open list:
        # the person's own answers on questions that have closed are shown separately, theirs only, never the team's.
        on_open, earlier = defaultdict(list), []
        for s in own:
            if s.question.status in ANSWERABLE:
                on_open[s.question.number].append({"text": s.text, "state": s.state, "submitted_at": s.submitted_at})
            else:
                earlier.append(
                    {"number": s.question.number, "label": s.question.label, "question_text": s.question.text, "text": s.text, "state": s.state}
                )
        earlier.sort(key=lambda e: e["number"])
        return Response(
            {
                "project_name": self.project.name,
                "questions": [{**PublicQuestionSerializer(q).data, "mine": on_open.get(q.number, [])} for q in questions],
                "earlier": [{k: v for k, v in e.items() if k != "number"} for e in earlier],
            }
        )


class ClientAnswersView(ClientProjectView):
    throttle_classes = [ClientSubmitThrottle]

    def post(self, request, project_id, number):
        with transaction.atomic():
            # Lock this person's membership: their submissions take turns, so the caps are exact, and a person who
            # has just been removed (or is no longer a client) is refused here.
            membership = (
                Membership.objects.select_for_update()
                .filter(project=self.project, user=request.user, role=Membership.Role.CLIENT)
                .first()
            )
            if membership is None:
                raise Http404
            # A question that is answered, dropped, missing or in another project is one and the same 404.
            question = Question.objects.filter(project=self.project, number=number, status__in=ANSWERABLE).first()
            if question is None:
                raise NotFound()
            payload = ClientAnswerInputSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            waiting = AnswerSubmission.objects.filter(
                submitted_by=request.user, question__project=self.project, state=AnswerSubmission.State.PENDING
            )
            if waiting.count() >= MAX_PENDING_PER_PROJECT or waiting.filter(question=question).count() >= MAX_PENDING_PER_QUESTION:
                raise Throttled(detail="Too many of your answers are waiting. Try again later.")
            submission = AnswerSubmission.objects.create(
                submitted_by=request.user,
                question=question,
                text=payload.validated_data["text"],
                submitter_name=display_name(request.user),
            )
        return Response(
            {"text": submission.text, "state": submission.state, "submitted_at": submission.submitted_at},
            status=status.HTTP_201_CREATED,
        )
