"""Questions with status and recorded answers (#6).

Access: any member of a project (owner or member) can list, add, edit, change
the status of and answer its questions; everyone else gets a 404.
"""

import threading

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, connections, transaction
from django.db.models import ProtectedError
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Membership, Project

from .models import Answer, Question
from .services import TRANSITIONS, TransitionNotAllowed, change_status

PASSWORD = "invented-test-password"


def make_user(email):
    return get_user_model().objects.create_user(email=email, password=PASSWORD)


def answer_payload(**overrides):
    return {
        "text": "Refunds are allowed within 14 days.",
        "answered_by": "Invented Contact",
        "answered_on": timezone.localdate().isoformat(),
        "channel": "email",
        **overrides,
    }


class QuestionTestCase(TestCase):
    def setUp(self):
        self.owner = make_user("owner@example.com")
        self.member = make_user("member@example.com")
        self.outsider = make_user("outsider@example.com")
        self.project = self.make_project("Ticketing", self.owner, self.member)

    def make_project(self, name, owner, member=None):
        project = Project.objects.create(name=name, client_name="Invented Client", created_by=owner)
        Membership.objects.create(project=project, user=owner, role=Membership.Role.OWNER)
        if member:
            Membership.objects.create(project=project, user=member, role=Membership.Role.MEMBER)
        return project

    def as_user(self, user):
        client = APIClient()
        client.force_authenticate(user)
        return client

    def url(self, project=None, number=None, suffix=""):
        base = f"/api/projects/{(project or self.project).pk}/questions/"
        return f"{base}{number}/{suffix}" if number else base

    def ask(self, text="What is the refund window?", user=None, project=None, **extra):
        response = self.as_user(user or self.owner).post(self.url(project), {"text": text, **extra}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def move(self, number, to, user=None, project=None, **extra):
        return self.as_user(user or self.owner).post(
            self.url(project, number, "transition/"), {"to": to, **extra}, format="json"
        )

    def db_question(self, number, project=None):
        return Question.objects.get(project=project or self.project, number=number)


class NumberingTests(QuestionTestCase):
    def test_questions_are_numbered_q1_q2_q3(self):
        labels = [self.ask(f"Question {n}")["label"] for n in range(3)]

        self.assertEqual(labels, ["Q1", "Q2", "Q3"])

    def test_each_project_numbers_from_one(self):
        other = self.make_project("Refunds", self.owner)
        self.ask("First in Ticketing")

        self.assertEqual(self.ask("First in Refunds", project=other)["number"], 1)

    def test_a_dropped_questions_number_is_never_reused(self):
        for n in range(3):
            self.ask(f"Question {n}")
        self.move(3, "dropped")

        self.assertEqual(self.ask("After the drop")["number"], 4)

    def test_the_same_number_cannot_exist_twice_in_a_project(self):
        self.ask("Q1")

        with self.assertRaises(IntegrityError), transaction.atomic():
            Question.objects.create(project=self.project, number=1, text="Duplicate", created_by=self.owner)


class ConcurrentNumberingTests(TransactionTestCase):
    """Real threads and real PostgreSQL transactions: the lock must hand out
    each number once."""

    def test_simultaneous_creates_get_distinct_numbers(self):
        owner = make_user("owner@example.com")
        project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=owner)
        Membership.objects.create(project=project, user=owner, role=Membership.Role.OWNER)
        results, errors = [], []

        def create(n):
            try:
                client = APIClient()
                client.force_authenticate(owner)
                response = client.post(f"/api/projects/{project.pk}/questions/", {"text": f"Concurrent {n}"}, format="json")
                results.append((response.status_code, response.json().get("number")))
            except Exception as exc:  # pragma: no cover - reported below
                errors.append(repr(exc))
            finally:
                connections.close_all()

        threads = [threading.Thread(target=create, args=(n,)) for n in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), [(201, n) for n in range(1, 9)])


class TransitionRuleTests(QuestionTestCase):
    """The approved table, as the service enforces it."""

    def question_in(self, status):
        return Question.objects.create(
            project=self.project, number=Question.objects.count() + 1, text="x", status=status, created_by=self.owner
        )

    def test_every_allowed_transition_works(self):
        for current, targets in TRANSITIONS.items():
            for to in targets:
                with self.subTest(f"{current} -> {to}"):
                    question = self.question_in(current)
                    change_status(question, to, self.owner, answer=answer_payload() if to == "answered" else None)

                    self.assertEqual(question.status, to)

    def test_every_other_transition_is_refused(self):
        for current in Question.Status:
            for to in Question.Status:
                if to in TRANSITIONS[current]:
                    continue
                with self.subTest(f"{current} -> {to}"):
                    question = self.question_in(current)

                    with self.assertRaises(TransitionNotAllowed):
                        change_status(question, to, self.owner, answer=answer_payload())
                    question.refresh_from_db()
                    self.assertEqual(question.status, current)


class TransitionApiTests(QuestionTestCase):
    def test_marking_answered_requires_an_answer(self):
        self.ask()

        self.assertEqual(self.move(1, "answered").status_code, 400)
        self.assertEqual(self.db_question(1).status, "open")

    def test_an_answer_with_any_other_status_is_refused(self):
        self.ask()

        self.assertEqual(self.move(1, "asked", answer=answer_payload()).status_code, 400)

    def test_a_refused_transition_names_the_allowed_ones(self):
        self.ask()
        self.move(1, "answered", answer=answer_payload())

        response = self.move(1, "dropped")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["allowed"], ["open"])

    def test_staying_in_the_same_status_is_refused(self):
        self.ask()
        self.move(1, "asked")

        self.assertEqual(self.move(1, "asked").status_code, 400)

    def test_asking_records_when(self):
        self.ask()

        body = self.move(1, "asked").json()

        self.assertIsNotNone(body["asked_at"])

    def test_an_unknown_status_is_refused(self):
        self.ask()

        self.assertEqual(self.move(1, "finished").status_code, 400)

    def test_an_answer_records_who_when_where_and_who_recorded_it(self):
        self.ask()

        body = self.move(1, "answered", answer=answer_payload(channel="meeting", channel_note="Kickoff call")).json()

        current = body["current_answer"]
        self.assertEqual(
            (current["answered_by"], current["channel"], current["channel_note"], current["recorded_by"]),
            ("Invented Contact", "meeting", "Kickoff call", "owner@example.com"),
        )
        self.assertEqual(body["status"], "answered")

    def test_an_answer_needs_text_and_a_source(self):
        self.ask()

        for field in ("text", "answered_by", "channel", "answered_on"):
            with self.subTest(field):
                payload = answer_payload()
                del payload[field]
                self.assertEqual(self.move(1, "answered", answer=payload).status_code, 400)

    def test_a_blank_answer_is_refused(self):
        self.ask()

        self.assertEqual(self.move(1, "answered", answer=answer_payload(text="   ")).status_code, 400)

    def test_an_answer_dated_in_the_future_is_refused(self):
        self.ask()
        tomorrow = (timezone.localdate() + timezone.timedelta(days=1)).isoformat()

        self.assertEqual(self.move(1, "answered", answer=answer_payload(answered_on=tomorrow)).status_code, 400)


class AnswerHistoryTests(QuestionTestCase):
    def test_reopening_keeps_the_old_answer_as_history(self):
        self.ask()
        self.move(1, "answered", answer=answer_payload(text="First answer"))

        body = self.move(1, "open").json()

        self.assertEqual(body["status"], "open")
        self.assertIsNone(body["current_answer"])
        self.assertEqual([a["text"] for a in body["previous_answers"]], ["First answer"])
        self.assertIsNotNone(body["previous_answers"][0]["superseded_at"])

    def test_answering_again_adds_a_new_answer_and_keeps_the_old_one(self):
        self.ask()
        self.move(1, "answered", answer=answer_payload(text="First answer"))
        self.move(1, "open")

        body = self.move(1, "answered", answer=answer_payload(text="Corrected answer")).json()

        self.assertEqual(body["current_answer"]["text"], "Corrected answer")
        self.assertEqual([a["text"] for a in body["previous_answers"]], ["First answer"])
        self.assertEqual(Answer.objects.filter(question=self.db_question(1)).count(), 2)

    def test_a_question_cannot_have_two_current_answers(self):
        self.ask()
        self.move(1, "answered", answer=answer_payload())
        question = self.db_question(1)

        with self.assertRaises(IntegrityError), transaction.atomic():
            Answer.objects.create(
                question=question, text="Second", answered_by="x", answered_on=timezone.localdate(),
                channel="chat", recorded_by=self.owner,
            )

    def test_timestamps_are_kept_when_a_status_is_left(self):
        self.ask()
        self.move(1, "asked")
        asked_at = self.db_question(1).asked_at

        self.move(1, "open")

        self.assertEqual(self.db_question(1).asked_at, asked_at)

    def test_an_answer_cannot_be_rewritten_through_the_question(self):
        # Answers are history: the only way to change one is to re-open the
        # question and answer again. Try to write it through the question.
        self.ask()
        self.move(1, "answered", answer=answer_payload(text="Original answer"))

        self.as_user(self.owner).patch(
            self.url(number=1),
            {"current_answer": {"text": "Rewritten"}, "previous_answers": [], "answers": []},
            format="json",
        )

        self.assertEqual(list(Answer.objects.values_list("text", flat=True)), ["Original answer"])


class AccessTests(QuestionTestCase):
    """Any member can work with questions; outsiders get a 404."""

    def test_an_owner_adds_a_question(self):
        self.assertEqual(self.as_user(self.owner).post(self.url(), {"text": "Q"}, format="json").status_code, 201)

    def test_a_member_adds_a_question(self):
        self.assertEqual(self.as_user(self.member).post(self.url(), {"text": "Q"}, format="json").status_code, 201)

    def test_a_member_edits_a_question(self):
        self.ask()

        response = self.as_user(self.member).patch(self.url(number=1), {"text": "Reworded"}, format="json")

        self.assertEqual(response.status_code, 200)

    def test_a_member_answers_a_question(self):
        self.ask()

        self.assertEqual(self.move(1, "answered", user=self.member, answer=answer_payload()).status_code, 200)

    def test_an_owner_answers_a_question(self):
        self.ask()

        self.assertEqual(self.move(1, "answered", user=self.owner, answer=answer_payload()).status_code, 200)

    def test_an_outsider_gets_404_listing_questions(self):
        self.assertEqual(self.as_user(self.outsider).get(self.url()).status_code, 404)

    def test_an_outsider_gets_404_adding_a_question(self):
        response = self.as_user(self.outsider).post(self.url(), {"text": "Q"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Question.objects.count(), 0)

    def test_an_outsider_gets_404_reading_a_question(self):
        self.ask()

        self.assertEqual(self.as_user(self.outsider).get(self.url(number=1)).status_code, 404)

    def test_an_outsider_gets_404_editing_a_question(self):
        self.ask("Original")

        response = self.as_user(self.outsider).patch(self.url(number=1), {"text": "Hijacked"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.db_question(1).text, "Original")

    def test_an_outsider_gets_404_changing_a_status(self):
        self.ask()

        self.assertEqual(self.move(1, "dropped", user=self.outsider).status_code, 404)
        self.assertEqual(self.db_question(1).status, "open")

    def test_an_outsider_gets_the_same_404_as_for_a_project_that_does_not_exist(self):
        client = self.as_user(self.outsider)

        hidden = client.get(self.url())
        missing = client.get("/api/projects/999999/questions/")

        self.assertEqual((hidden.status_code, hidden.json()), (missing.status_code, missing.json()))

    def test_a_removed_member_loses_access(self):
        self.ask()
        Membership.objects.filter(project=self.project, user=self.member).delete()

        self.assertEqual(self.as_user(self.member).get(self.url()).status_code, 404)

    def test_a_superuser_who_is_not_a_member_gets_404(self):
        admin = get_user_model().objects.create_superuser(email="root@example.com", password=PASSWORD)

        self.assertEqual(self.as_user(admin).get(self.url()).status_code, 404)

    def test_anonymous_requests_are_refused(self):
        self.assertEqual(APIClient().get(self.url()).status_code, 403)

    def test_a_question_of_another_project_is_not_reachable_through_my_project(self):
        other = self.make_project("Someone else's", self.outsider)
        self.ask("Secret", user=self.outsider, project=other)
        client = self.as_user(self.member)

        # Q1 exists in `other`, which this member is not on, and Q1 does not
        # exist in my project: neither path may return it.
        self.assertEqual(client.get(self.url(project=other, number=1)).status_code, 404)
        self.assertEqual(client.get(self.url(number=1)).status_code, 404)

    def test_there_is_no_delete(self):
        self.ask()

        self.assertEqual(self.as_user(self.owner).delete(self.url(number=1)).status_code, 405)


class ListAndEditTests(QuestionTestCase):
    def test_the_list_is_in_number_order_with_labels(self):
        for n in range(3):
            self.ask(f"Question {n}")

        labels = [q["label"] for q in self.as_user(self.member).get(self.url()).json()]

        self.assertEqual(labels, ["Q1", "Q2", "Q3"])

    def test_the_list_filters_by_status(self):
        for n in range(4):
            self.ask(f"Question {n}")
        self.move(2, "asked")
        self.move(3, "answered", answer=answer_payload())
        self.move(4, "dropped")

        response = self.as_user(self.member).get(self.url() + "?status=open,asked")

        self.assertEqual([q["label"] for q in response.json()], ["Q1", "Q2"])

    def test_an_unknown_status_filter_is_refused_not_ignored(self):
        self.ask()

        self.assertEqual(self.as_user(self.member).get(self.url() + "?status=opne").status_code, 400)

    def test_an_empty_status_filter_is_refused_not_ignored(self):
        self.ask()

        self.assertEqual(self.as_user(self.member).get(self.url() + "?status=").status_code, 400)

    def test_editing_changes_only_the_text_fields(self):
        self.ask("Original", why_it_matters="Because", blocks="Checkout")

        body = self.as_user(self.member).patch(
            self.url(number=1), {"text": "Reworded", "blocks": "Refund flow"}, format="json"
        ).json()

        self.assertEqual((body["text"], body["why_it_matters"], body["blocks"]), ("Reworded", "Because", "Refund flow"))

    def test_status_number_and_project_cannot_be_set_by_an_edit(self):
        other = self.make_project("Other", self.owner)
        self.ask()

        self.as_user(self.owner).patch(
            self.url(number=1), {"status": "answered", "number": 99, "project": other.pk}, format="json"
        )

        question = self.db_question(1)
        self.assertEqual((question.status, question.number, question.project_id), ("open", 1, self.project.pk))

    def test_a_put_with_a_missing_text_is_refused_and_changes_nothing(self):
        self.ask("Original")

        response = self.as_user(self.owner).put(self.url(number=1), {"why_it_matters": "x"}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db_question(1).text, "Original")

    def test_a_question_needs_text(self):
        self.assertEqual(self.as_user(self.owner).post(self.url(), {"text": ""}, format="json").status_code, 400)

    def test_a_new_question_is_open_and_credited_to_its_creator(self):
        body = self.ask()

        self.assertEqual(body["status"], "open")
        self.assertEqual(self.db_question(1).created_by, self.owner)


class StaleWriteTests(QuestionTestCase):
    """Review of #21: a save that writes every column from a copy loaded earlier
    overwrites what a concurrent request changed. Each test makes the view load
    its copy, changes the database behind its back, then lets the view save."""

    def after_get_object(self, viewset, action):
        """Patch `viewset.get_object` so `action()` runs right after it loads."""
        from unittest import mock

        real = viewset.get_object

        def wrapper(view):
            obj = real(view)
            action()
            return obj

        return mock.patch.object(viewset, "get_object", wrapper)

    def test_a_project_edit_does_not_rewind_the_question_counter(self):
        from projects.views import ProjectViewSet

        with self.after_get_object(ProjectViewSet, lambda: self.ask("Created during the edit")):
            response = self.as_user(self.owner).patch(
                f"/api/projects/{self.project.pk}/", {"name": "Renamed"}, format="json"
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.ask("After the edit")["number"], 2)

    def test_the_project_admin_does_not_write_the_question_counter(self):
        from types import SimpleNamespace

        from django.contrib import admin

        stale = Project.objects.get(pk=self.project.pk)
        self.ask("Created while the admin form was open")
        stale.name = "Renamed in the admin"

        admin.site._registry[Project].save_model(None, stale, SimpleNamespace(changed_data=["name"]), change=True)

        self.project.refresh_from_db()
        self.assertEqual((self.project.name, self.project.next_question_number), ("Renamed in the admin", 2))
        self.assertEqual(self.ask("Next")["number"], 2)

    def test_the_counter_is_not_editable_in_the_project_admin(self):
        from django.contrib import admin

        self.assertIn("next_question_number", admin.site._registry[Project].readonly_fields)

    def test_an_edit_does_not_overwrite_an_answer_given_meanwhile(self):
        from .views import QuestionViewSet

        self.ask("Original")

        def answer_meanwhile():
            self.move(1, "answered", answer=answer_payload())

        with self.after_get_object(QuestionViewSet, answer_meanwhile):
            response = self.as_user(self.owner).patch(self.url(number=1), {"text": "Reworded"}, format="json")

        question = self.db_question(1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((question.text, question.status), ("Reworded", "answered"))
        self.assertIsNotNone(question.answered_at)
        self.assertEqual(response.json()["status"], "answered")
        self.assertIsNotNone(response.json()["current_answer"])  # the response shows the row as it is now

    def test_a_question_edited_while_being_answered_can_still_be_reopened_and_answered_again(self):
        from .views import QuestionViewSet

        self.ask("Original")
        with self.after_get_object(QuestionViewSet, lambda: self.move(1, "answered", answer=answer_payload())):
            self.as_user(self.owner).patch(self.url(number=1), {"text": "Reworded"}, format="json")

        self.assertEqual(self.move(1, "open").status_code, 200)
        self.assertEqual(self.move(1, "answered", answer=answer_payload(text="Again")).status_code, 200)

    def test_an_edit_does_not_undo_a_reopen_done_meanwhile(self):
        from .views import QuestionViewSet

        self.ask("Original")
        self.move(1, "answered", answer=answer_payload())

        with self.after_get_object(QuestionViewSet, lambda: self.move(1, "open")):
            self.as_user(self.owner).patch(self.url(number=1), {"text": "Reworded"}, format="json")

        self.assertEqual(self.db_question(1).status, "open")
        self.assertEqual(Answer.objects.filter(superseded_at__isnull=True).count(), 0)

    def test_the_question_admin_does_not_write_the_status(self):
        from types import SimpleNamespace

        from django.contrib import admin

        self.ask("Original")
        stale = self.db_question(1)
        self.move(1, "answered", answer=answer_payload())
        stale.text = "Fixed typo in the admin"

        admin.site._registry[Question].save_model(None, stale, SimpleNamespace(changed_data=["text"]), change=True)

        question = self.db_question(1)
        self.assertEqual((question.text, question.status), ("Fixed typo in the admin", "answered"))

    def test_the_question_admin_cannot_change_status_add_or_delete(self):
        from django.contrib import admin
        from django.test import RequestFactory

        model_admin = admin.site._registry[Question]
        request = RequestFactory().get("/")
        request.user = get_user_model().objects.create_superuser(email="root@example.com", password=PASSWORD)

        # The admin form may edit the three text fields and nothing else.
        self.assertEqual(sorted(model_admin.get_form(request).base_fields), ["blocks", "text", "why_it_matters"])
        self.assertFalse(model_admin.has_add_permission(request))
        self.assertFalse(model_admin.has_delete_permission(request))


class RemovedMidRequestTests(QuestionTestCase):
    """A member removed after the view's membership check must not get a write
    through: the check is repeated under a row lock before writing."""

    def removing_membership_after_the_check(self):
        from unittest import mock

        from .views import QuestionViewSet

        real_initial = QuestionViewSet.initial

        def initial(view, request, *args, **kwargs):
            real_initial(view, request, *args, **kwargs)
            Membership.objects.filter(project=self.project, user=self.member).delete()

        return mock.patch.object(QuestionViewSet, "initial", initial)

    def test_a_member_removed_mid_request_cannot_add_a_question(self):
        with self.removing_membership_after_the_check():
            response = self.as_user(self.member).post(self.url(), {"text": "Too late"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Question.objects.count(), 0)
        self.project.refresh_from_db()
        self.assertEqual(self.project.next_question_number, 1)

    def test_a_member_removed_mid_request_cannot_change_a_status(self):
        self.ask()

        with self.removing_membership_after_the_check():
            response = self.move(1, "dropped", user=self.member)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.db_question(1).status, "open")

    def test_a_member_removed_mid_request_cannot_edit_a_question(self):
        self.ask("Original")

        with self.removing_membership_after_the_check():
            response = self.as_user(self.member).patch(self.url(number=1), {"text": "Too late"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.db_question(1).text, "Original")


class DataSafetyTests(QuestionTestCase):
    def test_the_database_stores_utf8(self):
        with connection.cursor() as cursor:
            cursor.execute("SHOW server_encoding")
            self.assertEqual(cursor.fetchone()[0], "UTF8")

    def test_azerbaijani_text_survives_a_round_trip(self):
        text = "Müştəri kartı üçün ödəniş limiti nə qədərdir? Ğ ğ İ ı Ö ö Ü ü Ç ç Ş ş Ə ə"
        answer = "Limit 500 manatdır; “texniki” terminlər English qalır: refund, webhook."
        self.ask(text, why_it_matters="Ödəniş səhifəsi üçün vacibdir", blocks="Çıxış (checkout) axını")
        self.move(1, "answered", answer=answer_payload(text=answer, answered_by="Əli Məmmədov"))

        body = self.as_user(self.member).get(self.url(number=1)).json()

        self.assertEqual(body["text"], text)
        self.assertEqual(body["why_it_matters"], "Ödəniş səhifəsi üçün vacibdir")
        self.assertEqual((body["current_answer"]["text"], body["current_answer"]["answered_by"]), (answer, "Əli Məmmədov"))

    def test_a_project_with_questions_cannot_be_deleted(self):
        self.ask()

        with self.assertRaises(ProtectedError):
            self.project.delete()

    def test_a_question_with_an_answer_cannot_be_deleted(self):
        self.ask()
        self.move(1, "answered", answer=answer_payload())

        with self.assertRaises(ProtectedError):
            self.db_question(1).delete()

    def test_a_user_who_recorded_an_answer_cannot_be_deleted(self):
        self.ask()
        self.move(1, "answered", user=self.member, answer=answer_payload())

        with self.assertRaises(ProtectedError):
            self.member.delete()

    def test_existing_projects_start_numbering_at_one(self):
        # The column the migration adds: every project starts at 1.
        self.assertEqual(Project.objects.get(pk=self.project.pk).next_question_number, 1)
