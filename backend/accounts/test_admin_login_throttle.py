from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import Client, TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from core.testing import invented_password

PASSWORD = invented_password()
WRONG_PASSWORD = invented_password()
EMAIL = "ada@example.com"


class AdminLoginThrottleTests(TestCase):
    """Django's admin sign-in page had no rate limit (#45): anyone who could reach it could guess passwords
    without limit, while the app's own sign-in allows 10 a minute per account. The admin is on by default and
    switched off on the public staging host. The admin login now shares the app's counter, keyed by the same
    normalized email, so switching to /admin/ is not a second budget of guesses."""

    def setUp(self):
        caches["throttle"].clear()
        get_user_model().objects.create_superuser(email=EMAIL, password=PASSWORD)
        self.client = Client()
        self.admin_login_url = reverse("admin:login")

    def admin_attempt(self, email=EMAIL, password=WRONG_PASSWORD):
        return self.client.post(self.admin_login_url, {"username": email, "password": password, "next": "/admin/"})

    def api_attempt(self, email=EMAIL, password=WRONG_PASSWORD):
        return APIClient().post(reverse("auth-login"), {"email": email, "password": password}, format="json")

    def test_the_eleventh_wrong_attempt_in_a_minute_is_refused_with_how_long_to_wait(self):
        for _ in range(10):
            self.assertNotEqual(self.admin_attempt().status_code, 429)

        response = self.admin_attempt()

        self.assertEqual(response.status_code, 429)
        self.assertIn("Too many sign-in attempts", response.content.decode())
        self.assertTrue(response["Retry-After"].isdigit())

    def test_the_right_password_is_refused_too_once_the_account_is_limited(self):
        for _ in range(10):
            self.admin_attempt()

        self.assertEqual(self.admin_attempt(password=PASSWORD).status_code, 429)

    def test_the_budget_is_shared_with_the_apps_own_sign_in(self):
        for _ in range(6):
            self.api_attempt()
        for _ in range(4):
            self.admin_attempt()

        self.assertEqual(self.admin_attempt().status_code, 429)
        self.assertEqual(self.api_attempt().status_code, 429)

    def test_the_same_account_written_another_way_counts_as_the_same_account(self):
        for variant in (" ADA@Example.com ", "Ada@EXAMPLE.com", EMAIL, "  ada@example.com") * 3:
            self.admin_attempt(email=variant)

        self.assertEqual(self.admin_attempt(email="ADA@example.com").status_code, 429)

    def test_another_account_is_not_affected(self):
        get_user_model().objects.create_superuser(email="grace@example.com", password=PASSWORD)
        for _ in range(10):
            self.admin_attempt()

        response = self.admin_attempt(email="grace@example.com", password=PASSWORD)

        self.assertEqual(response.status_code, 302)  # signed in: redirected to the admin

    def test_a_spelling_the_admin_form_folds_to_the_same_account_shares_the_budget(self):
        # The admin form folds the username with Unicode NFKC before it signs in, so a fullwidth "a" is the
        # same account as "a": it must not be a fresh bucket of attempts each time (review of #102).
        fullwidth = chr(0xFF41) + EMAIL[1:]
        self.assertNotEqual(fullwidth, EMAIL)
        for _ in range(10):
            self.admin_attempt()

        self.assertEqual(self.admin_attempt(email=fullwidth, password=PASSWORD).status_code, 429)
        self.assertEqual(self.admin_attempt(email=fullwidth.upper()).status_code, 429)

    def test_a_blocked_answer_is_never_cached(self):
        for _ in range(10):
            self.admin_attempt()

        response = self.admin_attempt()

        self.assertEqual(response.status_code, 429)
        self.assertIn("no-cache", response["Cache-Control"])

    def test_looking_at_the_sign_in_page_is_not_counted_or_blocked(self):
        # What this shows: viewing the page is never blocked or counted. It cannot tell the `method == POST` check
        # from the empty POST body of a GET (the key is None either way): that check is belt and braces (review of #102).
        for _ in range(15):
            self.assertEqual(self.client.get(self.admin_login_url).status_code, 200)

        self.assertNotEqual(self.admin_attempt().status_code, 429)

    def test_a_normal_sign_in_below_the_limit_still_works(self):
        for _ in range(3):
            self.admin_attempt()

        response = self.admin_attempt(password=PASSWORD)

        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get("/admin/").status_code, 200)

    def test_a_post_with_no_account_named_is_not_counted_against_anyone(self):
        for _ in range(12):
            self.client.post(self.admin_login_url, {"password": WRONG_PASSWORD})

        self.assertNotEqual(self.admin_attempt().status_code, 429)

    def test_the_apps_own_sign_in_is_unchanged(self):
        for _ in range(10):
            self.assertEqual(self.api_attempt().status_code, 400)

        self.assertEqual(self.api_attempt().status_code, 429)
