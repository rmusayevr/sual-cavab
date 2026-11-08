"""The only module that talks to the Claude API.

Everything else in the project sees `DraftClient`, a one-method interface, so
the SDK stays behind this file (and tests use a fake instead of the real API).
The key is read from the environment when a client is made, never stored in
settings, a module constant, a log line or an exception message.
"""

import os
import time

import anthropic

# Pinned so an ANTHROPIC_BASE_URL in the environment cannot send question text
# anywhere else; the constructor argument wins over the environment.
API_BASE_URL = "https://api.anthropic.com"

# Decided on #9: 30 seconds, one retry. The retry is ours, not the SDK's: the
# SDK waits as long as the server's retry-after header says, with no cap, so a
# "retry after 120 s" answer held the request past the web proxy's limit.
TIMEOUT_SECONDS = 30.0
CONNECT_TIMEOUT_SECONDS = 5.0
MAX_RETRIES = 1
# We retry only if the server asks for a wait this short (or says nothing).
MAX_RETRY_WAIT_SECONDS = 5.0
DEFAULT_RETRY_WAIT_SECONDS = 1.0
# The most one draft request can take, counting a connect, a write and a read
# phase on each of two attempts plus the wait between. The Next.js proxy
# timeout (frontend/next.config.ts) must be longer than this.
WORST_CASE_SECONDS = (MAX_RETRIES + 1) * (CONNECT_TIMEOUT_SECONDS + 2 * TIMEOUT_SECONDS) + MAX_RETRY_WAIT_SECONDS
# A safety bound, not the target length: the prompt asks for a short message.
# It is above the "about 600" the plan said because thinking tokens count
# against max_tokens, and a cap that cut the message off would be worse.
MAX_OUTPUT_TOKENS = 1500


class DraftingNotConfigured(Exception):
    """No API key on this server."""


class DraftingFailed(Exception):
    """Claude did not give back a usable draft. The text is for the log only
    and holds an error class name, never anything the API sent."""


class DraftClient:
    """What the view needs: turn a prompt into draft text."""

    def draft(self, *, system, user, model):  # pragma: no cover - interface
        raise NotImplementedError


class AnthropicDraftClient(DraftClient):
    def __init__(self, api_key):
        self._client = anthropic.Anthropic(
            api_key=api_key,
            base_url=API_BASE_URL,
            timeout=anthropic.Timeout(TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
            max_retries=0,  # we retry ourselves, with a bounded wait (see above)
            # Given an option, the SDK ignores the ANTHROPIC_OPEN_TELEMETRY*
            # environment variables, one of which would put question text into
            # traces. Tracing and trace-context headers stay off.
            open_telemetry={"traces": {"enabled": False}, "propagation": False},
        )

    def __repr__(self):
        return "<AnthropicDraftClient>"  # never the key

    def _create(self, *, system, user, model):
        return self._client.messages.create(
            model=model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user}],
            # A short message needs little thinking. No sampling settings,
            # no tools, and no server-side fallback: a fallback could route
            # the request to a different model than the one configured.
            output_config={"effort": "low"},
        )

    def draft(self, *, system, user, model):
        response = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = self._create(system=system, user=user, model=model)
                break
            except anthropic.APIError as err:
                wait = retry_wait(err) if attempt < MAX_RETRIES else None
                if wait is None:
                    # The class name only: the message can echo what was sent.
                    raise DraftingFailed(type(err).__name__) from None
                time.sleep(wait)

        if response.stop_reason == "refusal":
            raise DraftingFailed("refusal")
        if response.stop_reason == "max_tokens":
            raise DraftingFailed("truncated")
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text").strip()
        if not text:
            raise DraftingFailed("empty")
        return text


def retry_wait(err):
    """Seconds to wait before trying once more, or None for "do not retry".

    Retries only what can pass by itself: a timeout or dropped connection, a
    408/409/429 or any 5xx. A server that asks for a wait longer than
    MAX_RETRY_WAIT_SECONDS is not waited for: the person gets the failure now.
    """
    if isinstance(err, anthropic.APIStatusError):
        status = err.status_code
        if not (status in (408, 409, 429) or status >= 500):
            return None
        headers = err.response.headers
        requested = None
        try:
            if headers.get("retry-after-ms"):
                requested = float(headers["retry-after-ms"]) / 1000
            elif headers.get("retry-after"):
                requested = float(headers["retry-after"])
        except ValueError:
            requested = None  # an HTTP-date or junk: use the default wait
        if requested is None:
            return DEFAULT_RETRY_WAIT_SECONDS
        if requested > MAX_RETRY_WAIT_SECONDS:
            return None
        return max(requested, 0.0)
    if isinstance(err, anthropic.APIConnectionError):  # includes timeouts
        return DEFAULT_RETRY_WAIT_SECONDS
    return None


def get_client():
    """The real client, or DraftingNotConfigured if there is no key."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise DraftingNotConfigured
    return AnthropicDraftClient(api_key)
