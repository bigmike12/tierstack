from __future__ import annotations

from typing import Any, TypedDict

__all__ = ["Page", "TypedDict", "compact"]


def compact(body: dict[str, Any]) -> dict[str, Any]:
    """Drop keys whose value is ``None`` before sending a request body.

    The API's schemas treat an *absent* optional field and an explicit JSON
    ``null`` differently — most reject ``null`` outright. Every resource
    builds its body as a plain dict with every possible key, then compacts it
    here rather than repeating an `if x is not None` per field.
    """
    return {key: value for key, value in body.items() if value is not None}


class Page(TypedDict):
    """Every list endpoint returns this shape.

    Kept non-generic on purpose: combining ``Generic`` with ``TypedDict``
    was unreliable before Python 3.11, and this package supports 3.9+. Each
    resource module defines its own concrete page type (e.g. ``CustomerPage``)
    with the same four keys and a specific ``items`` type instead.
    """

    items: list[dict[str, Any]]
    page: int
    limit: int
    total: int
    totalPages: int
