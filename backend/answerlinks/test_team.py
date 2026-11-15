"""What the team does with the link and with what clients send (#114). Session-authenticated, members only."""

import threading
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone

from projects.models import Membership
from questions.models import Answer, Question

from .models import AnswerLink, AnswerSubmission
from .services import create_link
from .support import PASSWORD, LinkTestCase, LINK_QUESTIONS, with_token


class CreateLinkTests(LinkTestCase):
    def url(self, project=None):
        return self.team_url("answer-link/", project)

    def test_any_member_can_create_a_link_and_gets_the_token_once(self):
        response = self.as_user(self.member).post(self.url(), {}, format="json")

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(set(body), {"token", "state", "exists", "created_by", "created_at", "expires_at", "revoked_at"})
        self.assertEqual(body["state"], "active")
        self.assertEqual(body["created_by"], self.member.email)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(body["token"])).status_code, 200)

    def test_the_default_is_fourteen_days(self):
        body = self.as_user(self.owner).post(self.url(), {}, format="json").json()

        expires = timezone.datetime.fromisoformat(body["expires_at"].replace("Z", "+00:00"))
        self.assertAlmostEqual((expires - timezone.now()).total_seconds(), 14 * 86400, delta=120)

    def test_the_creator_picks_one_to_thirty_days(self):
        for days in (1, 30):
            self.assertEqual(self.as_user(self.owner).post(self.url(), {"days": days}, format="json").status_code, 201)

    def test_other_lengths_are_refused_and_nothing_is_created(self):
        before = AnswerLink.objects.count()
        for days in (0, 31, -1, "x", 2.5, None, True):
            with self.subTest(days=days):
                response = self.as_user(self.owner).post(self.url(), {"days": days}, format="json")
                self.assertEqual(response.status_code, 400)
        self.assertEqual(AnswerLink.objects.count(), before)
        self.assertTrue(AnswerLink.objects.get(pk=self.link.pk).revoked_at is None)  # the old one is untouched

    def test_creating_a_link_revokes_the_previous_one(self):
        old_token = self.token

        new_token = self.as_user(self.member).post(self.url(), {}, format="json").json()["token"]

        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(old_token)).status_code, 404)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(new_token)).status_code, 200)

    def test_a_person_who_is_not_a_member_gets_a_404_and_creates_nothing(self):
        before = AnswerLink.objects.count()

        response = self.as_user(self.outsider).post(self.url(), {}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(AnswerLink.objects.count(), before)

    def test_nobody_signed_out_can_create_one(self):
        self.assertEqual(self.public().post(self.url(), {}, format="json").status_code, 403)

    def test_a_removed_members_session_cannot_create_one(self):
        self.project.memberships.filter(user=self.member).delete()

        self.assertEqual(self.as_user(self.member).post(self.url(), {}, format="json").status_code, 404)


class LinkStateTests(LinkTestCase):
    def url(self):
        return self.team_url("answer-link/")

    def test_no_link_yet(self):
        AnswerLink.objects.all().delete()

        body = self.as_user(self.member).get(self.url()).json()

        self.assertEqual(body, {"exists": False})

    def test_an_active_link_never_shows_its_token_or_hash(self):
        response = self.as_user(self.member).get(self.url())

        text = response.content.decode()
        self.assertNotIn(self.token, text)
        self.assertNotIn(self.link.token_hash, text)
        body = response.json()
        self.assertEqual(set(body), {"exists", "state", "created_by", "created_at", "expires_at", "revoked_at"})
        self.assertEqual((body["exists"], body["state"], body["created_by"]), (True, "active", self.owner.email))

    def test_expired_and_revoked_are_told_apart_to_the_team(self):
        AnswerLink.objects.filter(pk=self.link.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.as_user(self.member).get(self.url()).json()["state"], "expired")

        AnswerLink.objects.filter(pk=self.link.pk).update(revoked_at=timezone.now())
        self.assertEqual(self.as_user(self.member).get(self.url()).json()["state"], "revoked")

    def test_only_a_member_can_see_it(self):
        self.assertEqual(self.as_user(self.outsider).get(self.url()).status_code, 404)
        self.assertEqual(self.public().get(self.url()).status_code, 403)


class RevokeLinkTests(LinkTestCase):
    def url(self):
        return self.team_url("answer-link/")

    def test_any_member_can_revoke_and_the_link_stops_at_once(self):
        response = self.as_user(self.member).delete(self.url())

        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 404)
        link = AnswerLink.objects.get(pk=self.link.pk)
        self.assertEqual(link.revoked_by, self.member)
        self.assertIsNotNone(link.revoked_at)

    def test_revoking_again_is_harmless(self):
        self.as_user(self.member).delete(self.url())

        self.assertEqual(self.as_user(self.member).delete(self.url()).status_code, 204)

    def test_a_person_who_is_not_a_member_cannot_revoke(self):
        self.assertEqual(self.as_user(self.outsider).delete(self.url()).status_code, 404)
        self.assertEqual(self.public().delete(self.url()).status_code, 403)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 200)

    def test_pending_submissions_survive_a_revoke(self):
        AnswerSubmission.objects.create(link=self.link, question=self.q1, text="x", submitter_name="Leyla")

        self.as_user(self.member).delete(self.url())

        self.assertEqual(AnswerSubmission.objects.filter(state="pending").count(), 1)


class RemovingAMemberTests(LinkTestCase):
    def test_removing_a_member_revokes_the_links_they_created_and_only_those(self):
        member_link, member_token = create_link(self.project, self.member, days=14)  # revokes the owner's
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(member_token)).status_code, 200)
        other_link, other_token = create_link(self.other, self.outsider, days=14)

        response = self.as_user(self.owner).delete(f"/api/projects/{self.project.pk}/members/{self.member.pk}/")

        self.assertEqual(response.status_code, 204)
        member_link.refresh_from_db()
        self.assertEqual(member_link.revoked_by, self.owner)
        self.assertIsNotNone(member_link.revoked_at)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(member_token)).status_code, 404)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(other_token)).status_code, 200)

    def test_a_link_made_by_someone_else_survives_a_removal(self):
        # The owner made the link; the member is removed; the owner's link is not theirs to lose.
        self.as_user(self.owner).delete(f"/api/projects/{self.project.pk}/members/{self.member.pk}/")

        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 200)

    def test_a_refused_removal_revokes_nothing(self):
        # A member cannot remove anyone: 403, and the owner's link must stay.
        response = self.as_user(self.member).delete(f"/api/projects/{self.project.pk}/members/{self.owner.pk}/")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 200)


class SubmissionListTests(LinkTestCase):
    def setUp(self):
        super().setUp()
        self.s1 = AnswerSubmission.objects.create(link=self.link, question=self.q1, text="Stripe", submitter_name="Leyla")
        self.s2 = AnswerSubmission.objects.create(
            link=self.link, question=self.q2, text="Ali approves", submitter_name="Murad",
            state=AnswerSubmission.State.DISMISSED, decided_by=self.owner, decided_at=timezone.now(),
        )
        other_link, _ = create_link(self.other, self.outsider, days=7)
        self.other_submission = AnswerSubmission.objects.create(
            link=other_link, question=self.other_q1, text="Other project secret", submitter_name="Someone"
        )

    def url(self, query=""):
        return self.team_url("submissions/" + query)

    def test_pending_is_the_default_and_shows_who_and_when(self):
        response = self.as_user(self.member).get(self.url())

        self.assertEqual(response.status_code, 200)
        (item,) = response.json()
        self.assertEqual(
            set(item),
            {"id", "question_number", "question_label", "question_text", "text", "submitter_name", "submitted_at",
             "state", "decided_by", "decided_at"},
        )
        self.assertEqual((item["submitter_name"], item["text"], item["question_label"]), ("Leyla", "Stripe", "Q1"))
        self.assertTrue(item["submitted_at"])

    def test_the_other_states_can_be_asked_for(self):
        dismissed = self.as_user(self.member).get(self.url("?state=dismissed")).json()

        self.assertEqual([i["submitter_name"] for i in dismissed], ["Murad"])
        self.assertEqual(dismissed[0]["decided_by"], self.owner.email)

    def test_an_unknown_state_is_refused_not_read_as_nothing_pending(self):
        self.assertEqual(self.as_user(self.member).get(self.url("?state=oops")).status_code, 400)

    def test_another_projects_submissions_never_appear(self):
        for state in ("pending", "accepted", "dismissed"):
            text = self.as_user(self.member).get(self.url(f"?state={state}")).content.decode()
            self.assertNotIn("Other project secret", text)

    def test_only_members_can_list(self):
        self.assertEqual(self.as_user(self.outsider).get(self.url()).status_code, 404)
        self.assertEqual(self.public().get(self.url()).status_code, 403)


class DecideTests(LinkTestCase):
    def setUp(self):
        super().setUp()
        self.s1 = AnswerSubmission.objects.create(
            link=self.link, question=self.q1, text="Use Stripe.", submitter_name="Leyla"
        )

    def accept_url(self, submission=None, project=None):
        return self.team_url(f"submissions/{(submission or self.s1).pk}/accept/", project)

    def dismiss_url(self, submission=None):
        return self.team_url(f"submissions/{(submission or self.s1).pk}/dismiss/")

    def test_accepting_answers_the_question_and_marks_the_answer_as_from_the_link(self):
        response = self.as_user(self.member).post(self.accept_url(), {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, Question.Status.ANSWERED)
        answer = self.q1.answers.get(superseded_at__isnull=True)
        self.assertEqual(answer.channel, Answer.Channel.LINK)
        self.assertEqual((answer.text, answer.answered_by), ("Use Stripe.", "Leyla"))
        self.assertEqual(answer.recorded_by, self.member)
        self.assertEqual(answer.answered_on, timezone.localdate())
        self.s1.refresh_from_db()
        self.assertEqual(
            (self.s1.state, self.s1.decided_by, self.s1.answer), (AnswerSubmission.State.ACCEPTED, self.member, answer)
        )
        self.assertIsNotNone(self.s1.decided_at)

    def test_the_member_may_edit_the_text_and_the_original_is_kept(self):
        response = self.as_user(self.member).post(self.accept_url(), {"text": "Stripe only."}, format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.q1.answers.get().text, "Stripe only.")
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.text, "Use Stripe.")

    def test_a_blank_edited_text_is_refused(self):
        response = self.as_user(self.member).post(self.accept_url(), {"text": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.state, AnswerSubmission.State.PENDING)

    def test_accepting_when_the_question_is_already_answered_is_refused_and_changes_nothing(self):
        Question.objects.filter(pk=self.q1.pk).update(status=Question.Status.ANSWERED)
        answers_before = Answer.objects.count()

        response = self.as_user(self.member).post(self.accept_url(), {}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Answer.objects.count(), answers_before)
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.state, AnswerSubmission.State.PENDING)

    def test_a_submission_is_decided_once(self):
        self.as_user(self.member).post(self.accept_url(), {}, format="json")

        self.assertEqual(self.as_user(self.member).post(self.accept_url(), {}, format="json").status_code, 400)
        self.assertEqual(self.as_user(self.member).post(self.dismiss_url(), {}, format="json").status_code, 400)

    def test_other_pending_submissions_for_the_question_stay_pending_after_one_is_accepted(self):
        s2 = AnswerSubmission.objects.create(link=self.link, question=self.q1, text="PayPal", submitter_name="Murad")

        self.as_user(self.member).post(self.accept_url(), {}, format="json")

        s2.refresh_from_db()
        self.assertEqual(s2.state, AnswerSubmission.State.PENDING)

    def test_dismissing_marks_it_and_leaves_the_question_alone(self):
        response = self.as_user(self.member).post(self.dismiss_url(), {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.s1.refresh_from_db()
        self.assertEqual((self.s1.state, self.s1.decided_by), (AnswerSubmission.State.DISMISSED, self.member))
        self.q1.refresh_from_db()
        self.assertEqual(self.q1.status, Question.Status.OPEN)
        self.assertEqual(Answer.objects.filter(question=self.q1).count(), 0)

    def test_dismiss_all_pending_for_spam(self):
        AnswerSubmission.objects.create(link=self.link, question=self.q2, text="spam", submitter_name="Bot")
        other_link, _ = create_link(self.other, self.outsider, days=7)
        other = AnswerSubmission.objects.create(link=other_link, question=self.other_q1, text="x", submitter_name="y")

        response = self.as_user(self.member).post(self.team_url("submissions/dismiss-pending/"), {}, format="json")

        self.assertEqual(response.json(), {"dismissed": 2})
        self.assertEqual(AnswerSubmission.objects.filter(link=self.link, state="pending").count(), 0)
        other.refresh_from_db()
        self.assertEqual(other.state, AnswerSubmission.State.PENDING)  # another project's is untouched

    def test_a_submission_of_another_project_is_a_404_by_either_address(self):
        other_link, _ = create_link(self.other, self.outsider, days=7)
        theirs = AnswerSubmission.objects.create(link=other_link, question=self.other_q1, text="x", submitter_name="y")

        # B's owner, with B's own address, but A's submission id:
        by_b = self.as_user(self.outsider).post(self.accept_url(self.s1, self.other), {}, format="json")
        # A's member, with A's address, but B's submission id:
        by_a = self.as_user(self.member).post(self.accept_url(theirs), {}, format="json")
        # A person who is in neither:
        stranger = self.as_user(self.outsider).post(self.accept_url(self.s1), {}, format="json")

        self.assertEqual([by_b.status_code, by_a.status_code, stranger.status_code], [404, 404, 404])
        for submission in (self.s1, theirs):
            submission.refresh_from_db()
            self.assertEqual(submission.state, AnswerSubmission.State.PENDING)
        self.assertEqual(Answer.objects.filter(channel=Answer.Channel.LINK).count(), 0)

    def test_only_members_can_decide_and_a_signed_out_person_cannot(self):
        for url in (self.accept_url(), self.dismiss_url()):
            self.assertEqual(self.public().post(url, {}, format="json").status_code, 403)
            self.assertEqual(self.as_user(self.outsider).post(url, {}, format="json").status_code, 404)
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.state, AnswerSubmission.State.PENDING)

    def test_a_person_holding_only_the_link_cannot_decide_anything(self):
        for url in (self.accept_url(), self.dismiss_url()):
            response = self.public().post(url, {}, format="json", **with_token(self.token))
            self.assertEqual(response.status_code, 403)
        self.s1.refresh_from_db()
        self.assertEqual(self.s1.state, AnswerSubmission.State.PENDING)


class SimultaneousAcceptTests(TransactionTestCase):
    """Two members accept two different answers to one question at the same moment: one wins, one is refused."""

    databases = {"default"}

    def test_exactly_one_answer_is_written(self):
        from django.core.cache import caches

        from projects.models import Project

        caches["throttle"].clear()
        User = get_user_model()
        ada = User.objects.create_user(email="ada@example.invalid", password=PASSWORD)
        bob = User.objects.create_user(email="bob@example.invalid", password=PASSWORD)
        project = Project.objects.create(name="Ticketing", client_name="Invented Client", created_by=ada)
        Membership.objects.create(project=project, user=ada, role=Membership.Role.OWNER)
        Membership.objects.create(project=project, user=bob, role=Membership.Role.MEMBER)
        question = Question.objects.create(project=project, number=1, text="Which?", created_by=ada)
        link, _ = create_link(project, ada, days=7)
        first = AnswerSubmission.objects.create(link=link, question=question, text="A", submitter_name="One")
        second = AnswerSubmission.objects.create(link=link, question=question, text="B", submitter_name="Two")

        barrier = threading.Barrier(2)
        results = [None, None]

        def accept(index, user, submission):
            from rest_framework.test import APIClient

            try:
                client = APIClient()
                client.force_authenticate(user)
                barrier.wait(timeout=30)
                url = f"/api/projects/{project.pk}/submissions/{submission.pk}/accept/"
                results[index] = client.post(url, {}, format="json").status_code
            except Exception as exc:  # shown by the assertion below
                results[index] = exc
            finally:
                connections.close_all()

        threads = [
            threading.Thread(target=accept, args=(0, ada, first)),
            threading.Thread(target=accept, args=(1, bob, second)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=60)

        self.assertEqual(sorted(results), [200, 400], results)
        self.assertEqual(Answer.objects.filter(question=question).count(), 1)
        self.assertEqual(AnswerSubmission.objects.filter(state="accepted").count(), 1)
