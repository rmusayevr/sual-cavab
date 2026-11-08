from rest_framework import serializers

MAX_QUESTIONS = 10  # per draft; owner's limit on #9


class DraftRequestSerializer(serializers.Serializer):
    questions = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=False,
        max_length=MAX_QUESTIONS,
    )

    def validate_questions(self, numbers):
        if len(set(numbers)) != len(numbers):
            raise serializers.ValidationError("Each question can be picked once.")
        return numbers
