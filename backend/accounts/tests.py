from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from rest_framework.response import Response
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework.views import APIView

PASSWORD = "correct-horse-battery-staple"  # invented test value


def make_user(email="ada@example.com", **extra):
    return get_user_model().objects.create_user(email=email, password=PASSWORD, **extra)


class AccountTestCase(TestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache
        self.client = APIClient()

    def sign_in(self, email="ada@example.com", password=PASSWORD):
        return self.client.post(reverse("auth-login"), {"email": email, "password": password}, format="json")


class UserModelTests(TestCase):
    def test_email_is_stored_lower_cased(self):
        user = make_user(email="  Ada@Example.COM ")

        self.assertEqual(user.email, "ada@example.com")

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

        self.assertEqual(self.sign_in(password="wrong").status_code, 400)

    def test_unknown_email_gets_the_same_response_as_a_wrong_password(self):
        make_user()

        wrong_password = self.sign_in(password="wrong")
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
            self.sign_in(password="wrong")

        self.assertEqual(self.sign_in(password="wrong").status_code, 429)


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
