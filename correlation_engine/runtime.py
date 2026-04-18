from __future__ import annotations

import os
import sys
import warnings
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent.parent
VENDOR_DIR = ROOT_DIR / ".vendor"


def ensure_vendor_path() -> None:
    vendor = str(VENDOR_DIR)
    if VENDOR_DIR.exists() and vendor not in sys.path:
        sys.path.append(vendor)


ensure_vendor_path()
load_dotenv(ROOT_DIR / ".env")
os.environ.setdefault("LOKY_MAX_CPU_COUNT", str(os.cpu_count() or 4))
warnings.filterwarnings(
    "ignore",
    message="Could not find the number of physical cores",
)


def env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip()
