import os
import re
from pathlib import Path

from django.test import SimpleTestCase

REPO = Path(__file__).resolve().parents[2]
SELF = Path(__file__).resolve()

# A password, secret, token or key given a string literal, or a password written inside a URL, a command
# or a header. In a test file, even an invented one, it looks like a leaked secret to a scanner
# (GitGuardian flagged two in PRs #26 and #28, and the first version of this guard's own samples in
# PR #98). Make it in the test: core.testing.invented_password() in Python, crypto.randomUUID() in the
# frontend (#44).
#
# The name may be quoted (a dict or JSON key), annotated (`password: str = "..."`) or part of a longer
# name (DEMO_PASSWORD, fake_key). A literal may use ", ' or a backtick. The value must be 4 or more
# characters (8 for a token, secret or key name, which also name harmless labels) without a space, `$`
# or brace (a template or placeholder is not a literal).
NAME = r"(?:pass(?:word|wd|phrase)|pwd|credentials?|(?:\w*_)?secret\w*|(?:access|auth|api|bearer|refresh|session)[_-]?token|(?:api|private|fake|secret)[_-]?key)"
QUOTE = r"""["'`]"""
VALUE = r"""[^"'`\s${}]"""
KEYWORD_LITERAL = re.compile(
    rf"""(?i)\b(?P<name>\w*{NAME}\w*)["'`]?\s*(?::\s*\w+\s*)?(?:=|:)\s*(?P<q>{QUOTE})(?P<value>{VALUE}{{4,}})(?P=q)"""
)
FUNCTION_LITERAL = re.compile(rf"""(?i)\b(?:check|set|make)_password\(\s*(?P<q>{QUOTE})(?P<value>{VALUE}{{4,}})(?P=q)""")
URL_PASSWORD = re.compile(r"""://[^/\s"'@:{}]*:(?P<value>[^/\s"'@{}]{3,})@""")
ENV_STYLE = re.compile(rf"""{QUOTE}[A-Za-z0-9_]*(?i:password|secret|token|key)[A-Za-z0-9_]*=(?P<value>{VALUE}{{4,}}){QUOTE}""")
CLI_ARGUMENT = re.compile(rf"""--(?i:password|passwd|token|secret)\b{QUOTE}?[,= ]\s*{QUOTE}?(?P<value>{VALUE}{{4,}})""")
BEARER = re.compile(r"""Bearer\s+(?P<value>[A-Za-z0-9._~+/-]{12,})""")
ALLOWED_MARK = "literal-password-ok"  # on the same line, with the reason, for the rare case that is not a secret
LABEL_NAMES = ("secret", "token", "key")  # these also name labels and design tokens: a longer value is needed


def literal_passwords(text):
    """(line number, the offending text) for every literal password in `text`."""
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        if ALLOWED_MARK in line:
            continue
        for pattern in (KEYWORD_LITERAL, FUNCTION_LITERAL, URL_PASSWORD, ENV_STYLE, CLI_ARGUMENT, BEARER):
            for match in pattern.finditer(line):
                name = (match.groupdict().get("name") or "").lower()
                if pattern is KEYWORD_LITERAL and any(w in name for w in LABEL_NAMES) and "password" not in name:
                    if len(match.group("value")) < 8:
                        continue
                found.append((number, match.group(0)))
    return found


SKIP_DIRS = {".venv", "node_modules", ".next", "staticfiles", "__pycache__", ".git"}
FRONTEND_TEST = re.compile(r"\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|mts)$")


def test_files():
    """{"backend": [...], "frontend": [...], "other": [...]}: the test files, test helpers and scripts (not this file)."""
    found = {"backend": [], "frontend": [], "other": []}
    for top in ("backend", "frontend", "scripts", ".claude"):
        for folder, dirs, names in os.walk(REPO / top):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            in_tests_dir = "tests" in Path(folder).parts or "__tests__" in Path(folder).parts
            for name in names:
                path = Path(folder) / name
                if top == "backend" and name.endswith(".py") and (name.startswith("test") or name in ("tests.py", "conftest.py") or in_tests_dir):
                    found["backend"].append(path)
                elif top == "frontend" and (FRONTEND_TEST.search(name) or (in_tests_dir and name.endswith((".ts", ".tsx", ".js", ".mjs")))):
                    found["frontend"].append(path)
                elif top == "scripts" and name.endswith(".py"):
                    found["other"].append(path)
                elif top == ".claude" and ".test." in name:
                    found["other"].append(path)
    return {k: [p for p in v if p.resolve() != SELF] for k, v in found.items()}


class NoLiteralPasswordsInTests(SimpleTestCase):
    def test_no_test_file_or_script_writes_a_password_out(self):
        files = test_files()
        # each area must be found on its own: finding the frontend's files must not hide a backend scan that found none
        self.assertGreaterEqual(len(files["backend"]), 8, "the backend test files were not found")
        self.assertGreaterEqual(len(files["frontend"]), 10, "the frontend test files were not found")
        self.assertGreaterEqual(len(files["other"]), 1, "the scripts were not found")
        problems = [
            f"{path.relative_to(REPO)}:{number}: {text}"
            for paths in files.values()
            for path in paths
            for number, text in literal_passwords(path.read_text(encoding="utf-8"))
        ]

        self.assertEqual(
            problems,
            [],
            "A test file or script writes a password as a literal (a scanner takes it for a leaked secret). Make it: "
            "core.testing.invented_password() in Python, crypto.randomUUID() in the frontend, secrets.token_urlsafe() in a script.",
        )


# The sample lines below are BUILT from fragments, never written out: a realistic password in a test file
# is exactly what a scanner flags, and GitGuardian did flag the first version of this file (PR #98). Only
# their shape matters to the scan.
WORD = "pass" + "word"
KEY = "api" + "_key"
SECRET = "sec" + "ret"
VALUE_TEXT = "ab" + "cd-" + "ef12"  # opaque: never a real secret
CHECK = "check_" + WORD
Q2 = chr(34)  # a double quote, so a sample can have a quoted key without the file having one


class TheScanFindsWhatItShould(SimpleTestCase):
    """The guard is only worth having if it catches the forms that were flagged, and leaves the made ones alone."""

    def found(self, line):
        return bool(literal_passwords(line + "\n"))

    def test_it_finds_a_password_assigned_a_literal(self):
        self.assertTrue(self.found(f'{WORD.upper()} = "{VALUE_TEXT}"'))
        self.assertTrue(self.found(f'self.sign_in({WORD}="{VALUE_TEXT}")'))
        self.assertTrue(self.found(f'submit(email, {{ {WORD}: "{VALUE_TEXT}" }})'))
        self.assertTrue(self.found(f"const {KEY} = '{VALUE_TEXT}'"))
        self.assertTrue(self.found(f'{SECRET} = "{VALUE_TEXT}"'))

    def test_it_finds_a_quoted_key_in_a_dict_or_json_the_commonest_form_in_a_test_body(self):
        self.assertTrue(self.found(f'{{"email": "a@b.c", {Q2}{WORD}{Q2}: "{VALUE_TEXT}"}}'))
        self.assertTrue(self.found(f"{{'{WORD}': '{VALUE_TEXT}'}}"))
        self.assertTrue(self.found(f'JSON.stringify({{ {Q2}{WORD}{Q2}: "{VALUE_TEXT}" }})'))
        self.assertTrue(self.found(f'{{"DEMO_{WORD.upper()}": "{VALUE_TEXT}"}}'))

    def test_it_finds_the_other_shapes_a_literal_takes(self):
        self.assertTrue(self.found(f'{WORD}: str = "{VALUE_TEXT}"'))  # annotated
        self.assertTrue(self.found(f"const {WORD} = `{VALUE_TEXT}`"))  # a backtick string
        self.assertTrue(self.found(f'FAKE_KEY = "{VALUE_TEXT}"'))  # a longer name
        self.assertTrue(self.found(f'pwd = "{VALUE_TEXT}"'))
        self.assertTrue(self.found(f'"DEMO_{WORD.upper()}={VALUE_TEXT}"'))  # env style
        self.assertTrue(self.found(f'["--{WORD}", "{VALUE_TEXT}"]'))  # a command argument
        self.assertTrue(self.found(f'headers = {{"Authorization": "Bearer {VALUE_TEXT}{VALUE_TEXT}"}}'))
        self.assertTrue(self.found(f'redis://:{VALUE_TEXT}@host:6379'))  # a URL with no user

    def test_it_finds_a_literal_handed_to_a_password_function(self):
        self.assertTrue(self.found(f'self.assertTrue(user.{CHECK}("{VALUE_TEXT}"))'))
        self.assertTrue(self.found(f'encoded = make_{WORD}("{VALUE_TEXT}")'))
        self.assertTrue(self.found(f'user.set_{WORD}("{VALUE_TEXT}")'))

    def test_it_finds_a_password_inside_a_url(self):
        self.assertTrue(self.found(f'database_from_url("postgresql://sual_user:{VALUE_TEXT}@host:5433/db")'))
        self.assertTrue(self.found(f'refused("postgresql://u:{VALUE_TEXT}@host/name")'))

    def test_it_leaves_a_made_password_and_harmless_labels_alone(self):
        for line in (
            f"{WORD.upper()} = invented_{WORD}()",
            'url = f"postgresql://u:{PW}@host/name"',
            f"const {WORD.upper()} = crypto.randomUUID();",
            f"self.sign_in({WORD}=WRONG_{WORD.upper()})",
            f"expect(body).toEqual({{ email, {WORD}: {WORD.upper()} }});",
            '"postgresql://u:p@host/name"',  # a one-letter password is not a secret
            f'name = "{WORD}"',  # the word alone
            f"self.assertTrue(user.{CHECK}(chosen))",
            f"encoded = make_{WORD}({WORD})",
            f'{{"email": "a@b.c", {Q2}{WORD}{Q2}: WRONG_{WORD.upper()}}}',  # a quoted key with a made value
            'secretLabel: "Show"',  # a label, short
            'tokens: "status-open"',  # a design token, not an access token
            'token_type = "bearer"',
        ):
            with self.subTest(line=line):
                self.assertFalse(self.found(line))

    def test_a_line_can_be_allowed_with_a_reason(self):
        self.assertEqual(literal_passwords(f'{WORD.upper()} = "{VALUE_TEXT}"  # literal-password-ok: a label, not a secret\n'), [])

    def test_it_reports_the_line_number(self):
        self.assertEqual([n for n, _ in literal_passwords(f'a = 1\nb = 2\n{WORD.upper()} = "{VALUE_TEXT}"\n')], [3])

    def test_it_finds_the_files_it_should(self):
        files = test_files()
        names = {p.name for paths in files.values() for p in paths}
        for expected in ("tests.py", "test_dburl.py", "LoginForm.test.tsx", "smoke_test.py"):
            self.assertIn(expected, names)
