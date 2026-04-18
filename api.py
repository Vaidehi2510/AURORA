"""ASGI entry shim: docs and systemd use ``uvicorn api:app``; implementation is ``app.py``."""

from app import app

__all__ = ["app"]
