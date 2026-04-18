"""AURORA correlation engine package.

Heavy ML imports stay lazy so ``import correlation_engine.runtime`` (used by the API)
does not load sklearn/xgboost on every lightweight request.
"""

from __future__ import annotations

__all__ = ("CorrelationConfig", "CorrelationEngine")


def __getattr__(name: str):
    if name == "CorrelationConfig":
        from .engine import CorrelationConfig

        return CorrelationConfig
    if name == "CorrelationEngine":
        from .engine import CorrelationEngine

        return CorrelationEngine
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
