import secrets


def invented_password():
    """A password for a test, made when the test module loads (#44).

    Tests need a password to create a user and to sign in with. Written as a literal in a file, even an
    invented one, it looks like a leaked secret to a scanner (GitGuardian flagged two in PRs #26 and #28)
    and every new test is another chance for the same alert. Made here, there is no literal to flag; it is
    random per run, which is fine because a test only needs the two sides to agree. The first letter keeps
    it from starting with a digit or a symbol. core/test_no_literal_passwords.py fails if a test file
    writes one out again."""
    return "t" + secrets.token_urlsafe(18)
