"""load_demo_data (#10): invented staging data, loaded safely and only on purpose."""

import io
import os
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from projects.models import Membership, Project
from questions.models import Answer, Question

from .management.commands.load_demo_data import DEMO_DOMAIN, DEMO_PREFIX

from core.testing import invented_password
PASSWORD = invented_password()
ENV = {"DJANGO_DEMO_DATA": "1", "DEMO_PASSWORD": PASSWORD}
User = get_user_model()


def load(env=None):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, ENV if env is None else env, clear=False):
        call_command("load_demo_data", stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


def demo_state():
    """Everything the command could have written, as plain values."""
    return (
        sorted(User.objects.values_list("email", flat=True)),
        sorted(Project.objects.values_list("name", flat=True)),
        Question.objects.count(),
        Answer.objects.count(),
        Membership.objects.count(),
    )


class SwitchTests(TestCase):
    def test_does_nothing_unless_the_demo_switch_is_on(self):
        for env in ({}, {"DJANGO_DEMO_DATA": "0", "DEMO_PASSWORD": PASSWORD}, {"DJANGO_DEMO_DATA": "true", "DEMO_PASSWORD": PASSWORD}):
            with self.subTest(env=env), mock.patch.dict(os.environ, env):
                for key in ("DJANGO_DEMO_DATA", "DEMO_PASSWORD"):
                    if key not in env:
                        os.environ.pop(key, None)
                message = load(env=env)
                self.assertIn("no demo data loaded", message)
                self.assertEqual(Project.objects.count(), 0)
                self.assertEqual(User.objects.count(), 0)

    def test_a_missing_or_short_password_is_refused_and_nothing_is_created(self):
        for password in (None, "", "short"):
            with self.subTest(password=password):
                env = {"DJANGO_DEMO_DATA": "1"}
                if password is not None:
                    env["DEMO_PASSWORD"] = password
                with mock.patch.dict(os.environ, env, clear=False):
                    if password is None:
                        os.environ.pop("DEMO_PASSWORD", None)
                    with self.assertRaises(CommandError) as caught:
                        call_command("load_demo_data", stdout=io.StringIO())
                self.assertIn("DEMO_PASSWORD", str(caught.exception))
                self.assertEqual((Project.objects.count(), User.objects.count()), (0, 0))

    def test_the_password_is_never_printed(self):
        output = load()
        self.assertNotIn(PASSWORD, output)

    def test_a_weak_password_is_refused_and_nothing_is_created(self):
        # all digits; too short (12 is the minimum); on Django's list of common passwords (12+ characters)
        for weak in ("123456789012", "short-pw", "qwerty123456", "1q2w3e4r5t6y"):
            with self.subTest(password=weak):
                with self.assertRaises(CommandError) as caught:
                    load(env={"DJANGO_DEMO_DATA": "1", "DEMO_PASSWORD": weak})
                self.assertNotIn(weak, str(caught.exception))  # the weak value is not echoed back
                self.assertEqual((Project.objects.count(), User.objects.count()), (0, 0))


class RealDataGuardTests(TestCase):
    def test_refuses_when_the_database_holds_a_project_that_is_not_demo_data(self):
        owner = User.objects.create_user(email="someone@example.com", password="x" * 12)
        Project.objects.create(name="A real project", client_name="Real Client", created_by=owner)
        before = demo_state()

        with self.assertRaises(CommandError) as caught:
            load()

        self.assertIn("not created by a demo account", str(caught.exception))
        self.assertEqual(demo_state(), before)  # no demo account was added

    def test_runs_when_only_demo_projects_exist(self):
        load()
        self.assertEqual(Project.objects.exclude(name__startswith=DEMO_PREFIX).count(), 0)
        load()  # a second run is not refused by the guard


class ContentTests(TestCase):
    def setUp(self):
        load()
        self.ticketing = Project.objects.get(name=DEMO_PREFIX + "Ticketing platform")
        self.booking = Project.objects.get(name=DEMO_PREFIX + "Booking portal")

    def test_the_demo_projects_accounts_and_roles(self):
        self.assertEqual(Project.objects.count(), 2)
        roles = {(m.user.email.split("@")[0], m.project.name, m.role) for m in Membership.objects.select_related("user", "project")}
        self.assertIn(("demo.owner", self.ticketing.name, "owner"), roles)
        self.assertIn(("demo.member", self.booking.name, "member"), roles)
        self.assertEqual(Membership.objects.filter(user__email__startswith="demo.outsider").count(), 0)

    def test_everything_is_invented(self):
        for user in User.objects.all():
            self.assertTrue(user.email.endswith("@" + DEMO_DOMAIN), user.email)  # a name that can never receive mail
        for project in Project.objects.all():
            self.assertTrue(project.name.startswith(DEMO_PREFIX))

    def test_the_still_open_counts_the_screens_show(self):
        counts = {p.name: p.open_question_count for p in Project.objects.with_open_count()}
        self.assertEqual(counts[self.ticketing.name], 3)  # Q1 open, Q2 asked, Q5 open
        self.assertEqual(counts[self.booking.name], 2)  # Q1 asked, Q2 open

    def test_every_status_and_a_re_opened_answer_are_there(self):
        statuses = set(Question.objects.values_list("status", flat=True))
        self.assertEqual(statuses, {"open", "asked", "answered", "dropped"})
        reopened = Question.objects.get(project=self.booking, number=3)
        self.assertEqual(reopened.status, "answered")
        self.assertEqual(reopened.answers.filter(superseded_at__isnull=False).count(), 1)
        self.assertEqual(reopened.answers.get(superseded_at__isnull=True).text, "Corrected: fifteen minutes.")

    def test_question_numbers_are_unbroken_and_the_counter_is_ahead(self):
        for project in (self.ticketing, self.booking):
            project.refresh_from_db()
            numbers = sorted(project.questions.values_list("number", flat=True))
            self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
            self.assertEqual(project.next_question_number, len(numbers) + 1)

    def test_azerbaijani_text_is_stored_intact(self):
        self.assertTrue(Question.objects.filter(project=self.ticketing, text__contains="Sorğuların API üçün limiti").exists())


class IdempotenceTests(TestCase):
    def test_a_second_run_changes_nothing(self):
        load()
        first = demo_state()
        message = load()
        self.assertEqual(demo_state(), first)
        self.assertIn("already loaded", message)

    def test_a_project_a_visitor_made_with_a_demo_account_does_not_stop_a_restart(self):
        load()
        member = User.objects.get(email="demo.member@" + DEMO_DOMAIN)
        Project.objects.create(name="Scribble by a visitor", client_name="Whoever", created_by=member)
        before = demo_state()
        load()  # must not raise (it used to, and a refusal kept staging from starting)
        self.assertEqual(demo_state(), before)

    def test_renaming_the_demo_projects_neither_stops_a_restart_nor_loads_a_second_copy(self):
        load()
        for number, project in enumerate(Project.objects.all()):
            Project.objects.filter(pk=project.pk).update(name=f"Renamed by a visitor {number}")
        before = demo_state()
        load()
        self.assertEqual(demo_state(), before)
        self.assertEqual(Project.objects.count(), 2)

    def test_a_demo_project_that_exists_is_left_exactly_as_it_is(self):
        load()
        question = Question.objects.get(project__name=DEMO_PREFIX + "Ticketing platform", number=1)
        Question.objects.filter(pk=question.pk).update(text="Edited by a person on staging")
        load()
        question.refresh_from_db()
        self.assertEqual(question.text, "Edited by a person on staging")

    def test_an_existing_demo_account_keeps_its_password(self):
        chosen = invented_password()
        User.objects.create_user(email="demo.owner@" + DEMO_DOMAIN, password=chosen)
        load()
        self.assertTrue(User.objects.get(email="demo.owner@" + DEMO_DOMAIN).check_password(chosen))

    def test_nothing_is_ever_deleted(self):
        load()
        extra = User.objects.create_user(email="added.later@example.com", password="x" * 12)
        load()
        self.assertTrue(User.objects.filter(pk=extra.pk).exists())


class SignInTests(TestCase):
    """The demo accounts work through the real sign-in and the project rules."""

    def setUp(self):
        load()
        self.project = Project.objects.get(name=DEMO_PREFIX + "Ticketing platform")

    def sign_in(self, who):
        from django.test import Client

        client = Client()
        response = client.post(
            "/api/auth/login/",
            {"email": f"demo.{who}@{DEMO_DOMAIN}", "password": PASSWORD},
            content_type="application/json",
        )
        return client, response

    def test_demo_members_can_sign_in_and_see_the_project_with_its_count(self):
        for who in ("owner", "member"):
            with self.subTest(who=who):
                client, response = self.sign_in(who)
                self.assertEqual(response.status_code, 200, response.content)
                listed = client.get("/api/projects/").json()
                ticketing = next(p for p in listed if p["id"] == self.project.pk)
                self.assertEqual(ticketing["open_question_count"], 3)

    def test_the_demo_outsider_signs_in_but_sees_neither_project(self):
        client, response = self.sign_in("outsider")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(client.get("/api/projects/").json(), [])
        self.assertEqual(client.get(f"/api/projects/{self.project.pk}/").status_code, 404)

    def test_a_wrong_password_does_not_sign_in(self):
        from django.test import Client

        response = Client().post(
            "/api/auth/login/",
            {"email": f"demo.owner@{DEMO_DOMAIN}", "password": "not-the-demo-password"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class StartCommandTests(TestCase):
    """A refusal by load_demo_data must never keep the site from starting (the review of #28)."""

    def start_command(self):
        from pathlib import Path

        from django.conf import settings

        text = (Path(settings.BASE_DIR).parent / "render.yaml").read_text(encoding="utf-8")
        start = text.index("startCommand: >-")
        return " ".join(line.strip() for line in text[start:].splitlines()[1:8] if line.strip() and not line.strip().startswith("#"))

    def test_the_site_starts_even_if_the_demo_loader_fails(self):
        command = self.start_command()
        self.assertIn("python manage.py load_demo_data ||", command)
        self.assertNotIn("&& python manage.py load_demo_data &&", command)

    def test_migrations_still_stop_the_start_if_they_fail(self):
        # Only the demo loader is optional: a failed migrate must not start a half-working site.
        command = self.start_command()
        self.assertIn("python manage.py migrate --noinput && python manage.py createcachetable &&", command)
