"""Who can see or change a project: the rule the owner approved on #5.

| Action                              | owner | member | not a member |
|-------------------------------------|-------|--------|--------------|
| See the project (and its questions) | yes   | yes    | no (404)     |
| Edit name, client, description      | yes   | yes    | no (404)     |
| Add or remove members               | yes   | no     | no (404)     |
| Delete the project                  | nobody in v1 (no endpoint)            |

Seeing is enforced by Project.objects.visible_to(); this module only decides
what a member may do once the project is visible. Membership changes are
decided from rows locked in the same transaction (see the views), never from
a role read earlier.

LOCK ORDER, for every write in projects and questions: the caller's membership
row first, then the project or question row. Removing a member locks only
membership rows, so one global order means no cycle can form between a write
and a removal, or between two writes by the same user. Taking them the other
way round deadlocked on real PostgreSQL (review of #21): lock the membership
with `lock_caller_membership()` before anything else in the transaction.
"""

from django.http import Http404

from .models import Membership


def role_may_manage_members(role) -> bool:
    return role == Membership.Role.OWNER


def lock_caller_membership(project, user):
    """Row-lock the caller's membership of `project`; 404 if they have none.

    Call first inside `transaction.atomic()`, before touching any other row. The
    visible_to() check at the start of the request had no lock, so a member
    removed since then is refused here, not allowed one more write.
    """
    membership = Membership.objects.select_for_update().filter(project=project, user=user).first()
    if membership is None:
        raise Http404
    return membership
