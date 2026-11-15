from django.apps import AppConfig


class AccountsConfig(AppConfig):
    name = "accounts"

    def ready(self):
        from django.contrib import admin

        from .throttles import protect_admin_login

        protect_admin_login(admin.site)  # the admin sign-in shares the app's attempt limit (#45)
