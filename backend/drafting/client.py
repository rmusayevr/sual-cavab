"""The only module that talks to the Claude API.

Everything else in the project sees `DraftClient`, a one-method interface, so
the SDK stays behind this file (and tests use a fake instead of the real API).
The key is read from the environment when a client is made, never stored in
settings, a module constant, a log line or an exception message.
"""

import os

import anthropic

# Decided on #9: 30 seconds, one retry.
# Pinned so an ANTHROPIC_BASE_URL in the environment cannot send question text
# anywhere else; the constructor argument wins over the environment.
API_BASE_URL = "https://api.anthropic.com"
TIMEOUT_SECONDS = 30.0
MAX_RETRIES = 1
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
            api_key=api_key, base_url=API_BASE_URL, timeout=TIMEOUT_SECONDS, max_retries=MAX_RETRIES
        )

    def __repr__(self):
        return "<AnthropicDraftClient>"  # never the key

    def draft(self, *, system, user, model):
        try:
            response = self._client.messages.create(
                model=model,
                max_tokens=MAX_OUTPUT_TOKENS,
                system=system,
                messages=[{"role": "user", "content": user}],
                # A short message needs little thinking. No sampling settings,
                # no tools, and no server-side fallback: a fallback could route
                # the request to a different model than the one configured.
                output_config={"effort": "low"},
            )
        except anthropic.APIError as err:
            # The class name only: the message can echo what was sent.
            raise DraftingFailed(type(err).__name__) from None

        if response.stop_reason == "refusal":
            raise DraftingFailed("refusal")
        if response.stop_reason == "max_tokens":
            raise DraftingFailed("truncated")
        text = "".join(block.text for block in response.content if getattr(block, "type", None) == "text").strip()
        if not text:
            raise DraftingFailed("empty")
        return text


def get_client():
    """The real client, or DraftingNotConfigured if there is no key."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        raise DraftingNotConfigured
    return AnthropicDraftClient(api_key)
