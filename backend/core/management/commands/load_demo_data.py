"""Load INVENTED demo data for a staging host (#10).

Everything here is fictional: no real client, person, question or message. It
exists so a staging site has something to show, and so the smoke test has
something to check.

It is built to be safe to leave in the start-up command of a staging service:

- It does nothing unless DJANGO_DEMO_DATA=1 is set (exactly "1"), and it needs
  DEMO_PASSWORD from the environment: 12+ characters that also pass Django's
  password validators. The password is never in the repo and never printed.
- It refuses to run if any project was created by someone who is not a demo
  account. That is what stops it adding accounts with a shared password to a
  database that holds real work. It looks at who created a project, not at its
  name, because a visitor on staging can rename a project but not its creator.
  It is not a guarantee: a real database that has users but no projects yet
  passes, so DJANGO_DEMO_DATA=1 belongs on a staging service only.
- It loads once. If the demo owner already has any project the data is there
  (or was renamed by a visitor) and nothing changes, so a restart is a no-op and
  a visitor's renamed project cannot make it load a second copy. It deletes
  nothing, and an existing demo account keeps its password.
- A start-up command should still not depend on it succeeding (render.yaml
  runs it with "||"): a refusal here must never keep the site down.
"""

import os
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from projects.models import Membership, Project
from questions.models import Question
from questions.services import change_status

DEMO_PREFIX = "Demo: "
DEMO_DOMAIN = "example.invalid"  # a reserved name that can never receive mail

# (email, first name, last name)
DEMO_USERS = {
    "owner": ("demo.owner@" + DEMO_DOMAIN, "Aysel", "Demo"),
    "member": ("demo.member@" + DEMO_DOMAIN, "Murad", "Demo"),
    "outsider": ("demo.outsider@" + DEMO_DOMAIN, "Leyla", "Demo"),  # on no project: shows the 404 rule
}

MIN_PASSWORD_LENGTH = 12


def answer(text, by, days_ago, channel="meeting", note=""):
    return {
        "text": text,
        "answered_by": by,
        "answered_on": date.today() - timedelta(days=days_ago),
        "channel": channel,
        "channel_note": note,
    }


# Each question: (text, why it matters, what it blocks, steps), where steps is a
# list of ("asked" | "dropped" | "open" | ("answered", answer-dict)) applied in order.
PROJECTS = [
    {
        "name": DEMO_PREFIX + "Ticketing platform",
        "client_name": "Invented Client Ltd",
        "description": "Invented example: refund rules and date changes for an imaginary ticket seller.",
        "questions": [
            ("Which payment providers are allowed at checkout?", "Fees differ per provider.", "Checkout screen", []),
            (
                "What happens to sold tickets when an event date moves?",
                "Customers must be told what they can do.",
                "Date-change emails",
                ["asked"],
            ),
            (
                "How many days before an event can a ticket be refunded?",
                "The refund button depends on it.",
                "Refund screen",
                [("answered", answer("Up to 30 days before the event.", "Invented Contact", 6, "meeting", "Weekly sync"))],
            ),
            ("Is a mobile app part of the first release?", "Changes the API we expose.", "", ["dropped"]),
            ("Sorğuların API üçün limiti nə qədərdir? (rate limit)", "Protects the booking service.", "API gateway", []),
        ],
    },
    {
        "name": DEMO_PREFIX + "Booking portal",
        "client_name": "Fictional Travel Co",
        "description": "Invented example: an imaginary travel portal, with an answer that was corrected after a re-open.",
        "questions": [
            ("Can a booking be moved to another traveller?", "Affects the passenger record.", "Booking form", ["asked"]),
            ("Which currencies are shown on invoices?", "Needed before the invoice template.", "Invoices", []),
            (
                "How long is a seat held before payment?",
                "Sets the expiry job.",
                "Seat reservation",
                [
                    ("answered", answer("Ten minutes.", "Invented Contact", 12, "chat")),
                    "open",
                    ("answered", answer("Corrected: fifteen minutes.", "Invented Contact", 2, "email")),
                ],
            ),
        ],
    },
]


def demo_password():
    password = os.environ.get("DEMO_PASSWORD", "")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise CommandError(
            f"DEMO_PASSWORD must be set in the environment, at least {MIN_PASSWORD_LENGTH} characters "
            "(it is the shared password of the demo accounts; it is never printed or committed)."
        )
    try:
        validate_password(password)  # not all digits, not a common password, and so on
    except ValidationError as err:
        raise CommandError("DEMO_PASSWORD is too weak: " + " ".join(err.messages)) from None
    return password


class Command(BaseCommand):
    help = "Load invented demo data (staging only). Needs DJANGO_DEMO_DATA=1 and DEMO_PASSWORD."

    def handle(self, *args, **options):
        if os.environ.get("DJANGO_DEMO_DATA") != "1":
            self.stdout.write("DJANGO_DEMO_DATA is not 1: no demo data loaded.")
            return
        password = demo_password()

        foreign = Project.objects.exclude(created_by__email__endswith="@" + DEMO_DOMAIN)
        if foreign.exists():
            raise CommandError(
                f"Refusing to load demo data: {foreign.count()} project(s) in this database were not created by "
                "a demo account. Demo accounts share one password and belong on a staging database only."
            )

        with transaction.atomic():
            users = self.create_users(password)
            if Project.objects.filter(created_by=users["owner"]).exists():
                self.stdout.write("Demo data is already loaded: nothing changed.")
                return
            for spec in PROJECTS:
                self.create_project(spec, users)

        self.stdout.write(
            f"Demo data: {len(PROJECTS)} project(s) created; {len(users)} demo accounts. "
            f"Sign in as {DEMO_USERS['owner'][0]}."
        )

    def create_users(self, password):
        User = get_user_model()
        users = {}
        for role, (email, first, last) in DEMO_USERS.items():
            user = User.objects.filter(email=email).first()
            if user is None:  # an existing demo account keeps its password
                user = User.objects.create_user(email=email, password=password, first_name=first, last_name=last)
            users[role] = user
        return users

    def create_project(self, spec, users):
        """Create one demo project with its members and questions."""
        project = Project.objects.create(
            name=spec["name"],
            client_name=spec["client_name"],
            description=spec["description"],
            created_by=users["owner"],
        )
        Membership.objects.create(project=project, user=users["owner"], role=Membership.Role.OWNER)
        Membership.objects.create(project=project, user=users["member"], role=Membership.Role.MEMBER)
        for text, why, blocks, steps in spec["questions"]:
            number = project.next_question_number
            Project.objects.filter(pk=project.pk).update(next_question_number=number + 1)
            project.next_question_number = number + 1
            question = Question.objects.create(
                project=project,
                number=number,
                text=text,
                why_it_matters=why,
                blocks=blocks,
                created_by=users["member"],
            )
            for step in steps:
                if isinstance(step, tuple):
                    change_status(question, "answered", users["member"], step[1])
                else:
                    change_status(question, step, users["member"])
