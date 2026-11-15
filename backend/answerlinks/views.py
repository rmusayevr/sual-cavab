"""The two routes a client can use (/api/answer-link/) and the team's routes for the link and for what clients sent.

The client routes know nothing about people: they authenticate with the link alone (authentication.py), build
every query from `link.project`, and answer only through allowlist serializers. They never use
Project.objects.visible_to(), QuestionViewSet or QuestionSerializer, and never reach questions.services:
a submission is a row for a team member to accept or dismiss, not an answer (#114).
"""

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import Throttled, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Project
from projects.permissions import lock_caller_membership
from questions.models import Answer, Question
from questions.services import TransitionNotAllowed, change_status

from .authentication import AnswerLinkAuthentication, HoldsAValidLink, not_available
from .models import AnswerLink, AnswerSubmission
from .serializers import (
    AcceptSerializer,
    CreateLinkSerializer,
    PublicQuestionSerializer,
    SubmissionInputSerializer,
    SubmissionSerializer,
    describe_link,
)
from .services import ANSWERABLE, MAX_PENDING_PER_LINK, MAX_PENDING_PER_QUESTION, create_link, revoke_links, usable_links
from .throttles import LinkReadThrottle, LinkSubmitThrottle


class PublicLinkView(APIView):
    """Base of the client routes: the link or nothing, never cached, never indexed, never sent as a referrer."""

    authentication_classes = [AnswerLinkAuthentication]
    permission_classes = [HoldsAValidLink]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        response["Referrer-Policy"] = "no-referrer"
        response["X-Robots-Tag"] = "noindex"
        return response


class PublicQuestionsView(PublicLinkView):
    throttle_classes = [LinkReadThrottle]

    def get(self, request):
        link = request.auth
        questions = Question.objects.filter(project_id=link.project_id, status__in=ANSWERABLE).order_by("number")
        return Response(
            {
                "project_name": link.project.name,
                "expires_at": link.expires_at,
                "questions": PublicQuestionSerializer(questions, many=True).data,
            }
        )


class PublicAnswersView(PublicLinkView):
    throttle_classes = [LinkSubmitThrottle]

    def post(self, request, number):
        with transaction.atomic():
            # Lock the link row: submissions for one link take turns, so the caps below are exact, and a
            # revoke that has just committed is seen here.
            link = usable_links().select_for_update(of=("self",)).filter(pk=request.auth.pk).first()
            if link is None:
                raise not_available()
            # A question of another project, or one that is answered, dropped or missing, is the same 404.
            question = Question.objects.filter(project_id=link.project_id, number=number, status__in=ANSWERABLE).first()
            if question is None:
                raise not_available()
            payload = SubmissionInputSerializer(data=request.data)
            payload.is_valid(raise_exception=True)
            waiting = AnswerSubmission.objects.filter(link=link, state=AnswerSubmission.State.PENDING)
            if waiting.count() >= MAX_PENDING_PER_LINK or waiting.filter(question=question).count() >= MAX_PENDING_PER_QUESTION:
                raise Throttled(detail="Too many answers are waiting for this link. Try again later.")
            AnswerSubmission.objects.create(
                link=link,
                question=question,
                text=payload.validated_data["text"],
                submitter_name=payload.validated_data["name"],
            )
        return Response(status=status.HTTP_201_CREATED)


class ProjectMemberView(APIView):
    """Base of the team routes: signed in and a member of the project, else 404 (not found = not allowed).

    Any member may do what is here (owner's decision on #114). Every write takes the caller's membership
    lock first, like every other write (projects/permissions.py).
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)  # authentication and permissions first
        self.project = get_object_or_404(Project.objects.visible_to(request.user), pk=kwargs["project_id"])


class AnswerLinkView(ProjectMemberView):
    """/api/projects/<id>/answer-link/: see the link's state, make a new one, revoke it."""

    def get(self, request, project_id):
        link = AnswerLink.objects.filter(project=self.project).select_related("created_by").first()
        return Response(describe_link(link) if link else {"exists": False})

    def post(self, request, project_id):
        payload = CreateLinkSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        with transaction.atomic():
            lock_caller_membership(self.project, request.user)
            link, token = create_link(self.project, request.user, payload.validated_data["days"])
        # The token is in this reply and nowhere else, ever.
        return Response({**describe_link(link), "token": token}, status=status.HTTP_201_CREATED)

    def delete(self, request, project_id):
        with transaction.atomic():
            lock_caller_membership(self.project, request.user)
            revoke_links(self.project, revoked_by=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SubmissionsView(ProjectMemberView):
    """/api/projects/<id>/submissions/?state=pending: what clients sent, with who and when."""

    def get(self, request, project_id):
        state = request.query_params.get("state", AnswerSubmission.State.PENDING)
        if state not in AnswerSubmission.State.values:
            # A typo must not look like "nothing is waiting".
            raise ValidationError({"state": [f"Use any of: {', '.join(AnswerSubmission.State.values)}."]})
        submissions = (
            AnswerSubmission.objects.filter(link__project=self.project, state=state)
            .select_related("question", "decided_by")
            .order_by("submitted_at", "id")
        )
        return Response(SubmissionSerializer(submissions, many=True).data)


class DismissPendingView(ProjectMemberView):
    """For spam: dismiss everything still waiting in this project."""

    def post(self, request, project_id):
        with transaction.atomic():
            lock_caller_membership(self.project, request.user)
            count = AnswerSubmission.objects.filter(
                link__project=self.project, state=AnswerSubmission.State.PENDING
            ).update(state=AnswerSubmission.State.DISMISSED, decided_by=request.user, decided_at=timezone.now())
        return Response({"dismissed": count})


class SubmissionDecisionView(ProjectMemberView):
    """Locks, in this order: the caller's membership, the submission, then the question (the order of every
    other write, so concurrent accepts take turns on the question row and only one can answer it)."""

    def locked_pending_submission(self, submission_id):
        submission = get_object_or_404(
            AnswerSubmission.objects.select_for_update(of=("self",)).filter(link__project=self.project),
            pk=submission_id,
        )
        if submission.state != AnswerSubmission.State.PENDING:
            raise ValidationError({"detail": ["This answer has already been decided."]})
        return submission


class AcceptSubmissionView(SubmissionDecisionView):
    def post(self, request, project_id, submission_id):
        payload = AcceptSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        with transaction.atomic():
            lock_caller_membership(self.project, request.user)
            submission = self.locked_pending_submission(submission_id)
            question = Question.objects.select_for_update().get(pk=submission.question_id)
            try:
                change_status(
                    question,
                    Question.Status.ANSWERED,
                    request.user,
                    {
                        # The member may edit the text; what the client typed stays on the submission.
                        "text": payload.validated_data.get("text", submission.text),
                        "answered_by": submission.submitter_name,
                        "answered_on": timezone.localdate(),
                        "channel": Answer.Channel.LINK,
                    },
                )
            except TransitionNotAllowed:
                raise ValidationError(
                    {"detail": [f"{question.label} is {question.status}: re-open it before accepting an answer."]}
                )
            submission.answer = question.answers.get(superseded_at__isnull=True)
            submission.state = AnswerSubmission.State.ACCEPTED
            submission.decided_by = request.user
            submission.decided_at = timezone.now()
            submission.save()
        return Response(SubmissionSerializer(submission).data)


class DismissSubmissionView(SubmissionDecisionView):
    def post(self, request, project_id, submission_id):
        with transaction.atomic():
            lock_caller_membership(self.project, request.user)
            submission = self.locked_pending_submission(submission_id)
            submission.state = AnswerSubmission.State.DISMISSED
            submission.decided_by = request.user
            submission.decided_at = timezone.now()
            submission.save()
        return Response(SubmissionSerializer(submission).data)
