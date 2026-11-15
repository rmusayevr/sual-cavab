from django.urls import path

from . import views

urlpatterns = [
    # What a client with a link can reach. Nothing else answers to the token.
    path("answer-link/questions/", views.PublicQuestionsView.as_view()),
    path("answer-link/questions/<int:number>/answers/", views.PublicAnswersView.as_view()),
    # What the team does: signed in, members of the project only.
    path("projects/<int:project_id>/answer-link/", views.AnswerLinkView.as_view()),
    path("projects/<int:project_id>/submissions/", views.SubmissionsView.as_view()),
    path("projects/<int:project_id>/submissions/dismiss-pending/", views.DismissPendingView.as_view()),
    path("projects/<int:project_id>/submissions/<int:submission_id>/accept/", views.AcceptSubmissionView.as_view()),
    path("projects/<int:project_id>/submissions/<int:submission_id>/dismiss/", views.DismissSubmissionView.as_view()),
]
