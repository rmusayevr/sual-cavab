from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import normalize_email

# One message for every failed sign-in, so the response does not reveal
# whether an email has an account.
INVALID_CREDENTIALS = "Email or password is incorrect."


def user_payload(user):
    return {"id": user.pk, "email": user.email, "name": user.get_full_name()}


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie so the frontend can send the token on its first POST."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """POST {email, password}. CSRF is enforced even though the caller is anonymous."""

    permission_classes = [AllowAny]
    authentication_classes: list = []
    throttle_scope = "login"

    def post(self, request):
        email = request.data.get("email")
        password = request.data.get("password")
        if not isinstance(email, str) or not isinstance(password, str) or not email or not password:
            return Response({"detail": INVALID_CREDENTIALS}, status=status.HTTP_400_BAD_REQUEST)
        user = authenticate(request, email=normalize_email(email), password=password)
        if user is None:
            return Response({"detail": INVALID_CREDENTIALS}, status=status.HTTP_400_BAD_REQUEST)
        login(request, user)
        return Response(user_payload(user))


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(user_payload(request.user))
