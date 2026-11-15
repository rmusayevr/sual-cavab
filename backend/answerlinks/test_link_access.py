"""What a person holding the link can reach, and what they can never reach (#114)."""

import hashlib
import json
from datetime import timedelta

from django.core.cache import caches
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from questions.models import Answer, Question

from projects.models import Membership

from .models import AnswerLink, AnswerSubmission
from .services import create_link
from .support import (
    LINK_QUESTIONS,
    OTHER_PROJECT_TEXT,
    SECRET_ANSWER,
    LinkTestCase,
    link_answers,
    with_token,
)

NOT_AVAILABLE = {"detail": "This link is not available."}


class TokenStorageTests(LinkTestCase):
    def test_the_plain_token_is_in_no_column_of_any_table_only_its_hash_is_stored(self):
        with connection.cursor() as cursor:
            for table in connection.introspection.table_names(cursor):
                cursor.execute(f'SELECT * FROM "{table}"')
                for row in cursor.fetchall():
                    self.assertNotIn(self.token, str(row), table)

        self.assertEqual(self.link.token_hash, hashlib.sha256(self.token.encode()).hexdigest())

    def test_the_token_is_256_bits_of_url_safe_text(self):
        self.assertRegex(self.token, r"^[A-Za-z0-9_-]{43}$")

    def test_two_links_never_share_a_token(self):
        _, other_token = create_link(self.other, self.outsider, days=7)

        self.assertNotEqual(self.token, other_token)


class UnavailableLinkTests(LinkTestCase):
    """Unknown, malformed, expired, revoked and missing tokens all look the same: no oracle."""

    def baseline(self):
        response = self.public().get(LINK_QUESTIONS, **with_token("x" * 43))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), NOT_AVAILABLE)
        return response.content

    def assert_unavailable(self, **headers):
        response = self.public().get(LINK_QUESTIONS, **headers)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.content, self.baseline())

    def test_no_token_at_all(self):
        self.assert_unavailable()

    def test_malformed_tokens(self):
        for token in ["", " ", "short", "x" * 42, "x" * 44, "x" * 500, "a b" * 15, "../../etc/passwd", "é" * 43]:
            with self.subTest(token=token[:20]):
                try:
                    self.assert_unavailable(**with_token(token))
                except UnicodeEncodeError:
                    pass  # a header that cannot be sent never reaches the server

    def test_a_token_of_the_wrong_shape_never_reaches_the_link_table(self):
        # It cannot match a stored hash, so it is turned away before any lookup (cheap to refuse).
        for token in ["short", "x" * 44, "../../etc/passwd"]:
            with CaptureQueriesContext(connection) as queries:
                self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(token)).status_code, 404)
            self.assertFalse([q for q in queries if "answerlinks_answerlink" in q["sql"]], token)

    def test_an_unknown_token(self):
        self.assert_unavailable(**with_token("Z" * 43))

    def test_an_expired_link(self):
        AnswerLink.objects.filter(pk=self.link.pk).update(expires_at=timezone.now() - timedelta(seconds=1))

        self.assert_unavailable(**with_token(self.token))

    def test_a_revoked_link_stops_working_on_the_very_next_request(self):
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 200)
        AnswerLink.objects.filter(pk=self.link.pk).update(revoked_at=timezone.now())

        self.assert_unavailable(**with_token(self.token))

    def test_a_new_link_revokes_the_old_one_so_a_project_has_one_active_link(self):
        _, new_token = create_link(self.project, self.member, days=14)

        self.assert_unavailable(**with_token(self.token))
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(new_token)).status_code, 200)
        self.assertEqual(AnswerLink.objects.filter(project=self.project, revoked_at__isnull=True).count(), 1)

    def test_a_link_stops_working_when_its_creator_is_no_longer_a_member(self):
        self.project.memberships.filter(user=self.owner).delete()

        self.assert_unavailable(**with_token(self.token))

    def test_a_link_stops_working_when_its_creator_becomes_a_client_of_the_project(self):
        # A client account is not on the team (#121): a link a person made as a member must not outlive that.
        self.project.memberships.filter(user=self.owner).update(role="client")

        self.assert_unavailable(**with_token(self.token))

    def test_a_link_made_by_someone_who_becomes_a_client_stays_dead_when_they_are_a_member_again(self):
        # Through the Django admin a role can change both ways; the link must end, not just pause.
        membership = self.project.memberships.get(user=self.owner)
        membership.role = "client"
        membership.save()
        membership.role = "owner"
        membership.save()

        self.assert_unavailable(**with_token(self.token))

    def test_a_link_stops_working_when_its_creator_is_deactivated(self):
        self.owner.is_active = False
        self.owner.save()

        self.assert_unavailable(**with_token(self.token))

    def test_the_unavailable_answer_is_never_cached_or_indexed(self):
        response = self.public().get(LINK_QUESTIONS, **with_token("Z" * 43))

        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["X-Robots-Tag"], "noindex")


class WhatTheLinkShowsTests(LinkTestCase):
    def get(self):
        return self.public().get(LINK_QUESTIONS, **with_token(self.token))

    def test_exactly_the_open_and_asked_questions_of_the_linked_project(self):
        response = self.get()

        self.assertEqual(response.status_code, 200)
        self.assertEqual([q["number"] for q in response.json()["questions"]], [1, 2])

    def test_the_exact_payload_so_a_new_field_cannot_slip_in(self):
        body = self.get().json()

        self.assertEqual(set(body), {"project_name", "expires_at", "questions"})
        self.assertEqual(body["project_name"], "Ticketing")
        for question in body["questions"]:
            self.assertEqual(set(question), {"number", "label", "text", "why_it_matters", "blocks"})
        self.assertEqual(body["questions"][0]["why_it_matters"], "Why one")
        self.assertEqual(body["questions"][0]["blocks"], "Blocks one")

    def test_nothing_of_another_project_appears(self):
        text = self.get().content.decode()

        self.assertNotIn(OTHER_PROJECT_TEXT, text)
        self.assertNotIn("Booking", text)
        self.assertNotIn("Other Client", text)

    def test_no_answer_member_email_or_internal_id_appears(self):
        text = self.get().content.decode()

        self.assertNotIn(SECRET_ANSWER, text)
        self.assertNotIn("Invented Contact", text)
        for email in (self.owner.email, self.member.email, self.outsider.email):
            self.assertNotIn(email, text)
        self.assertNotIn('"id"', text)
        self.assertNotIn("Invented Client", text)  # the client name is internal too

    def test_answered_and_dropped_questions_are_not_listed(self):
        text = self.get().content.decode()

        self.assertNotIn("Which currency?", text)
        self.assertNotIn("A mobile app?", text)

    def test_the_answer_is_never_cached_or_indexed(self):
        response = self.get()

        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["Referrer-Policy"], "no-referrer")
        self.assertEqual(response["X-Robots-Tag"], "noindex")

    def test_a_signed_in_team_member_opening_the_link_is_just_the_client(self):
        # The cookie of a person who is a member of project B must not widen what link A shows.
        client = APIClient()
        client.force_login(self.outsider)

        text = client.get(LINK_QUESTIONS, **with_token(self.token)).content.decode()

        self.assertIn("Which providers are allowed?", text)
        self.assertNotIn(OTHER_PROJECT_TEXT, text)

    def test_a_session_without_the_token_gets_nothing(self):
        client = APIClient()
        client.force_login(self.owner)

        response = client.get(LINK_QUESTIONS)

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), NOT_AVAILABLE)


class SubmittingTests(LinkTestCase):
    def submit(self, number, text="Use Stripe and PayPal.", name="Leyla", token=None, **extra):
        body = {"text": text, "name": name}
        body.update(extra)
        return self.public().post(link_answers(number), body, format="json", **with_token(token or self.token))

    def test_a_submission_is_created_pending_and_the_reply_has_no_body(self):
        response = self.submit(1)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.content, b"")
        submission = AnswerSubmission.objects.get()
        self.assertEqual(submission.state, AnswerSubmission.State.PENDING)
        self.assertEqual((submission.text, submission.submitter_name), ("Use Stripe and PayPal.", "Leyla"))
        self.assertEqual((submission.link, submission.question), (self.link, self.q1))

    def test_a_question_that_was_asked_can_be_answered_too(self):
        self.assertEqual(self.submit(2).status_code, 201)

    def test_a_submission_never_answers_the_question_or_writes_an_answer(self):
        answers_before = Answer.objects.count()

        self.submit(1)

        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, Question.Status.OPEN)
        self.assertIsNone(self.q1.answered_at)
        self.assertEqual(Answer.objects.count(), answers_before)

    def test_answered_dropped_and_missing_questions_all_answer_the_same_404(self):
        replies = {number: self.submit(number) for number in (3, 4, 99)}

        for number, response in replies.items():
            self.assertEqual(response.status_code, 404, number)
            self.assertEqual(response.json(), NOT_AVAILABLE, number)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_a_question_number_that_exists_only_in_another_project_is_a_404_and_writes_nothing(self):
        response = self.submit(5)  # B's Q5; A has no Q5

        self.assertEqual(response.status_code, 404)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_the_same_number_in_two_projects_resolves_to_the_linked_project(self):
        self.submit(1)

        self.assertEqual(AnswerSubmission.objects.get().question, self.q1)
        self.assertEqual(AnswerSubmission.objects.filter(question=self.other_q1).count(), 0)

    def test_a_missing_question_is_a_404_even_when_the_body_is_invalid(self):
        response = self.public().post(link_answers(99), {}, format="json", **with_token(self.token))

        self.assertEqual(response.status_code, 404)

    def test_the_input_is_checked(self):
        cases = {
            "no name": {"text": "x"},
            "blank name": {"text": "x", "name": "   "},
            "no text": {"name": "Leyla"},
            "blank text": {"text": "", "name": "Leyla"},
            "whitespace text": {"text": "   \n ", "name": "Leyla"},
            "text too long": {"text": "a" * 4001, "name": "Leyla"},
            "name too long": {"text": "x", "name": "n" * 101},
        }
        for label, body in cases.items():
            with self.subTest(label):
                response = self.public().post(link_answers(1), body, format="json", **with_token(self.token))
                self.assertEqual(response.status_code, 400)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_the_longest_allowed_input_is_accepted_and_is_trimmed(self):
        response = self.submit(1, text="  " + "a" * 4000 + "  ", name="n" * 100)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(AnswerSubmission.objects.get().text, "a" * 4000)

    def test_html_is_stored_as_inert_text_exactly_as_typed(self):
        script = "<script>alert('x')</script> & <b>bold</b>"

        self.submit(1, text=script, name="<i>Leyla</i>")

        submission = AnswerSubmission.objects.get()
        self.assertEqual((submission.text, submission.submitter_name), (script, "<i>Leyla</i>"))

    def test_the_submit_reply_is_never_cached_or_indexed(self):
        response = self.submit(1)

        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertEqual(response["X-Robots-Tag"], "noindex")

    def test_at_most_five_pending_submissions_per_question_per_link(self):
        for _ in range(5):
            self.assertEqual(self.submit(1).status_code, 201)

        self.assertEqual(self.submit(1).status_code, 429)
        self.assertEqual(self.submit(2).status_code, 201)  # another question is not affected

    def test_a_dismissed_submission_no_longer_counts_toward_the_question_cap(self):
        for _ in range(5):
            self.submit(1)
        AnswerSubmission.objects.update(state=AnswerSubmission.State.DISMISSED)

        self.assertEqual(self.submit(1).status_code, 201)

    def test_at_most_two_hundred_pending_submissions_per_link(self):
        AnswerSubmission.objects.bulk_create(
            AnswerSubmission(link=self.link, question=self.q1, text="x", submitter_name="n") for _ in range(200)
        )

        self.assertEqual(self.submit(2).status_code, 429)

    def test_a_submission_after_revocation_is_refused_and_writes_nothing(self):
        AnswerLink.objects.filter(pk=self.link.pk).update(revoked_at=timezone.now())

        self.assertEqual(self.submit(1).status_code, 404)
        self.assertEqual(AnswerSubmission.objects.count(), 0)

    def test_the_link_of_one_project_cannot_be_used_for_another_projects_question(self):
        _, other_token = create_link(self.other, self.outsider, days=7)

        response = self.submit(2, token=other_token)  # B has no open Q2

        self.assertEqual(response.status_code, 404)
        self.assertEqual(AnswerSubmission.objects.count(), 0)
        self.assertEqual(json.loads(self.public().get(LINK_QUESTIONS, **with_token(other_token)).content)["project_name"], "Booking")

    def test_caches_are_not_shared_between_requests_with_different_tokens(self):
        caches["throttle"].clear()
        _, other_token = create_link(self.other, self.outsider, days=7)

        first = self.public().get(LINK_QUESTIONS, **with_token(self.token)).json()
        second = self.public().get(LINK_QUESTIONS, **with_token(other_token)).json()

        self.assertNotEqual(first["questions"], second["questions"])


class ARevokedLinkStaysRevokedTests(LinkTestCase):
    """Review of #117: stopping because the creator is gone must be permanent, not undone by coming back."""

    def test_reactivating_the_creator_does_not_bring_the_link_back(self):
        self.owner.is_active = False
        self.owner.save()
        self.owner.is_active = True
        self.owner.save()

        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 404)
        self.assertIsNotNone(AnswerLink.objects.get(pk=self.link.pk).revoked_at)

    def test_adding_the_creator_back_to_the_project_does_not_bring_the_link_back(self):
        # Removed outside the members API (the Django admin deletes the row like this).
        self.project.memberships.filter(user=self.owner).delete()
        Membership.objects.create(project=self.project, user=self.owner, role=Membership.Role.OWNER)

        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 404)
        self.assertIsNotNone(AnswerLink.objects.get(pk=self.link.pk).revoked_at)

    def test_a_removal_only_ends_the_links_that_person_made_in_that_project(self):
        _, other_token = create_link(self.other, self.outsider, days=7)
        Membership.objects.create(project=self.other, user=self.owner, role=Membership.Role.MEMBER)

        Membership.objects.filter(project=self.other, user=self.owner).delete()  # the owner never made B's link

        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 200)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(other_token)).status_code, 200)

    def test_deactivating_someone_ends_only_their_links(self):
        _, other_token = create_link(self.other, self.outsider, days=7)
        self.owner.is_active = False
        self.owner.save()

        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 404)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(other_token)).status_code, 200)


class StaleAuthenticationTests(LinkTestCase):
    def test_a_revoke_that_lands_after_authentication_still_stops_the_submission(self):
        """The view re-checks the link under its lock: a link revoked between authentication and the write
        must not take a submission (authentication here hands over a link that was valid a moment ago)."""
        from unittest import mock

        from django.contrib.auth.models import AnonymousUser

        from .authentication import AnswerLinkAuthentication

        stale = AnswerLink.objects.get(pk=self.link.pk)
        AnswerLink.objects.filter(pk=self.link.pk).update(revoked_at=timezone.now())

        with mock.patch.object(AnswerLinkAuthentication, "authenticate", return_value=(AnonymousUser(), stale)):
            response = self.public().post(link_answers(1), {"text": "x", "name": "n"}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(AnswerSubmission.objects.count(), 0)
