"""Impact engine — calculates a documented, normalised impact score for
every affected asset and ranks them by severity.

## Impact Score Formula

```
impact_score = criticality × dependency_loss × time_urgency
```

### Term Definitions

- **criticality** ∈ [0, 1]: The asset's criticality value from input data.
- **dependency_loss** ∈ [0, 1]: Fraction of dependencies that are unsatisfied.
  - 1.0 when the asset has completely lost all supply.
  - 0.0 when all dependencies are fully satisfied.
  - For partial loss: `1 - (capacity_available_percent / 100)`.
- **time_urgency** ∈ [0, 1]: How urgently the asset needs attention.
  - 1.0 when no backup exists or backup is exhausted.
  - Decreases as runway increases: `1 - min(runway / max_runway, 1)`.
  - `max_runway` defaults to 480 minutes (8 hours).

The final score is clamped to [0, 1].

### Severity Classification

| Score Range | Severity |
|---|---|
| 0.00 – 0.24 | LOW |
| 0.25 – 0.49 | MODERATE |
| 0.50 – 0.74 | HIGH |
| 0.75 – 1.00 | CRITICAL |

Thresholds are configurable via `settings.impact_*_max`.
"""

from __future__ import annotations

from dataclasses import dataclass

import networkx as nx

from app.config import settings
from app.models.enums import CascadeAssetState, ImpactSeverity
from app.models.schemas import Asset
from app.core.propagation_engine import PropagationResult
from app.core.runway_engine import RunwayDetail


MAX_RUNWAY_MINUTES = 480.0  # 8-hour default horizon


@dataclass
class ImpactDetail:
    """Impact analysis for a single asset."""
    asset_id: str
    criticality: float = 0.0
    dependency_loss: float = 0.0
    time_urgency: float = 0.0
    impact_score: float = 0.0
    severity: ImpactSeverity = ImpactSeverity.LOW


class ImpactEngine:
    """Calculates normalised impact scores and ranks affected assets."""

    def __init__(self, graph: nx.DiGraph) -> None:
        self.graph = graph

    def analyse(
        self,
        propagation: PropagationResult,
        runways: dict[str, RunwayDetail],
    ) -> dict[str, ImpactDetail]:
        """Calculate impact for every affected asset.

        Parameters
        ----------
        propagation : PropagationResult
        runways : dict[str, RunwayDetail]

        Returns
        -------
        dict[str, ImpactDetail]
        """
        impacts: dict[str, ImpactDetail] = {}

        for node_id in self.graph.nodes:
            asset: Asset = self.graph.nodes[node_id]["asset"]
            state = propagation.asset_states.get(node_id, CascadeAssetState.OPERATIONAL)

            if state == CascadeAssetState.OPERATIONAL:
                impacts[node_id] = ImpactDetail(
                    asset_id=node_id,
                    criticality=asset.criticality,
                    severity=ImpactSeverity.LOW,
                )
                continue

            # Criticality
            crit = asset.criticality

            # Dependency loss
            cap_pct = propagation.capacity_remaining.get(node_id, 100.0)
            if state == CascadeAssetState.FAILED:
                dep_loss = 1.0
            elif state == CascadeAssetState.PROTECTED:
                dep_loss = 0.1  # minor loss — protected by redundancy/backup
            else:
                dep_loss = 1.0 - (cap_pct / 100.0)

            # Time urgency
            runway_info = runways.get(node_id)
            if runway_info and runway_info.has_backup and runway_info.runway_minutes > 0:
                time_urg = 1.0 - min(runway_info.runway_minutes / MAX_RUNWAY_MINUTES, 1.0)
            else:
                if state in (CascadeAssetState.FAILED, CascadeAssetState.AT_RISK):
                    time_urg = 1.0
                elif state == CascadeAssetState.PROTECTED:
                    time_urg = 0.2
                else:
                    time_urg = 0.5

            # Final score
            score = crit * dep_loss * time_urg
            score = max(0.0, min(1.0, score))

            severity = self._classify(score)

            impacts[node_id] = ImpactDetail(
                asset_id=node_id,
                criticality=crit,
                dependency_loss=dep_loss,
                time_urgency=time_urg,
                impact_score=score,
                severity=severity,
            )

        return impacts

    def rank(
        self,
        impacts: dict[str, ImpactDetail],
    ) -> list[ImpactDetail]:
        """Return impacts sorted by score descending."""
        return sorted(impacts.values(), key=lambda i: i.impact_score, reverse=True)

    @staticmethod
    def _classify(score: float) -> ImpactSeverity:
        """Classify an impact score into a severity level."""
        if score <= settings.impact_low_max:
            return ImpactSeverity.LOW
        elif score <= settings.impact_moderate_max:
            return ImpactSeverity.MODERATE
        elif score <= settings.impact_high_max:
            return ImpactSeverity.HIGH
        else:
            return ImpactSeverity.CRITICAL
