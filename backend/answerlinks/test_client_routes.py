"""The three routes of a client account (#121): their projects, a project's open questions, and sending an answer.

Allowlist payloads, their own projects only, their own submissions only; an answer is a pending submission (never an
Answer) from the signed-in person, whose name is the account's and cannot be typed.
"""

from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from core.testing import invented_password
from projects.models import Membership, Project
from questions.models import Answer, Question

from .models import AnswerSubmission

PROJECTS = "/api/client/projects/"
TEAMS_ANSWER = "SECRET-ANSWER-do-not-leak"
OTHER = "Question of the other project"


def questions_url(project):
    return f"/api/client/projects/{project.pk}/questions/"


def answers_url(project, number):
    return f"/api/client/projects/{project.pk}/questions/{number}/answers/"


class ClientTestCase(TestCase):
    def setUp(self):
        caches["throttle"].clear()
        User = get_user_model()
        make = lambda email, **kw: User.objects.create_user(email=email, password=invented_password(), **kw)  # noqa: E731
        self.owner, self.member = make("owner@example.invalid"), make("member@example.invalid")
        self.ada = make("ada@example.invalid", first_name="Ada", last_name="Client")
        self.bob = make("bob@example.invalid")
        self.stranger = make("stranger@example.invalid")

        self.project = Project.objects.create(name="Ticketing", client_name="Secret Client Ltd", description="Internal notes", created_by=self.owner)
        self.other = Project.objects.create(name="Booking", client_name="Other", created_by=self.owner)
        for who, role in ((self.owner, "owner"), (self.member, "member"), (self.ada, "client"), (self.bob, "client")):
            Membership.objects.create(project=self.project, user=who, role=role)
        Membership.objects.create(project=self.other, user=self.owner, role="owner")

        self.q1 = self.question(self.project, 1, "Which providers?", "open", why="Why one", blocks="Blocks one")
        self.q2 = self.question(self.project, 2, "Who approves refunds?", "asked")
        self.q3 = self.question(self.project, 3, "Which currency?", "answered")
        self.q4 = self.question(self.project, 4, "A mobile app?", "dropped")
        Answer.objects.create(
            question=self.q3, text=TEAMS_ANSWER, answered_by="Someone", answered_on="2026-11-10", channel="app", recorded_by=self.owner
        )
        self.other_q1 = self.question(self.other, 1, OTHER, "open")

    def question(self, project, number, text, status, why="", blocks=""):
        return Question.objects.create(project=project, number=number, text=text, status=status, why_it_matters=why, blocks=blocks, created_by=self.owner)

    def api(self, who=None):
        client = APIClient()
        if who is not None:
            client.force_authenticate(who)
        return client

    def session(self, who):
        """A real sign-in (a session cookie): unlike force_authenticate it notices an account that was deactivated."""
        client = APIClient()
        client.force_login(who)
        return client

    def send(self, who, number=1, text="Use Stripe.", project=None, **extra):
        return self.api(who).post(answers_url(project or self.project, number), {"text": text, **extra}, format="json")


class ClientProjectsTests(ClientTestCase):
    def test_a_client_sees_their_own_projects_with_a_name_and_nothing_else(self):
        response = self.api(self.ada).get(PROJECTS)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [{"id": self.project.pk, "name": "Ticketing"}])
        text = response.content.decode()
        for secret in ("Secret Client", "Internal notes", "Booking", self.owner.email):
            self.assertNotIn(secret, text)

    def test_a_team_member_or_a_stranger_has_no_client_projects(self):
        for who in (self.owner, self.member, self.stranger):
            self.assertEqual(self.api(who).get(PROJECTS).json(), [], who.email)

    def test_nobody_signed_out_can_ask(self):
        self.assertEqual(self.api().get(PROJECTS).status_code, 403)

    def test_a_client_who_is_removed_or_deactivated_has_no_projects_on_the_next_request(self):
        ada, bob = self.session(self.ada), self.session(self.bob)
        Membership.objects.filter(user=self.bob).delete()
        self.ada.is_active = False
        self.ada.save()

        self.assertEqual(bob.get(PROJECTS).json(), [])
        self.assertIn(ada.get(PROJECTS).status_code, (401, 403))


class ClientQuestionsTests(ClientTestCase):
    def test_exactly_the_open_and_asked_questions_with_exactly_these_fields(self):
        response = self.api(self.ada).get(questions_url(self.project))

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"project_name", "questions", "earlier"})
        self.assertEqual([q["number"] for q in body["questions"]], [1, 2])
        for q in body["questions"]:
            self.assertEqual(set(q), {"number", "label", "text", "why_it_matters", "blocks", "mine"})
        self.assertEqual((body["questions"][0]["why_it_matters"], body["questions"][0]["blocks"]), ("Why one", "Blocks one"))

    def test_no_answer_no_member_no_other_project_no_internal_notes_appear(self):
        text = self.api(self.ada).get(questions_url(self.project)).content.decode()

        for secret in (TEAMS_ANSWER, OTHER, "Booking", "Secret Client", "Internal notes", self.owner.email, self.member.email, '"id"', "Which currency", "A mobile app"):
            self.assertNotIn(secret, text, secret)

    def test_a_project_the_person_is_not_a_client_of_is_a_404_the_same_as_a_missing_one(self):
        missing = self.api(self.ada).get("/api/client/projects/999999/questions/")

        for project in (self.other,):
            response = self.api(self.ada).get(questions_url(project))
            self.assertEqual((response.status_code, response.content), (missing.status_code, missing.content))
        self.assertEqual(missing.status_code, 404)

    def test_the_team_and_strangers_are_refused_on_the_client_route_too(self):
        for who in (self.owner, self.member, self.stranger):
            self.assertEqual(self.api(who).get(questions_url(self.project)).status_code, 404, who.email)

    def test_a_client_sees_only_their_own_answers_and_whether_they_were_taken(self):
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q1, text="Ada waiting", submitter_name="Ada Client")
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q1, text="Ada taken", submitter_name="Ada Client", state="accepted")
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q1, text="Ada dismissed", submitter_name="Ada Client", state="dismissed")
        AnswerSubmission.objects.create(submitted_by=self.bob, question=self.q1, text="BOB'S OWN WORDS", submitter_name="bob@example.invalid")

        ada = self.api(self.ada).get(questions_url(self.project))
        bob = self.api(self.bob).get(questions_url(self.project))

        mine = ada.json()["questions"][0]["mine"]
        self.assertEqual({m["text"]: m["state"] for m in mine}, {"Ada waiting": "pending", "Ada taken": "accepted"})  # a dismissal is not shown
        self.assertTrue(all(set(m) == {"text", "state", "submitted_at"} for m in mine))
        self.assertNotIn("BOB'S OWN WORDS", ada.content.decode())
        self.assertNotIn("Ada waiting", bob.content.decode())
        self.assertEqual([m["text"] for m in bob.json()["questions"][0]["mine"]], ["BOB'S OWN WORDS"])


class ClientSendingTests(ClientTestCase):
    def test_a_submission_by_the_account_is_created_pending_and_is_never_an_answer(self):
        answers_before = Answer.objects.count()

        response = self.send(self.ada)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(set(response.json()), {"text", "state", "submitted_at"})
        submission = AnswerSubmission.objects.get()
        self.assertEqual(
            (submission.submitted_by, submission.link, submission.question, submission.state, submission.text),
            (self.ada, None, self.q1, "pending", "Use Stripe."),
        )
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, "open")
        self.assertEqual(Answer.objects.count(), answers_before)

    def test_the_name_is_the_accounts_and_cannot_be_typed(self):
        self.send(self.ada, name="Somebody Else", submitter_name="Forged", submitted_by=self.bob.pk, state="accepted")

        submission = AnswerSubmission.objects.get()
        self.assertEqual((submission.submitter_name, submission.submitted_by, submission.state), ("Ada Client", self.ada, "pending"))

    def test_a_client_without_a_name_is_shown_by_email_and_a_long_name_is_cut_to_its_column(self):
        self.send(self.bob)
        self.ada.first_name, self.ada.last_name = "A" * 150, "B" * 150
        self.ada.save()
        self.send(self.ada)

        self.assertEqual(AnswerSubmission.objects.get(submitted_by=self.bob).submitter_name, "bob@example.invalid")
        self.assertEqual(len(AnswerSubmission.objects.get(submitted_by=self.ada).submitter_name), 100)

    def test_a_question_that_is_answered_dropped_missing_or_in_another_project_is_one_404(self):
        replies = [self.send(self.ada, number=n) for n in (3, 4, 99)]
        replies.append(self.send(self.ada, number=1, project=self.other))

        self.assertEqual({r.status_code for r in replies}, {404})
        self.assertEqual(len({r.content for r in replies[:3]}), 1)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_the_team_and_strangers_cannot_send_here(self):
        for who in (self.owner, self.member, self.stranger):
            self.assertEqual(self.send(who).status_code, 404, who.email)
        self.assertEqual(self.api().post(answers_url(self.project, 1), {"text": "x"}, format="json").status_code, 403)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_the_input_is_checked(self):
        for label, body in {"blank": {"text": ""}, "spaces": {"text": "   \n"}, "missing": {}, "too long": {"text": "a" * 4001}}.items():
            with self.subTest(label):
                response = self.api(self.ada).post(answers_url(self.project, 1), body, format="json")
                self.assertEqual(response.status_code, 400)
        self.assertEqual(AnswerSubmission.objects.count(), 0)
        self.assertEqual(self.send(self.ada, text="  " + "a" * 4000 + "  ").status_code, 201)

    def test_html_is_stored_exactly_as_typed(self):
        self.send(self.ada, text="<script>alert(1)</script> & <b>x</b>")

        self.assertEqual(AnswerSubmission.objects.get().text, "<script>alert(1)</script> & <b>x</b>")

    def test_a_removed_or_deactivated_client_cannot_send_on_the_next_request(self):
        ada, bob = self.session(self.ada), self.session(self.bob)
        Membership.objects.filter(user=self.bob).delete()
        self.ada.is_active = False
        self.ada.save()

        url = answers_url(self.project, 1)
        self.assertEqual(bob.post(url, {"text": "x"}, format="json").status_code, 404)
        self.assertIn(ada.post(url, {"text": "x"}, format="json").status_code, (401, 403))
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_a_client_whose_role_changes_mid_request_cannot_send(self):
        from unittest import mock

        from .client_views import ClientAnswersView

        real_initial = ClientAnswersView.initial

        def initial(view, request, *args, **kwargs):
            real_initial(view, request, *args, **kwargs)
            Membership.objects.filter(project=self.project, user=self.ada).update(role=Membership.Role.MEMBER)

        with mock.patch.object(ClientAnswersView, "initial", initial):
            response = self.send(self.ada)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_the_two_clients_of_a_project_do_not_share_their_caps(self):
        for _ in range(5):
            self.assertEqual(self.send(self.ada).status_code, 201)

        self.assertEqual(self.send(self.ada).status_code, 429)
        self.assertEqual(self.send(self.bob).status_code, 201)


class ClientLimitsTests(ClientTestCase):
    def test_at_most_five_waiting_answers_per_question_per_person(self):
        for _ in range(5):
            self.assertEqual(self.send(self.ada).status_code, 201)

        self.assertEqual(self.send(self.ada).status_code, 429)
        self.assertEqual(self.send(self.ada, number=2).status_code, 201)

    def test_a_dismissed_answer_no_longer_counts(self):
        for _ in range(5):
            self.send(self.ada)
        AnswerSubmission.objects.update(state="dismissed")

        self.assertEqual(self.send(self.ada).status_code, 201)

    def test_at_most_two_hundred_waiting_answers_per_person_per_project(self):
        AnswerSubmission.objects.bulk_create(
            AnswerSubmission(submitted_by=self.ada, question=self.q1, text="x", submitter_name="Ada Client") for _ in range(200)
        )

        self.assertEqual(self.send(self.ada, number=2).status_code, 429)

    def test_sending_is_limited_per_person_and_says_when_to_try_again(self):
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"client_submit": "2/hour"}):
            statuses = [self.send(self.ada, number=2).status_code for _ in range(3)]
            other = self.send(self.bob, number=2)

        self.assertEqual(statuses, [201, 201, 429])
        self.assertEqual(other.status_code, 201)  # one person's limit is not another's

    def test_reading_is_limited_per_person(self):
        with mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, {"client_read": "2/hour"}):
            statuses = [self.api(self.ada).get(questions_url(self.project)).status_code for _ in range(3)]

        self.assertEqual(statuses, [200, 200, 429])


class ClientEarlierAnswersTests(ClientTestCase):
    """An answer is accepted at the moment its question is answered, which takes the question off the open list.
    So the person's own answers on questions that have closed are shown separately, only theirs, with the state."""

    def test_a_client_sees_their_own_answer_on_a_question_that_has_since_been_answered_and_never_the_teams_answer(self):
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q3, text="Ada's own words", submitter_name="Ada Client", state="accepted")
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q4, text="On a dropped one", submitter_name="Ada Client", state="pending")
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q3, text="Not taken", submitter_name="Ada Client", state="dismissed")
        AnswerSubmission.objects.create(submitted_by=self.bob, question=self.q3, text="BOB'S WORDS", submitter_name="bob@example.invalid", state="accepted")

        response = self.api(self.ada).get(questions_url(self.project))

        earlier = response.json()["earlier"]
        self.assertEqual({(e["label"], e["text"], e["state"]) for e in earlier}, {("Q3", "Ada's own words", "accepted"), ("Q4", "On a dropped one", "pending")})
        self.assertTrue(all(set(e) == {"label", "question_text", "text", "state"} for e in earlier))
        text = response.content.decode()
        self.assertNotIn(TEAMS_ANSWER, text)  # what the team wrote is never shown
        self.assertNotIn("BOB'S WORDS", text)
        self.assertNotIn("Not taken", text)

    def test_a_clients_open_list_does_not_repeat_what_is_in_the_earlier_list(self):
        AnswerSubmission.objects.create(submitted_by=self.ada, question=self.q3, text="Ada's own words", submitter_name="Ada Client", state="accepted")

        body = self.api(self.ada).get(questions_url(self.project)).json()

        self.assertEqual([q["number"] for q in body["questions"]], [1, 2])
        self.assertEqual(len(body["earlier"]), 1)

    def test_nothing_earlier_for_a_client_who_has_sent_nothing(self):
        self.assertEqual(self.api(self.bob).get(questions_url(self.project)).json()["earlier"], [])
