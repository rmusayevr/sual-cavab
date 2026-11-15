"""Shared setup for the answer-link tests (#114). Everything here is invented."""

from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import TestCase
from rest_framework.test import APIClient

from answerlinks.services import create_link
from core.testing import invented_password
from projects.models import Membership, Project
from questions.models import Answer, Question

PASSWORD = invented_password()
SECRET_ANSWER = "SECRET-ANSWER-TEXT-do-not-leak"
OTHER_PROJECT_TEXT = "Question that belongs to the other project"

LINK_QUESTIONS = "/api/answer-link/questions/"


def link_answers(number):
    return f"/api/answer-link/questions/{number}/answers/"


def with_token(token):
    return {"HTTP_X_ANSWER_TOKEN": token}


class LinkTestCase(TestCase):
    """Project A (the one with the link) and project B (which must stay out of reach).

    A: owner and member. Q1 open, Q2 asked, Q3 answered (with a secret answer), Q4 dropped.
    B: outsider. Q1 open (same number as A's Q1) and Q5 open (a number A does not have).
    """

    def setUp(self):
        caches["throttle"].clear()
        User = get_user_model()
        self.owner = User.objects.create_user(email="owner@example.invalid", password=PASSWORD)
        self.member = User.objects.create_user(email="member@example.invalid", password=PASSWORD)
        self.outsider = User.objects.create_user(email="outsider@example.invalid", password=PASSWORD)

        self.project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=self.owner)
        Membership.objects.create(project=self.project, user=self.owner, role=Membership.Role.OWNER)
        Membership.objects.create(project=self.project, user=self.member, role=Membership.Role.MEMBER)
        self.other = Project.objects.create(name="Booking", client_name="Other Client", created_by=self.outsider)
        Membership.objects.create(project=self.other, user=self.outsider, role=Membership.Role.OWNER)

        S = Question.Status
        self.q1 = self.question(self.project, 1, "Which providers are allowed?", S.OPEN, why="Why one", blocks="Blocks one")
        self.q2 = self.question(self.project, 2, "Who approves refunds?", S.ASKED, why="Why two", blocks="Blocks two")
        self.q3 = self.question(self.project, 3, "Which currency?", S.ANSWERED)
        self.q4 = self.question(self.project, 4, "A mobile app?", S.DROPPED)
        Answer.objects.create(
            question=self.q3, text=SECRET_ANSWER, answered_by="Invented Contact", answered_on="2026-11-10",
            channel=Answer.Channel.CHAT, recorded_by=self.owner,
        )
        self.other_q1 = self.question(self.other, 1, OTHER_PROJECT_TEXT + " (Q1)", S.OPEN)
        self.other_q5 = self.question(self.other, 5, OTHER_PROJECT_TEXT + " (Q5)", S.OPEN)

        self.link, self.token = create_link(self.project, self.owner, days=14)

    def question(self, project, number, text, status, why="", blocks=""):
        return Question.objects.create(
            project=project, number=number, text=text, status=status, why_it_matters=why, blocks=blocks,
            created_by=project.created_by,
        )

    def public(self):
        """A client with no account: no cookies, no session."""
        return APIClient()

    def as_user(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def team_url(self, suffix="", project=None):
        return f"/api/projects/{(project or self.project).pk}/{suffix}"
