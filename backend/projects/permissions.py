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
"""

from .models import Membership


def role_may_manage_members(role) -> bool:
    return role == Membership.Role.OWNER
