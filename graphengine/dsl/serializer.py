"""
Graph serialization and deserialization for JSON and YAML formats.
Allows saving graph topologies, configurations, and metadata to disk and restoring them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional, Union
import yaml

from graphengine.core.engine import GraphEngine
from graphengine.core.node import Node


class GraphSerializer:
    """Serializes GraphEngine DAGs to/from JSON and YAML."""

    @staticmethod
    def to_dict(engine: GraphEngine) -> Dict[str, Any]:
        """Convert GraphEngine to dictionary schema."""
        return engine.to_dict()

    @staticmethod
    def to_json(engine: GraphEngine, indent: int = 2) -> str:
        """Serialize GraphEngine to JSON string."""
        return json.dumps(GraphSerializer.to_dict(engine), indent=indent, default=str)

    @staticmethod
    def to_yaml(engine: GraphEngine) -> str:
        """Serialize GraphEngine to YAML string."""
        return yaml.dump(GraphSerializer.to_dict(engine), sort_keys=False)

    @staticmethod
    def save_file(engine: GraphEngine, file_path: Union[str, Path]):
        """Save graph definition to JSON or YAML file based on extension."""
        path = Path(file_path)
        if path.suffix in [".yaml", ".yml"]:
            path.write_text(GraphSerializer.to_yaml(engine), encoding="utf-8")
        else:
            path.write_text(GraphSerializer.to_json(engine), encoding="utf-8")

    @staticmethod
    def from_dict(data: Dict[str, Any], registry: Optional[Dict[str, Any]] = None) -> GraphEngine:
        """
        Reconstruct a GraphEngine from dictionary specification.
        Functions can be resolved using an optional registry mapping of function names -> callables.
        """
        registry = registry or {}
        engine = GraphEngine(
            graph_id=data.get("graph_id"),
            name=data.get("name"),
            description=data.get("description", ""),
        )

        for n_data in data.get("nodes", []):
            nid = n_data["id"]
            func_name = n_data.get("metadata", {}).get("func_name") or nid
            func = registry.get(func_name)

            engine.add_node(
                node_or_id=nid,
                func=func,
                name=n_data.get("name"),
                description=n_data.get("description", ""),
                inputs=n_data.get("inputs", []),
                output_key=n_data.get("output_key"),
                retries=n_data.get("retries", 0),
                timeout_seconds=n_data.get("timeout_seconds"),
                cacheable=n_data.get("cacheable", False),
                metadata=n_data.get("metadata", {}),
            )

        for e_data in data.get("edges", []):
            engine.add_edge(
                source=e_data["source"],
                target=e_data["target"],
                data_mapping=e_data.get("data_mapping"),
                label=e_data.get("label"),
                metadata=e_data.get("metadata", {}),
            )

        return engine

    @staticmethod
    def load_file(file_path: Union[str, Path], registry: Optional[Dict[str, Any]] = None) -> GraphEngine:
        """Load graph definition from JSON or YAML file."""
        path = Path(file_path)
        content = path.read_text(encoding="utf-8")
        if path.suffix in [".yaml", ".yml"]:
            data = yaml.safe_load(content)
        else:
            data = json.loads(content)
        return GraphSerializer.from_dict(data, registry=registry)
