from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response


class ProjectPagination(PageNumberPagination):
    """The project list in pages of 25 (#49), in the list's own order (name, then id).

    The page number is the only thing a caller chooses: no page size to ask for, so one request cannot
    ask for everything. A page that does not exist is a 404. The answer carries no next/previous links:
    DRF builds them as absolute addresses from the request's host, which behind the frontend's proxy is
    the backend's own, so the client counts pages itself from `count` and `page_size`."""

    page_size = 25
    page_size_query_param = None
    max_page_size = 25

    def get_paginated_response(self, data):
        return Response(
            {
                "count": self.page.paginator.count,
                "page": self.page.number,
                "page_size": self.page.paginator.per_page,
                "results": data,
            }
        )

    def get_paginated_response_schema(self, schema):
        return {
            "type": "object",
            "properties": {
                "count": {"type": "integer"},
                "page": {"type": "integer"},
                "page_size": {"type": "integer"},
                "results": schema,
            },
        }
