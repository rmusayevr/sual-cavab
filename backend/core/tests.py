from django.db import connection
from django.test import SimpleTestCase, TestCase
from django.urls import reverse


class DatabaseTests(TestCase):
    """Fails loudly when the suite is not really talking to PostgreSQL."""

    def test_database_is_postgresql_and_reachable(self):
        self.assertEqual(connection.vendor, "postgresql")
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            self.assertEqual(cursor.fetchone(), (1,))


class HealthEndpointTests(SimpleTestCase):
    def test_get_returns_ok_status(self):
        response = self.client.get(reverse("health"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "deliberately-wrong"})

    def test_post_is_not_allowed(self):
        response = self.client.post(reverse("health"))

        self.assertEqual(response.status_code, 405)
