"""Which model drafting may use. Decided by the owner on #9.

Anthropic keeps prompts and outputs of its "Covered Models" (Claude Fable and
Claude Mythos) for at least 30 days and does not offer zero data retention on
them. The owner decided that question text must not go to those models, so the
server refuses to start with one configured. This module is imported by
settings, which is what makes the refusal happen at start-up.
"""

from django.core.exceptions import ImproperlyConfigured

DEFAULT_MODEL = "claude-sonnet-5-5"

# Matched anywhere in the id, case-insensitively, so provider prefixes and
# suffixes ("anthropic.claude-fable-5-1", "...-mythos-5-v1:0") are caught too.
COVERED_MODEL_MARKERS = ("fable", "mythos")


def validate_drafting_model(model):
    """Return `model`, or refuse it with a message that says why."""
    if not isinstance(model, str) or not model.strip():
        raise ImproperlyConfigured("DRAFTING_MODEL is empty. Unset it to use %s." % DEFAULT_MODEL)
    lowered = model.lower()
    for marker in COVERED_MODEL_MARKERS:
        if marker in lowered:
            raise ImproperlyConfigured(
                f"DRAFTING_MODEL={model!r} is a Covered Model (Claude Fable or Claude Mythos). "
                "Anthropic keeps prompts and outputs on those models for at least 30 days and does not "
                "offer zero data retention, and the owner decided on #9 that drafting must not use them. "
                f"Set DRAFTING_MODEL to another model, for example {DEFAULT_MODEL}, or unset it."
            )
    return model.strip()
