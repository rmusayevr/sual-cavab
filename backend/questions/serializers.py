from django.utils import timezone
from rest_framework import serializers

from .models import Answer, Question


class AnswerSerializer(serializers.ModelSerializer):
    recorded_by = serializers.CharField(source="recorded_by.email", read_only=True)

    class Meta:
        model = Answer
        fields = [
            "id",
            "text",
            "answered_by",
            "answered_on",
            "channel",
            "channel_note",
            "recorded_by",
            "recorded_at",
            "superseded_at",
        ]
        read_only_fields = fields


class AnswerInputSerializer(serializers.Serializer):
    text = serializers.CharField(allow_blank=False)
    answered_by = serializers.CharField(max_length=200, allow_blank=False)
    answered_on = serializers.DateField()
    channel = serializers.ChoiceField(choices=Answer.Channel.choices)
    channel_note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")

    def validate_answered_on(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError("The answer cannot be dated in the future.")
        return value


class QuestionSerializer(serializers.ModelSerializer):
    """Only the three text fields are writable. Status moves through the
    transition endpoint; number and project are fixed once created."""

    label = serializers.CharField(read_only=True)
    current_answer = serializers.SerializerMethodField()
    previous_answers = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = [
            "id",
            "number",
            "label",
            "text",
            "why_it_matters",
            "blocks",
            "status",
            "current_answer",
            "previous_answers",
            "asked_at",
            "answered_at",
            "dropped_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [f for f in fields if f not in ("text", "why_it_matters", "blocks")]

    def update(self, instance, validated_data):
        # Write only the fields that were sent. DRF's default saves every column
        # from the copy loaded at the start of the request, so an edit racing an
        # answer or a re-open wrote back the old status and timestamps, leaving
        # an open question with a current answer that no transition can clear
        # (review of #21).
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save(update_fields=[*validated_data, "updated_at"])
        # Answer with the row as it is now, not the copy loaded earlier.
        return Question.objects.prefetch_related("answers__recorded_by").get(pk=instance.pk)

    def _answers(self, question):
        return list(question.answers.all())  # prefetched by the view

    def get_current_answer(self, question):
        current = next((a for a in self._answers(question) if a.superseded_at is None), None)
        return AnswerSerializer(current).data if current else None

    def get_previous_answers(self, question):
        return AnswerSerializer([a for a in self._answers(question) if a.superseded_at is not None], many=True).data


class TransitionSerializer(serializers.Serializer):
    to = serializers.ChoiceField(choices=Question.Status.choices)
    answer = AnswerInputSerializer(required=False)

    def validate(self, attrs):
        answering = attrs["to"] == Question.Status.ANSWERED
        if answering and "answer" not in attrs:
            raise serializers.ValidationError({"answer": ["An answer is required to mark a question answered."]})
        if not answering and "answer" in attrs:
            raise serializers.ValidationError({"answer": ["An answer can only be given when marking it answered."]})
        return attrs
