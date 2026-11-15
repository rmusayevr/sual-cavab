"""Make "this person can no longer vouch for the link" permanent, not just true right now (#114).

usable_links() already ignores a link whose creator is not an active member, but only while that stays true:
reactivate the person, or add them back, and an old link would work again with nobody having made it. These
receivers revoke instead, so a link ends when its creator is deactivated or leaves the project by ANY route
(the members API, the Django admin, a script). revoked_by stays empty: nobody pressed a button.
"""

from django.contrib.auth import get_user_model
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from projects.models import TEAM_ROLES, Membership

from .models import AnswerLink
from .services import revoke_links


@receiver(post_delete, sender=Membership, dispatch_uid="answerlinks_revoke_on_membership_delete")
def revoke_links_of_a_departed_member(sender, instance, **kwargs):
    revoke_links(instance.project_id, revoked_by=None, created_by=instance.user_id)


@receiver(post_save, sender=Membership, dispatch_uid="answerlinks_revoke_on_leaving_the_team")
def revoke_links_of_a_member_who_became_a_client(sender, instance, created, **kwargs):
    """A client is not on the team (#121): when a role leaves owner/member (the admin can do it), the links end."""
    if instance.role not in TEAM_ROLES:
        revoke_links(instance.project_id, revoked_by=None, created_by=instance.user_id)


@receiver(post_save, sender=get_user_model(), dispatch_uid="answerlinks_revoke_on_deactivation")
def revoke_links_of_a_deactivated_user(sender, instance, created, **kwargs):
    if not created and not instance.is_active:
        AnswerLink.objects.filter(created_by=instance, revoked_at__isnull=True).update(revoked_at=timezone.now())
