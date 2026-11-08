#!/usr/bin/env python3
"""Smoke test for a deployed staging site (#10). Standard library only.

    SMOKE_PASSWORD=<the DEMO_PASSWORD of the site> python scripts/smoke_test.py https://your-frontend.onrender.com

It signs in with the INVENTED demo accounts that `load_demo_data` creates and
checks what the owner asked for: the health endpoint, sign-in, and the
still-open view, plus the rule that a person who is not on a project cannot
see it. It changes nothing on the site. The password is read from the
environment and never printed. Exit status 0 only if every check passed.

Drafting calls a paid API, so it is checked only with --draft.
"""

import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request

DEMO_DOMAIN = "example.invalid"
OWNER = f"demo.owner@{DEMO_DOMAIN}"
OUTSIDER = f"demo.outsider@{DEMO_DOMAIN}"
TICKETING = "Demo: Ticketing platform"
BOOKING = "Demo: Booking portal"
# What `load_demo_data` creates: questions still open or asked, per demo project.
EXPECTED_STILL_OPEN = {TICKETING: 3, BOOKING: 2}
# A free Render service sleeps after 15 minutes and takes about a minute to wake:
# the first request gets a long timeout, the rest a normal one.
WAKE_TIMEOUT = 150


class Session:
    """One browser-like session: cookies kept, CSRF header added on writes."""

    def __init__(self, base):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, timeout=60):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(self.base + path, data=data, method=method)
        request.add_header("Accept", "application/json")
        request.add_header("Origin", self.base)
        if data is not None:
            request.add_header("Content-Type", "application/json")
        if method not in ("GET", "HEAD"):
            request.add_header("X-CSRFToken", next((c.value for c in self.jar if c.name == "csrftoken"), ""))
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read()
                status = response.status
        except urllib.error.HTTPError as err:
            raw, status = err.read(), err.code
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            return None, f"{type(err).__name__}"
        try:
            return status, json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            return status, raw[:60]

    def sign_in(self, email, password):
        self.call("GET", "/api/auth/csrf/")
        return self.call("POST", "/api/auth/login/", {"email": email, "password": password})[0]


def run(base, password, draft=False, out=print):
    """Run every check; return the number of failures."""
    results = []

    def check(name, ok, detail=""):
        results.append(ok)
        out(f"{'ok  ' if ok else 'FAIL'} {name}" + (f"  ({detail})" if detail and not ok else ""))

    anonymous = Session(base)
    status, body = anonymous.call("GET", "/api/health/", timeout=WAKE_TIMEOUT)
    if status is None:  # nothing answered at all: the other checks would only repeat this
        check("the site answers (a free instance can need a minute to wake)", False, body)
        out("\n0 passed, 1 failed")
        return 1
    check("health endpoint answers ok", status == 200 and body == {"status": "ok"}, f"{status} {body}")
    status, _ = anonymous.call("GET", "/api/projects/")
    check("projects are closed to a signed-out visitor", status in (401, 403), status)
    status, body = anonymous.call("GET", "/login")
    check("the sign-in page is served", status == 200, status)

    owner = Session(base)
    check("the demo owner can sign in", owner.sign_in(OWNER, password) == 200)
    status, projects = owner.call("GET", "/api/projects/")
    projects = projects if status == 200 and isinstance(projects, list) else []
    by_name = {p["name"]: p for p in projects}
    for name, expected in EXPECTED_STILL_OPEN.items():
        got = by_name.get(name, {}).get("open_question_count")
        check(f"{name}: {expected} still open on the project list", got == expected, f"got {got}")

    ticketing = by_name.get(TICKETING)
    if ticketing:
        status, still = owner.call("GET", f"/api/projects/{ticketing['id']}/questions/?status=open,asked")
        labels = sorted(q["label"] for q in still) if status == 200 and isinstance(still, list) else []
        check("the still-open view lists Q1, Q2 and Q5", labels == ["Q1", "Q2", "Q5"], labels)
        status, _ = owner.call("GET", f"/api/projects/{ticketing['id']}/questions/?status=opne")
        check("a misspelt status is refused, not shown as 'nothing open'", status == 400, status)
    else:
        check("the still-open view lists Q1, Q2 and Q5", False, "demo project not found")

    outsider = Session(base)
    check("the demo outsider can sign in", outsider.sign_in(OUTSIDER, password) == 200)
    status, theirs = outsider.call("GET", "/api/projects/")
    check("a person on no project sees no projects", status == 200 and theirs == [], f"{status} {theirs}")
    if ticketing:
        status, _ = outsider.call("GET", f"/api/projects/{ticketing['id']}/")
        check("... and gets a 404 for a project they are not on", status == 404, status)

    status, _ = Session(base).call("POST", "/api/auth/login/", {"email": OWNER, "password": "not-the-password"})
    check("a wrong password does not sign in", status in (400, 403), status)

    if draft and ticketing:
        status, body = owner.call("POST", f"/api/projects/{ticketing['id']}/draft/", {"questions": [1]}, timeout=200)
        check("drafting answers 200, or 503 if no key is set (never 5xx otherwise)", status in (200, 503), f"{status}")
        out(f"     drafting: {'a draft was written' if status == 200 else 'not set up on this site' if status == 503 else status}")

    failures = results.count(False)
    out(f"\n{len(results) - failures} passed, {failures} failed")
    return failures


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    if len(args) != 1 or not os.environ.get("SMOKE_PASSWORD"):
        print(__doc__)
        print("Usage: SMOKE_PASSWORD=... python scripts/smoke_test.py <frontend URL> [--draft]")
        return 2
    return 1 if run(args[0], os.environ["SMOKE_PASSWORD"], draft="--draft" in argv) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
