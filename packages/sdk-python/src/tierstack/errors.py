from __future__ import annotations

from typing import Any


class TierstackError(Exception):
    """Raised for every non-2xx response and every response that could not be parsed.

    ``code`` is the same stable string the API returns — safe to switch on —
    and ``request_id`` is worth logging: it is what support looks up first.
    """

    def __init__(
        self,
        message: str,
        code: str,
        status_code: int,
        request_id: str | None,
        details: Any = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code
        self.request_id = request_id
        self.details = details

    def __repr__(self) -> str:
        return (
            f"TierstackError(code={self.code!r}, status_code={self.status_code!r}, "
            f"message={self.message!r}, request_id={self.request_id!r})"
        )
