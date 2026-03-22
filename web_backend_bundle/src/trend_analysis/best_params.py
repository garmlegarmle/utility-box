"""Helpers for loading optimizer-selected parameters in the standalone bundle."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from .config import EngineConfig


def load_optimized_config(
    best_params_csv: str | Path,
    base_config: EngineConfig | None = None,
) -> tuple[EngineConfig, dict[str, Any]]:
    """Merge head-wise best parameter rows into one effective engine config."""

    config = base_config or EngineConfig()
    best_params_csv = Path(best_params_csv).expanduser().resolve()
    best_df = pd.read_csv(best_params_csv)

    overrides: dict[str, Any] = {}
    metadata: dict[str, Any] = {}

    for row in best_df.to_dict("records"):
        head = str(row.get("head", "")).strip()
        if head:
            metadata[f"{head}_trial_id"] = row.get("trial_id")
            metadata[f"{head}_direction_family"] = row.get("direction_family")
        if not metadata.get("test_start") and row.get("test_start"):
            metadata["test_start"] = row.get("test_start")
        if not metadata.get("test_end") and row.get("test_end"):
            metadata["test_end"] = row.get("test_end")

        for key, value in row.items():
            if pd.isna(value):
                continue
            if key.startswith(("shared.", "direction.", "transition.", "confidence.")):
                normalized_path = _strip_head_prefix(key)
                _assign_nested_value(overrides, normalized_path, _coerce_scalar(value))

    return config.with_overrides(overrides), metadata


def _strip_head_prefix(path: str) -> str:
    for prefix in ("shared.", "direction.", "transition.", "confidence."):
        if path.startswith(prefix):
            return path[len(prefix) :]
    return path


def _assign_nested_value(target: dict[str, Any], path: str, value: Any) -> None:
    current = target
    parts = path.split(".")
    for part in parts[:-1]:
        current = current.setdefault(part, {})
    current[parts[-1]] = value


def _coerce_scalar(value: Any) -> Any:
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:  # noqa: BLE001
            return value
    return value
