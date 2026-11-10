import os
import re
from pathlib import Path

from django.test import SimpleTestCase

REPO = Path(__file__).resolve().parents[2]
SELF = Path(__file__).resolve()

# A password, secret, token or key assigned a string literal; or a password written inside a URL.
# Written in a test file, even an invented one, either looks like a leaked secret to a scanner
# (GitGuardian flagged two in PRs #26 and #28). Make it in the test: core.testing.invented_password()
# in Python, crypto.randomUUID() in the frontend (#44).
KEYWORD_LITERAL = re.compile(r"""(?i)\b(?:password|passwd|secret|token|api[_-]?key)\w*\s*(?:=|:)\s*(?P<q>["'])(?P<value>[^"'\s]{4,})(?P=q)""")
FUNCTION_LITERAL = re.compile(r"""(?i)\b(?:check|set|make)_password\(\s*(?P<q>["'])(?P<value>[^"'\s]{4,})(?P=q)""")
URL_PASSWORD = re.compile(r"""://[^/\s"'@:{}]+:(?P<value>[^/\s"'@{}]{3,})@""")
ALLOWED_MARK = "literal-password-ok"  # on the same line, with the reason, for the rare case that is not a secret


def literal_passwords(text):
    """(line number, the offending text) for every literal password in `text`."""
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        if ALLOWED_MARK in line:
            continue
        for pattern in (KEYWORD_LITERAL, FUNCTION_LITERAL, URL_PASSWORD):
            for match in pattern.finditer(line):
                found.append((number, match.group(0)))
    return found


SKIP_DIRS = {".venv", "node_modules", ".next", "staticfiles", "__pycache__", ".git"}


def test_files():
    """The Python test files of the backend and the .test.ts(x) files of the frontend (not this file)."""
    found = []
    for top in ("backend", "frontend"):
        for folder, dirs, names in os.walk(REPO / top):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]  # do not walk the virtualenv or node_modules
            for name in names:
                if top == "backend" and name.endswith(".py") and (name.startswith("test") or name == "tests.py"):
                    found.append(Path(folder) / name)
                if top == "frontend" and name.endswith((".test.ts", ".test.tsx")):
                    found.append(Path(folder) / name)
    return [p for p in found if p.resolve() != SELF]


class NoLiteralPasswordsInTests(SimpleTestCase):
    def test_no_test_file_writes_a_password_out(self):
        files = test_files()
        self.assertGreater(len(files), 20, "the scan found almost no test files; is the path wrong?")
        problems = [
            f"{path.relative_to(REPO)}:{number}: {text}"
            for path in files
            for number, text in literal_passwords(path.read_text(encoding="utf-8"))
        ]

        self.assertEqual(
            problems,
            [],
            "A test file writes a password as a literal (a scanner takes it for a leaked secret). Make it: "
            "core.testing.invented_password() in Python, `pw-${crypto.randomUUID()}` in the frontend.",
        )


# The sample lines below are BUILT from fragments, never written out: a realistic password in a test file
# is exactly what a scanner flags, and GitGuardian did flag the first version of this file (PR #98). Only
# their shape matters to the scan.
WORD = "pass" + "word"
KEY = "api" + "_key"
SECRET = "sec" + "ret"
VALUE = "ab" + "cd-" + "ef12"  # opaque: never a real secret
CHECK = "check_" + WORD


class TheScanFindsWhatItShould(SimpleTestCase):
    """The guard is only worth having if it catches the forms that were flagged, and leaves the made ones alone."""

    def test_it_finds_a_password_assigned_a_literal(self):
        self.assertTrue(literal_passwords(f'{WORD.upper()} = "{VALUE}"\n'))
        self.assertTrue(literal_passwords(f'self.sign_in({WORD}="{VALUE}")\n'))
        self.assertTrue(literal_passwords(f'submit(email, {{ {WORD}: "{VALUE}" }})\n'))
        self.assertTrue(literal_passwords(f"const {KEY} = '{VALUE}'\n"))
        self.assertTrue(literal_passwords(f'{SECRET} = "{VALUE}"\n'))

    def test_it_finds_a_literal_handed_to_a_password_function(self):
        self.assertTrue(literal_passwords(f'self.assertTrue(user.{CHECK}("{VALUE}"))\n'))
        self.assertTrue(literal_passwords(f'encoded = make_{WORD}("{VALUE}")\n'))
        self.assertTrue(literal_passwords(f'user.set_{WORD}("{VALUE}")\n'))

    def test_it_finds_a_password_inside_a_url(self):
        self.assertTrue(literal_passwords(f'database_from_url("postgresql://sual_user:{VALUE}@host:5433/db")\n'))
        self.assertTrue(literal_passwords(f'refused("postgresql://u:{VALUE}@host/name")\n'))

    def test_it_leaves_a_made_password_alone(self):
        for line in (
            f"{WORD.upper()} = invented_{WORD}()\n",
            'url = f"postgresql://u:{PW}@host/name"\n',
            f"const {WORD.upper()} = crypto.randomUUID();\n",
            f"self.sign_in({WORD}=WRONG_{WORD.upper()})\n",
            f"expect(body).toEqual({{ email, {WORD}: {WORD.upper()} }});\n",
            '"postgresql://u:p@host/name"\n',  # a one-letter password is not a secret
            f'name = "{WORD}"\n',  # the word alone
            f"self.assertTrue(user.{CHECK}(chosen))\n",
            f"encoded = make_{WORD}({WORD})\n",
        ):
            with self.subTest(line=line):
                self.assertEqual(literal_passwords(line), [])

    def test_a_line_can_be_allowed_with_a_reason(self):
        self.assertEqual(literal_passwords(f'{WORD.upper()} = "{VALUE}"  # literal-password-ok: a label, not a secret\n'), [])

    def test_it_reports_the_line_number(self):
        self.assertEqual([n for n, _ in literal_passwords(f'a = 1\nb = 2\n{WORD.upper()} = "{VALUE}"\n')], [3])
