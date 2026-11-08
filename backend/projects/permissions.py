"""Who can see or change a project: the rule the owner approved on #5.

| Action                              | owner | member | not a member |
|-------------------------------------|-------|--------|--------------|
| See the project (and its questions) | yes   | yes    | no (404)     |
| Edit name, client, description      | yes   | yes    | no (404)     |
| Add or remove members               | yes   | no     | no (404)     |
| Delete the project                  | nobody in v1 (no endpoint)            |

Seeing is enforced by Project.objects.visible_to(); this module only decides
what a member may do once the project is visible.
"""

from .models import Membership


def role_in(project, user):
    membership = project.memberships.filter(user=user).only("role").first()
    return membership.role if membership else None


def can_manage_members(project, user) -> bool:
    return role_in(project, user) == Membership.Role.OWNER
