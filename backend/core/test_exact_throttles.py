"""The limits hold under truly simultaneous requests (#41).

DRF's throttle reads a counter, then writes it: two requests that read before either writes both get in, so a
burst could pass more than the limit (and each extra worker would widen it). Real threads here, started at the
same moment, with the gap between the read and the write made wider (a short sleep after each cache read), so a
throttle that does not serialise fails reliably instead of once in a while."""

import threading
import time
from types import SimpleNamespace
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.core.cache.backends.db import DatabaseCache
from django.db import ProgrammingError, connection, connections, transaction
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework.test import APIClient

from accounts.throttles import AdminLoginThrottle, LoginPerAccountThrottle
from core.testing import invented_password
from drafting.throttles import DraftThrottle
from projects.throttles import MemberAddThrottle

EXTRA = 15  # more simultaneous requests than the limit allows
real_get = DatabaseCache.get


def slow_get(self, *args, **kwargs):
    value = real_get(self, *args, **kwargs)
    time.sleep(0.01)  # widen the gap between reading the counter and writing it back
    return value


def at_the_same_moment(count, work):
    """Run work(i) in `count` threads released together; return the results in order."""
    barrier = threading.Barrier(count)
    results = [None] * count

    def run(i):
        try:
            barrier.wait(timeout=30)
            results[i] = work(i)
        except Exception as exc:  # shown by the test, not lost in the thread
            results[i] = exc
        finally:
            connections.close_all()

    threads = [threading.Thread(target=run, args=(i,)) for i in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)
    return results


class ExactThrottleTests(TransactionTestCase):
    databases = {"default"}

    def setUp(self):
        caches["throttle"].clear()
        patch = mock.patch.object(DatabaseCache, "get", slow_get)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(caches["throttle"].clear)

    def burst_allowed(self, throttle_class, request):
        limit = throttle_class().num_requests
        results = at_the_same_moment(limit + EXTRA, lambda i: throttle_class().allow_request(request, None))
        self.assertEqual([r for r in results if isinstance(r, Exception)], [])
        return limit, sum(1 for r in results if r)

    def signed_in_as(self, pk):
        return SimpleNamespace(user=SimpleNamespace(is_authenticated=True, pk=pk))

    def test_sign_in_attempts_per_account_stop_at_exactly_the_limit(self):
        request = SimpleNamespace(data={"email": "ada@example.com"})

        limit, allowed = self.burst_allowed(LoginPerAccountThrottle, request)

        self.assertEqual(allowed, limit)

    def test_the_admin_sign_in_stops_at_exactly_the_limit(self):
        request = SimpleNamespace(POST={"username": "ada@example.com"})

        limit, allowed = self.burst_allowed(AdminLoginThrottle, request)

        self.assertEqual(allowed, limit)

    def test_member_adds_per_user_stop_at_exactly_the_limit(self):
        limit, allowed = self.burst_allowed(MemberAddThrottle, self.signed_in_as(7))

        self.assertEqual(allowed, limit)

    def test_drafts_per_user_stop_at_exactly_the_limit(self):
        # Each draft is a paid API call: this is the one where an overshoot costs money.
        limit, allowed = self.burst_allowed(DraftThrottle, self.signed_in_as(8))

        self.assertEqual(allowed, limit)

    def test_a_check_waits_only_for_the_same_account(self):
        # Hold the lock of ada's key the way a check in progress does. Another account's check must go straight
        # through; a second check for ada must wait (so the lock is on the account's own key, not on all of them).
        ada, grace = SimpleNamespace(data={"email": "ada@example.com"}), SimpleNamespace(data={"email": "grace@example.com"})
        key = LoginPerAccountThrottle().get_cache_key(ada, None)
        outcome = {}

        def check(name, request):
            outcome[name] = LoginPerAccountThrottle().allow_request(request, None)
            connections.close_all()

        other = threading.Thread(target=check, args=("grace", grace))
        same = threading.Thread(target=check, args=("ada", ada))
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", [key])
            other.start()
            other.join(timeout=10)
            same.start()
            same.join(timeout=0.5)
            self.assertFalse(other.is_alive(), "another account's check waited for ada's lock")
            self.assertEqual(outcome, {"grace": True})
            self.assertTrue(same.is_alive(), "ada's second check did not wait for the first")
        same.join(timeout=10)
        self.assertEqual(outcome, {"grace": True, "ada": True})

    def test_a_refused_attempt_is_told_how_long_to_wait_by_the_count_it_was_refused_on(self):
        request = SimpleNamespace(data={"email": "ada@example.com"})
        for _ in range(10):
            self.assertTrue(LoginPerAccountThrottle().allow_request(request, None))

        refused = LoginPerAccountThrottle()

        self.assertFalse(refused.allow_request(request, None))
        self.assertGreater(refused.wait(), 50)  # the oldest of ten attempts in the last minute, not a guess

    def test_a_missing_counter_table_refuses_instead_of_letting_everyone_through(self):
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE throttle_cache RENAME TO throttle_cache_away")
        self.addCleanup(self.put_the_table_back)

        with self.assertRaises(ProgrammingError):
            MemberAddThrottle().allow_request(self.signed_in_as(11), None)

    def put_the_table_back(self):
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE IF EXISTS throttle_cache_away RENAME TO throttle_cache")

    def test_what_the_exact_count_depends_on_is_still_true(self):
        # The lock is held by the transaction opened around a check, so a request-wide transaction would hold it
        # for the whole request (a draft runs for minutes); and exactness needs READ COMMITTED, where each
        # statement sees the previous holder's commit (REPEATABLE READ let 35 of 20 through in review of #104).
        self.assertFalse(settings.DATABASES["default"].get("ATOMIC_REQUESTS"))
        with connection.cursor() as cursor:
            cursor.execute("SHOW transaction_isolation")
            self.assertEqual(cursor.fetchone()[0], "read committed")

    def test_a_check_made_on_its_own_leaves_no_lock_behind(self):
        # The check is milliseconds and ends its transaction. (Inside an enclosing transaction the lock would last
        # until that one ends: see the test of ATOMIC_REQUESTS above.)
        MemberAddThrottle().allow_request(self.signed_in_as(9), None)

        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())")
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_the_real_sign_in_url_refuses_the_eleventh_of_a_simultaneous_burst(self):
        get_user_model().objects.create_user(email="ada@example.com", password=invented_password())
        wrong = invented_password()
        url = reverse("auth-login")

        def attempt(i):
            return APIClient().post(url, {"email": "ada@example.com", "password": wrong}, format="json").status_code

        statuses = at_the_same_moment(10 + EXTRA, attempt)

        self.assertEqual([s for s in statuses if isinstance(s, Exception)], [])
        self.assertEqual(statuses.count(400), 10)  # ten wrong attempts were let through to be checked
        self.assertEqual(statuses.count(429), EXTRA)
