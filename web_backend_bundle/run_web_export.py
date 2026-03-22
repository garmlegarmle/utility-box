#!/usr/bin/env python3
"""Standalone launcher for the standalone web backend bundle."""

from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
VENV_ROOT = PROJECT_ROOT / ".venv"
VENV_PYTHON = VENV_ROOT / "bin" / "python"
SRC_DIR = PROJECT_ROOT / "src"


def ensure_venv_python() -> None:
    current_prefix = Path(sys.prefix).resolve()
    if current_prefix == VENV_ROOT.resolve():
        return
    if not VENV_PYTHON.exists():
        raise SystemExit(
            "Local virtualenv python was not found. "
            "Run ./scripts/setup_venv.command first."
        )
    os.execv(str(VENV_PYTHON), [str(VENV_PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]])


ensure_venv_python()

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from trend_analysis.web_cli import main


if __name__ == "__main__":
    main()
