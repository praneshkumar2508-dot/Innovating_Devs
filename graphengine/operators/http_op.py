"""
HTTP Operator for external API calls and webhook triggers in GraphEngine.
"""

from __future__ import annotations

from typing import Any, Dict, Optional
import httpx
from graphengine.core.node import Node


class HTTPOperator(Node):
    """
    Executes an asynchronous HTTP request (GET, POST, PUT, DELETE, etc.)
    and returns parsed JSON or text payload.
    """

    def __init__(
        self,
        node_id: str,
        url: str,
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        timeout_seconds: float = 10.0,
        retries: int = 2,
        name: Optional[str] = None,
        description: str = "HTTP request node",
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.url = url
        self.method = method.upper()
        self.headers = headers or {}

        async def _http_runner(**kwargs) -> Dict[str, Any]:
            # Merge kwargs into params/json if provided
            req_params = kwargs.get("params", None)
            req_json = kwargs.get("json", None) if self.method in ["POST", "PUT", "PATCH"] else None

            async with httpx.AsyncClient(timeout=timeout_seconds) as client:
                response = await client.request(
                    method=self.method,
                    url=self.url,
                    headers=self.headers,
                    params=req_params,
                    json=req_json,
                )
                response.raise_for_status()

                try:
                    data = response.json()
                except Exception:
                    data = response.text

                return {
                    "status_code": response.status_code,
                    "url": str(response.url),
                    "data": data,
                }

        super().__init__(
            node_id=node_id,
            func=_http_runner,
            name=name or f"HTTP {self.method} {self.url}",
            description=description,
            retries=retries,
            timeout_seconds=timeout_seconds,
            metadata=metadata,
        )
