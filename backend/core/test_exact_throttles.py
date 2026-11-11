"""The limits hold under truly simultaneous requests (#41).

DRF's throttle reads a counter, then writes it: two requests that read before either writes both get in, so a
burst could pass more than the limit (and each extra worker would widen it). Real threads here, started at the
same moment, with the gap between the read and the write made wider (a short sleep after each cache read), so a
throttle that does not serialise fails reliably instead of once in a while."""

import threading
import time
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import caches
from django.core.cache.backends.db import DatabaseCache
from django.db import connection, connections
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

    def test_different_accounts_do_not_wait_for_each_other_or_share_a_count(self):
        def attempt(i):
            return LoginPerAccountThrottle().allow_request(SimpleNamespace(data={"email": f"person{i}@example.com"}), None)

        results = at_the_same_moment(12, attempt)

        self.assertEqual(results, [True] * 12)

    def test_no_lock_is_left_behind_once_the_check_is_over(self):
        # The check is milliseconds; the request that follows it (a draft can run for minutes) must not hold the
        # account's lock, or the next attempt for it would wait for the whole draft.
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
