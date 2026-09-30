"""
Cache management for node results in GraphEngine.
Supports memory-based memoization using input parameter hashes.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional
from graphengine.core.node import NodeResult


class NodeCache:
    """In-memory cache for node execution results."""

    def __init__(self, max_entries: int = 1000):
        self._cache: Dict[str, NodeResult] = {}
        self.max_entries = max_entries

    def _hash_key(self, node_id: str, kwargs: Dict[str, Any]) -> str:
        """Create a deterministic hash string from node_id and input kwargs."""
        try:
            # Sort keys for consistent json string
            serialized = json.dumps(kwargs, sort_keys=True, default=str)
        except Exception:
            serialized = str(sorted(kwargs.items()))
        combined = f"{node_id}::{serialized}".encode("utf-8")
        return hashlib.sha256(combined).hexdigest()

    def get(self, node_id: str, kwargs: Dict[str, Any]) -> Optional[NodeResult]:
        key = self._hash_key(node_id, kwargs)
        result = self._cache.get(key)
        if result is not None:
            # Clone and mark as cached
            cached_res = result.model_copy(deep=True)
            cached_res.cached = True
            return cached_res
        return None

    def set(self, node_id: str, kwargs: Dict[str, Any], result: NodeResult):
        if len(self._cache) >= self.max_entries:
            # Evict first element
            first_key = next(iter(self._cache))
            del self._cache[first_key]
        key = self._hash_key(node_id, kwargs)
        self._cache[key] = result

    def clear(self):
        self._cache.clear()
