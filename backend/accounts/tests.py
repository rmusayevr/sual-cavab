from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.test import TestCase
from django.urls import reverse
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

from core.testing import invented_password
PASSWORD = invented_password()
WRONG_PASSWORD = invented_password()


def make_user(email="ada@example.com", **extra):
    return get_user_model().objects.create_user(email=email, password=PASSWORD, **extra)


class AccountTestCase(TestCase):
    def setUp(self):
        caches["throttle"].clear()  # sign-in attempt counters
        self.client = APIClient()

    def sign_in(self, email="ada@example.com", password=PASSWORD):
        return self.client.post(reverse("auth-login"), {"email": email, "password": password}, format="json")


class UserModelTests(TestCase):
    def test_email_is_stored_lower_cased(self):
        user = make_user(email="  Ada@Example.COM ")

        self.assertEqual(user.email, "ada@example.com")

    def test_email_lookup_ignores_case(self):
        make_user(email="ada@example.com")

        found = get_user_model().objects.get_by_natural_key("ADA@Example.com")

        self.assertEqual(found.email, "ada@example.com")

    def test_admin_add_form_rejects_an_email_that_differs_only_in_case(self):
        from accounts.admin import EmailUserCreationForm

        make_user(email="ada@example.com")
        form = EmailUserCreationForm(data={"email": "Ada@Example.com", "password1": PASSWORD, "password2": PASSWORD})

        self.assertIn("email", form.errors)

    def test_admin_change_form_rejects_another_users_email_in_other_case(self):
        from accounts.admin import EmailUserChangeForm

        make_user(email="ada@example.com")
        other = make_user(email="grace@example.com")
        form = EmailUserChangeForm(
            instance=other,
            data={"email": "ADA@example.com", "date_joined": other.date_joined, "is_active": True},
        )

        self.assertIn("email", form.errors)

    def test_superuser_is_created_with_email_only(self):
        admin = get_user_model().objects.create_superuser(email="root@example.com", password=PASSWORD)

        self.assertTrue(admin.is_superuser and admin.is_staff)


class SignInTests(AccountTestCase):
    def test_correct_credentials_sign_in_and_return_the_user(self):
        make_user(first_name="Ada", last_name="Lovelace")

        response = self.sign_in()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "ada@example.com")

    def test_sign_in_creates_a_session(self):
        make_user()
        self.sign_in()

        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 200)

    def test_email_is_matched_case_insensitively(self):
        make_user()

        self.assertEqual(self.sign_in(email="ADA@example.com").status_code, 200)

    def test_wrong_password_is_refused(self):
        make_user()

        self.assertEqual(self.sign_in(password=WRONG_PASSWORD).status_code, 400)

    def test_unknown_email_gets_the_same_response_as_a_wrong_password(self):
        make_user()

        wrong_password = self.sign_in(password=WRONG_PASSWORD)
        unknown_email = self.sign_in(email="nobody@example.com")

        self.assertEqual(unknown_email.status_code, wrong_password.status_code)
        self.assertEqual(unknown_email.json(), wrong_password.json())

    def test_inactive_user_cannot_sign_in(self):
        make_user(is_active=False)

        self.assertEqual(self.sign_in().status_code, 400)

    def test_missing_fields_are_refused(self):
        response = self.client.post(reverse("auth-login"), {}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_sign_in_without_csrf_token_is_refused(self):
        make_user()
        client = APIClient(enforce_csrf_checks=True)

        response = client.post(reverse("auth-login"), {"email": "ada@example.com", "password": PASSWORD}, format="json")

        self.assertEqual(response.status_code, 403)

    def test_sign_in_with_csrf_token_succeeds_when_csrf_is_enforced(self):
        make_user()
        client = APIClient(enforce_csrf_checks=True)
        client.get(reverse("auth-csrf"))
        token = client.cookies["csrftoken"].value

        response = client.post(
            reverse("auth-login"),
            {"email": "ada@example.com", "password": PASSWORD},
            format="json",
            HTTP_X_CSRFTOKEN=token,
        )

        self.assertEqual(response.status_code, 200)

    def test_sign_in_is_throttled_after_ten_attempts(self):
        for _ in range(10):
            self.sign_in(password=WRONG_PASSWORD)

        self.assertEqual(self.sign_in(password=WRONG_PASSWORD).status_code, 429)

    def test_forged_forwarded_for_header_does_not_reset_the_throttle(self):
        def attempt(n):
            return self.client.post(
                reverse("auth-login"),
                {"email": "ada@example.com", "password": "wrong"},
                format="json",
                HTTP_X_FORWARDED_FOR=f"203.0.113.{n}",
            )

        for n in range(10):
            attempt(n)

        self.assertEqual(attempt(99).status_code, 429)

    def test_one_locked_account_does_not_block_sign_in_to_another(self):
        # Every request here comes from the same address (127.0.0.1), as all
        # sign-ins do behind the Next.js proxy: the limit must be per account.
        make_user(email="grace@example.com")
        for _ in range(10):
            self.sign_in(email="ada@example.com", password=WRONG_PASSWORD)

        self.assertEqual(self.sign_in(email="grace@example.com").status_code, 200)

class LoginThrottleTests(TestCase):
    """The throttle itself, without password hashing, so volume is cheap."""

    def setUp(self):
        from django.core.cache import caches

        caches["throttle"].clear()

    def allowed(self, email):
        from rest_framework.parsers import JSONParser
        from rest_framework.request import Request

        from accounts.throttles import LoginPerAccountThrottle

        raw = APIRequestFactory().post("/api/auth/login/", {"email": email, "password": "x"}, format="json")
        return LoginPerAccountThrottle().allow_request(Request(raw, parsers=[JSONParser()]), view=None)

    def test_differently_cased_emails_share_one_limit(self):
        for _ in range(10):
            self.allowed("ADA@Example.com")

        self.assertFalse(self.allowed("ada@example.com"))

    def test_a_maximum_length_email_is_throttled(self):
        # Review round 4 of #18: the cache key column is varchar(255); with the
        # raw email in the key, a 238+ character email overflowed it, the write
        # failed silently, and that account was never throttled.
        long_email = "a" * 242 + "@example.com"  # 254 characters, EmailField's maximum
        for _ in range(10):
            self.allowed(long_email)

        self.assertFalse(self.allowed(long_email))

    def test_junk_emails_do_not_evict_a_locked_accounts_counter(self):
        # Review round 3 of #18: with the 300-entry in-memory cache, ~300 made-up
        # emails pushed the victim's counter out and reset its limit.
        for _ in range(10):
            self.allowed("ada@example.com")
        for n in range(400):
            self.allowed(f"junk{n}@example.com")

        self.assertFalse(self.allowed("ada@example.com"))


class SignOutTests(AccountTestCase):
    def test_sign_out_ends_the_session(self):
        make_user()
        self.sign_in()

        self.assertEqual(self.client.post(reverse("auth-logout")).status_code, 204)
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)

    def test_anonymous_sign_out_is_refused(self):
        self.assertEqual(self.client.post(reverse("auth-logout")).status_code, 403)


class DenyByDefaultTests(AccountTestCase):
    def test_anonymous_request_for_current_user_is_refused(self):
        self.assertEqual(self.client.get(reverse("auth-me")).status_code, 403)

    def test_view_without_explicit_permissions_refuses_anonymous_users(self):
        class Unconfigured(APIView):
            def get(self, request):
                return Response({"secret": True})

        request = APIRequestFactory().get("/anything/")
        response = Unconfigured.as_view()(request)

        self.assertEqual(response.status_code, 403)

    def test_health_stays_public(self):
        self.assertEqual(self.client.get(reverse("health")).status_code, 200)
