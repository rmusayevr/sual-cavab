import json
import re
from pathlib import Path

from django.test import SimpleTestCase

REPO = Path(__file__).resolve().parents[2]
CI = REPO / ".github" / "workflows" / "ci.yml"
LOOP = REPO / ".claude" / "harness-loop.json"

# Steps that set the job up, not checks: they are in ci.yml and not in the loop's `checks`.
SETUP = ("pip install", "npm ci")


def ci_checks(text):
    """The `run:` commands of ci.yml that are checks, in file order (one-line `run:` steps)."""
    commands = [m.group(1).strip() for m in re.finditer(r"^\s*-\s*run:\s*(.+?)\s*$", text, re.MULTILINE)]
    return [c for c in commands if not any(s in c for s in SETUP)]


class CiAndLoopChecksAgree(SimpleTestCase):
    """The same checks are written in .github/workflows/ci.yml and .claude/harness-loop.json (#51). If one
    changes and not the other, the loop could pass work that CI fails, or the reverse. This fails when
    they differ, so a change has to touch both."""

    def test_ci_runs_exactly_the_checks_the_loop_runs_in_the_same_order(self):
        loop = json.loads(LOOP.read_text(encoding="utf-8"))["checks"]

        self.assertEqual(ci_checks(CI.read_text(encoding="utf-8")), loop)

    def test_it_reads_something(self):
        # An empty list on both sides would "agree": the parser must really find the checks.
        self.assertGreaterEqual(len(ci_checks(CI.read_text(encoding="utf-8"))), 4)

    def test_a_changed_command_is_a_difference(self):
        text = CI.read_text(encoding="utf-8").replace("manage.py test --noinput", "manage.py test")
        loop = json.loads(LOOP.read_text(encoding="utf-8"))["checks"]

        self.assertNotEqual(ci_checks(text), loop)

    def test_an_added_step_is_a_difference(self):
        text = CI.read_text(encoding="utf-8") + "      - run: cd backend && python manage.py check --deploy\n"
        loop = json.loads(LOOP.read_text(encoding="utf-8"))["checks"]

        self.assertNotEqual(ci_checks(text), loop)

    def test_a_removed_step_is_a_difference(self):
        text = "\n".join(
            line for line in CI.read_text(encoding="utf-8").splitlines() if "makemigrations --check" not in line
        )
        loop = json.loads(LOOP.read_text(encoding="utf-8"))["checks"]

        self.assertNotEqual(ci_checks(text), loop)

    def test_setup_steps_are_not_checks(self):
        text = "      - run: pip install -r backend/requirements.txt\n      - run: cd frontend && npm ci\n"

        self.assertEqual(ci_checks(text), [])
