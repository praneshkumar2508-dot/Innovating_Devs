"""
Edge and DataFlow definitions for GraphEngine.
Represents dependencies, data mappings, and conditional flows between nodes.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional


class Edge:
    """
    Directed edge representing a dependency between source and target nodes.
    Source must complete before Target executes.
    """

    def __init__(
        self,
        source: str,
        target: str,
        data_mapping: Optional[Dict[str, str]] = None,
        condition: Optional[Callable[[Any], bool]] = None,
        label: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        self.source = str(source)
        self.target = str(target)
        # Mapping from source output keys to target input parameter names:
        # e.g., {"processed_data": "data", "status_code": "code"}
        # If None and source produces a dict, target can receive the full or matched dict
        self.data_mapping = data_mapping or {}
        self.condition = condition
        self.label = label or ""
        self.metadata = metadata or {}

    def is_traversable(self, source_output: Any) -> bool:
        """Evaluate if data/execution can flow across this edge."""
        if self.condition is None:
            return True
        try:
            return bool(self.condition(source_output))
        except Exception:
            return False

    def transform_data(self, source_output: Any) -> Dict[str, Any]:
        """
        Map source node output into target node input keyword arguments.
        """
        if not self.data_mapping:
            # If no mapping specified:
            # If output is a dictionary, pass keys that match or pass as default kwarg
            if isinstance(source_output, dict):
                return source_output
            # Otherwise return single value under edge label or default 'input_data'
            key = self.label or "data"
            return {key: source_output}

        target_kwargs: Dict[str, Any] = {}
        for source_key, target_param in self.data_mapping.items():
            if isinstance(source_output, dict) and source_key in source_output:
                target_kwargs[target_param] = source_output[source_key]
            elif source_key == "*" or source_key == "":
                target_kwargs[target_param] = source_output
        return target_kwargs

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "target": self.target,
            "data_mapping": self.data_mapping,
            "label": self.label,
            "has_condition": self.condition is not None,
            "metadata": self.metadata,
        }

    def __repr__(self) -> str:
        return f"<Edge {self.source} -> {self.target} (mapping={self.data_mapping})>"
