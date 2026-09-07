from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple


@dataclass(frozen=True)
class ResearchConfig:
    random_seed: int
    outer_splits: int
    inner_splits: int
    bootstrap_iterations: int
    minimum_rows: int
    minimum_rows_per_outcome: int
    minimum_subgroup_rows: int
    minimum_subgroup_rows_per_outcome: int
    abstention_thresholds: Tuple[float, ...]


def load_config(path: Path) -> ResearchConfig:
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["abstention_thresholds"] = tuple(payload["abstention_thresholds"])
    return ResearchConfig(**payload)
