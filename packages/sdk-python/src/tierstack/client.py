from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .errors import TierstackError


class TierstackHttpClient:
    """The one thing every resource shares: turning a method, a path and a
    body into a request, and an envelope back into either a value or a
    raised :class:`TierstackError`. No resource talks to ``urllib`` directly.

    Uses only the standard library — no ``requests``, no third-party HTTP
    client — so installing this package never pulls in a dependency whose
    version could conflict with the rest of an application.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: float = 30.0,
    ) -> None:
        if not api_key:
            raise ValueError("Tierstack: api_key is required.")
        if not base_url:
            raise ValueError(
                "Tierstack: base_url is required. This SDK does not guess at "
                "infrastructure that may not exist yet for your organization."
            )
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def request(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        query: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        if query:
            filtered = {k: v for k, v in query.items() if v is not None}
            if filtered:
                url = f"{url}?{urllib.parse.urlencode(filtered)}"

        headers = {
            "authorization": f"Bearer {self._api_key}",
            "content-type": "application/json",
        }
        if idempotency_key:
            headers["idempotency-key"] = idempotency_key

        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                status = response.status
                raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            raw = error.read()
        except urllib.error.URLError as error:
            raise TierstackError(
                f"Could not reach the Tierstack API: {error.reason}",
                "NETWORK_ERROR",
                0,
                None,
            ) from error

        envelope = None
        if raw:
            try:
                envelope = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                envelope = None

        error_obj: dict[str, Any] | None = envelope.get("error") if isinstance(envelope, dict) else None
        if status < 200 or status >= 300 or not envelope or error_obj:
            request_id = envelope.get("requestId") if isinstance(envelope, dict) else None
            if error_obj:
                message = error_obj.get("message", "The Tierstack API returned an error.")
                code = error_obj.get("code", "UNKNOWN_ERROR")
                details = error_obj.get("details")
            else:
                message = f"Tierstack API returned HTTP {status} with no readable body."
                code = "UNKNOWN_ERROR"
                details = None
            raise TierstackError(message, code, status, request_id, details)

        return envelope.get("data")
