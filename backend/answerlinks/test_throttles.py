"""Rate limits on the public link (#114). Keyed on the link, never on the address (see #18)."""

from unittest import mock

from rest_framework.throttling import SimpleRateThrottle

from .services import create_link
from .support import LINK_QUESTIONS, LinkTestCase, link_answers, with_token


def rates(**overrides):
    return mock.patch.dict(SimpleRateThrottle.THROTTLE_RATES, overrides)


class SubmitLimitTests(LinkTestCase):
    def submit(self, number=1, token=None):
        return self.public().post(
            link_answers(number), {"text": "x", "name": "n"}, format="json", **with_token(token or self.token)
        )

    def test_submissions_are_limited_per_link(self):
        with rates(answer_link_submit="3/hour"):
            statuses = [self.submit().status_code for _ in range(4)]

        self.assertEqual(statuses, [201, 201, 201, 429])

    def test_one_links_limit_does_not_block_another_link(self):
        _, other_token = create_link(self.other, self.outsider, days=7)

        with rates(answer_link_submit="2/hour"):
            self.submit()
            self.submit()
            self.assertEqual(self.submit().status_code, 429)
            other = self.public().post(
                link_answers(1), {"text": "x", "name": "n"}, format="json", **with_token(other_token)
            )

        self.assertEqual(other.status_code, 201)

    def test_reading_does_not_use_up_the_submit_budget(self):
        with rates(answer_link_submit="2/hour"):
            for _ in range(5):
                self.public().get(LINK_QUESTIONS, **with_token(self.token))

            self.assertEqual(self.submit().status_code, 201)


class ReadLimitTests(LinkTestCase):
    def test_reads_are_limited_per_link(self):
        with rates(answer_link_read="2/hour"):
            statuses = [self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code for _ in range(3)]

        self.assertEqual(statuses, [200, 200, 429])


class InvalidTokenBucketTests(LinkTestCase):
    def test_bad_tokens_are_limited_by_one_shared_bucket(self):
        with rates(answer_link_invalid="3/min"):
            statuses = [
                self.public().get(LINK_QUESTIONS, **with_token(f"{n:043d}")).status_code for n in range(5)
            ]

        self.assertEqual(statuses, [404, 404, 404, 429, 429])

    def test_the_bucket_never_blocks_a_valid_link(self):
        with rates(answer_link_invalid="2/min"):
            for n in range(5):  # use the bucket up with bad tokens
                self.public().get(LINK_QUESTIONS, **with_token(f"{n:043d}"))

            response = self.public().get(LINK_QUESTIONS, **with_token(self.token))

        self.assertEqual(response.status_code, 200)

    def test_valid_requests_do_not_count_toward_the_bucket(self):
        with rates(answer_link_invalid="2/min"):
            for _ in range(6):
                self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token(self.token)).status_code, 200)

            self.assertEqual(self.public().get(LINK_QUESTIONS, **with_token("Z" * 43)).status_code, 404)

    def test_the_throttled_answer_is_never_cached_or_indexed(self):
        with rates(answer_link_invalid="1/min"):
            self.public().get(LINK_QUESTIONS, **with_token("Y" * 43))
            response = self.public().get(LINK_QUESTIONS, **with_token("Z" * 43))

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response["Cache-Control"], "no-store")


class RetryAfterTests(LinkTestCase):
    def test_a_limited_client_is_told_when_to_try_again(self):
        with rates(answer_link_read="1/hour"):
            self.public().get(LINK_QUESTIONS, **with_token(self.token))
            response = self.public().get(LINK_QUESTIONS, **with_token(self.token))

        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)

    def test_the_bad_token_bucket_says_when_to_try_again_too(self):
        with rates(answer_link_invalid="1/min"):
            self.public().get(LINK_QUESTIONS, **with_token("Y" * 43))
            response = self.public().get(LINK_QUESTIONS, **with_token("Z" * 43))

        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)
